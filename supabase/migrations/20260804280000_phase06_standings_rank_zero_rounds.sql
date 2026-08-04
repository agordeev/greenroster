-- Phase 06: rank only members with eligible official rounds.
--
-- Active members without a completed eligible round remain visible, but they
-- must not consume a competition rank for members who have played.  This
-- replacement keeps the existing actor-derived, tenant-scoped projection and
-- only changes the window ordering.

create or replace function public.read_member_standings(
  p_actor_user_id uuid
)
returns table (
  group_id app.entity_id,
  group_name text,
  group_time_zone app.iana_time_zone,
  standings_reset_date date,
  membership_id app.entity_id,
  first_name text,
  last_name text,
  merit_total numeric,
  rounds_played bigint,
  standing_rank bigint,
  is_actor boolean,
  quota_projection_ready boolean,
  projected_quota app.quota_value,
  projection_source jsonb,
  uses_initial_quota_next boolean,
  eligible_quota_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_membership public.memberships%rowtype;
begin
  if p_actor_user_id is null then
    raise exception 'member_standings_context_required' using errcode = '22004';
  end if;

  if exists (
    select 1
    from auth.users as identity
    where identity.id = p_actor_user_id
      and coalesce(identity.raw_app_meta_data, '{}'::jsonb)
        ? 'greenroster_password_recovery'
  ) then
    raise exception 'recovery_session_forbidden' using errcode = 'P0003';
  end if;

  select membership.*
  into actor_membership
  from public.memberships as membership
  join public.user_profiles as profile on profile.user_id = membership.user_id
  join auth.users as identity on identity.id = membership.user_id
  where membership.user_id = p_actor_user_id
    and membership.status = 'active'
    and profile.disabled_at is null
    and identity.email_confirmed_at is not null
    and identity.deleted_at is null
    and not identity.is_anonymous
    and (identity.banned_until is null or identity.banned_until <= pg_catalog.statement_timestamp())
  order by membership.id
  limit 1;
  if not found then
    raise exception 'member_standings_not_available' using errcode = 'P0002';
  end if;

  return query
  with group_context as (
    select group_record.id,
           group_record.name,
           group_record.time_zone,
           settings.standings_reset_date
    from public.groups as group_record
    left join public.group_quota_settings as settings
      on settings.group_id = group_record.id
    where group_record.id = actor_membership.group_id
  ), eligible_results as (
    select
      result.membership_id,
      result.total_merit,
      result.completion_id
    from public.round_official_results as result
    join public.round_completion_runs as completion
      on completion.id = result.completion_id
     and completion.round_id = result.round_id
     and completion.group_id = result.group_id
     and completion.state = 'official'::public.round_completion_run_state
    join public.rounds as round_record
      on round_record.id = result.round_id
     and round_record.group_id = result.group_id
    cross join group_context
    where result.group_id = group_context.id
      and result.participant_kind = 'member'::public.round_participant_kind
      and (
        group_context.standings_reset_date is null
        or round_record.scheduled_at is null
        or (round_record.scheduled_at at time zone round_record.group_time_zone)::date
          >= group_context.standings_reset_date
      )
  ), totals as (
    select
      membership.id as membership_id,
      membership.group_id,
      coalesce(sum(eligible.total_merit), 0)::numeric as merit_total,
      count(distinct eligible.completion_id)::bigint as rounds_played
    from public.memberships as membership
    cross join group_context
    left join eligible_results as eligible
      on eligible.membership_id = membership.id
    join auth.users as identity on identity.id = membership.user_id
    join public.user_profiles as profile on profile.user_id = membership.user_id
    where membership.group_id = group_context.id
      and membership.status = 'active'
      and profile.disabled_at is null
      and identity.email_confirmed_at is not null
      and identity.deleted_at is null
      and not identity.is_anonymous
    group by membership.id, membership.group_id
  ), ranked as (
    select
      totals.*,
      case
        when totals.rounds_played = 0 then null::bigint
        else pg_catalog.rank() over (
          order by (totals.rounds_played = 0), totals.merit_total desc
        )
      end as standing_rank
    from totals
  )
  select
    context.id,
    context.name,
    context.time_zone,
    context.standings_reset_date,
    ranked.membership_id,
    coalesce(golfer.first_name, profile.first_name),
    coalesce(golfer.last_name, profile.last_name),
    ranked.merit_total,
    ranked.rounds_played,
    ranked.standing_rank,
    ranked.membership_id = actor_membership.id,
    coalesce(current_quota.projection_ready, false),
    current_quota.projected_quota,
    coalesce(current_quota.projection_source, '{}'::jsonb),
    coalesce(quota.uses_initial_quota_next, false),
    coalesce(quota.eligible_count, 0)::bigint
  from ranked
  cross join group_context as context
  join public.memberships as membership
    on membership.id = ranked.membership_id
   and membership.group_id = ranked.group_id
  left join public.membership_golfer_profiles as golfer
    on golfer.membership_id = membership.id
   and golfer.group_id = membership.group_id
  join public.user_profiles as profile on profile.user_id = membership.user_id
  left join public.membership_quota_projections as current_quota
    on current_quota.membership_id = membership.id
   and current_quota.group_id = membership.group_id
  left join lateral app.member_quota_projection(membership.id, membership.group_id) as quota
    on true
  order by ranked.standing_rank nulls last,
    pg_catalog.lower(coalesce(golfer.last_name, profile.last_name, '')),
    pg_catalog.lower(coalesce(golfer.first_name, profile.first_name, '')),
    ranked.membership_id;
end;
$$;

comment on function public.read_member_standings(uuid) is
  'Authenticated member standings projection with server-derived reset filtering, ties, and quota provenance; unplayed members do not consume ranks.';

revoke all on function public.read_member_standings(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.read_member_standings(uuid) to service_role;
