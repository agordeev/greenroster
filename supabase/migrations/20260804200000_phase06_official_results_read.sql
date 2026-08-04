-- Phase 06: one authoritative current-official result read boundary.
--
-- Historical result rows remain append-only, but only the current official
-- completion run is visible through this projection.  A reopened round is
-- therefore unavailable until recompletion, while the retained snapshots stay
-- queryable only by trusted investigation tooling.

create function public.read_official_round_results(
  p_actor_user_id uuid,
  p_round_id uuid
)
returns table (
  round_id app.entity_id,
  group_id app.entity_id,
  completion_id app.entity_id,
  completion_number bigint,
  completed_at app.utc_instant,
  round_version bigint,
  participant_id app.entity_id,
  participant_kind public.round_participant_kind,
  membership_id app.entity_id,
  sponsor_membership_id app.entity_id,
  first_name text,
  last_name text,
  rsvp_status public.round_rsvp_status,
  score_revision_id app.entity_id,
  golf_points app.golf_points_value,
  gross_score app.golf_score_value,
  net_score app.golf_score_value,
  quota_snapshot app.quota_value,
  plus_minus app.plus_minus_value,
  ranking_value app.plus_minus_value,
  competition_rank bigint,
  participation_merit app.participation_merit_value,
  placement_merit app.placement_merit_value,
  manual_merit app.manual_merit_value,
  generated_merit app.generated_merit_value,
  total_merit numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_round public.rounds%rowtype;
  actor_membership public.memberships%rowtype;
  completion_record public.round_completion_runs%rowtype;
begin
  if p_actor_user_id is null or p_round_id is null then
    raise exception 'round_results_context_required' using errcode = '22004';
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

  select round_record.*
  into target_round
  from public.rounds as round_record
  where round_record.id = p_round_id;
  if not found then
    raise exception 'round_not_found' using errcode = 'P0002';
  end if;

  select membership.*
  into actor_membership
  from public.memberships as membership
  join public.user_profiles as profile on profile.user_id = membership.user_id
  join auth.users as identity on identity.id = membership.user_id
  where membership.user_id = p_actor_user_id
    and membership.group_id = target_round.group_id
    and membership.status = 'active'
    and profile.disabled_at is null
    and identity.email_confirmed_at is not null
    and identity.deleted_at is null
    and not identity.is_anonymous
    and not (
      coalesce(identity.raw_app_meta_data, '{}'::jsonb)
      ? 'greenroster_password_recovery'
    )
    and (
      identity.banned_until is null
      or identity.banned_until <= pg_catalog.statement_timestamp()
    )
  order by membership.id
  limit 1;
  if not found then
    raise exception 'round_not_found' using errcode = 'P0002';
  end if;

  if actor_membership.role = 'member'
    and not exists (
      select 1
      from public.round_participants as participant
      where participant.round_id = target_round.id
        and participant.group_id = target_round.group_id
        and (
          participant.membership_id = actor_membership.id
          or participant.sponsor_membership_id = actor_membership.id
        )
    )
  then
    raise exception 'round_not_found' using errcode = 'P0002';
  end if;

  select completion.*
  into completion_record
  from public.round_completion_runs as completion
  where completion.round_id = target_round.id
    and completion.group_id = target_round.group_id
    and completion.state = 'official'::public.round_completion_run_state;
  if not found or target_round.state <> 'completed'::public.round_state then
    raise exception 'round_results_not_available' using errcode = 'P0002';
  end if;

  return query
  select
    result.round_id,
    result.group_id,
    result.completion_id,
    completion_record.completion_number,
    completion_record.completed_at,
    completion_record.round_version,
    result.participant_id,
    result.participant_kind,
    result.membership_id,
    result.sponsor_membership_id,
    coalesce(
      participant.guest_first_name,
      golfer.first_name,
      profile.first_name
    ),
    coalesce(
      participant.guest_last_name,
      golfer.last_name,
      profile.last_name
    ),
    participant.rsvp_status,
    result.score_revision_id,
    result.golf_points,
    result.gross_score,
    result.net_score,
    result.quota_snapshot,
    result.plus_minus,
    result.ranking_value,
    result.competition_rank,
    result.participation_merit,
    result.placement_merit,
    result.manual_merit,
    result.generated_merit,
    result.total_merit
  from public.round_official_results as result
  join public.round_completion_runs as current_completion
    on current_completion.id = result.completion_id
   and current_completion.round_id = result.round_id
   and current_completion.group_id = result.group_id
   and current_completion.id = completion_record.id
   and current_completion.state = 'official'::public.round_completion_run_state
  join public.round_participants as participant
    on participant.id = result.participant_id
   and participant.round_id = result.round_id
   and participant.group_id = result.group_id
  left join public.membership_golfer_profiles as golfer
    on golfer.membership_id = participant.membership_id
   and golfer.group_id = participant.group_id
  left join public.user_profiles as profile
    on profile.user_id = (
      select membership.user_id
      from public.memberships as membership
      where membership.id = participant.membership_id
        and membership.group_id = participant.group_id
    )
  where result.round_id = target_round.id
    and result.group_id = target_round.group_id
  order by result.competition_rank nulls last,
    pg_catalog.lower(
      coalesce(participant.guest_last_name, golfer.last_name, profile.last_name, '')
    ),
    pg_catalog.lower(
      coalesce(participant.guest_first_name, golfer.first_name, profile.first_name, '')
    ),
    result.participant_id;
end;
$$;

comment on function public.read_official_round_results(uuid, uuid) is
  'Returns the tenant-authorized current official result snapshot with explicit ties and merit components; reopened runs are hidden.';

revoke all on function public.read_official_round_results(uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.read_official_round_results(uuid, uuid)
to service_role;

create function public.read_mobile_official_round_results(
  p_round_id uuid
)
returns table (
  round_id app.entity_id,
  group_id app.entity_id,
  completion_id app.entity_id,
  completion_number bigint,
  completed_at app.utc_instant,
  round_version bigint,
  participant_id app.entity_id,
  participant_kind public.round_participant_kind,
  membership_id app.entity_id,
  sponsor_membership_id app.entity_id,
  first_name text,
  last_name text,
  rsvp_status public.round_rsvp_status,
  score_revision_id app.entity_id,
  golf_points app.golf_points_value,
  gross_score app.golf_score_value,
  net_score app.golf_score_value,
  quota_snapshot app.quota_value,
  plus_minus app.plus_minus_value,
  ranking_value app.plus_minus_value,
  competition_rank bigint,
  participation_merit app.participation_merit_value,
  placement_merit app.placement_merit_value,
  manual_merit app.manual_merit_value,
  generated_merit app.generated_merit_value,
  total_merit numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select *
  from public.read_official_round_results((select auth.uid()), p_round_id);
$$;

comment on function public.read_mobile_official_round_results(uuid) is
  'Authenticated actor-derived official result projection for mobile; it never accepts a client actor identity.';

revoke all on function public.read_mobile_official_round_results(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.read_mobile_official_round_results(uuid)
to authenticated;
