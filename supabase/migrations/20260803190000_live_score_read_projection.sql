-- Phase 05: one tenant-authorized live scorecard projection for portal/mobile
-- reads and the minimum Realtime projection.  Raw score history remains
-- service-only; clients receive the current server projection and capabilities.

create function app.can_read_live_score_projection(
  p_group_id uuid,
  p_round_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.rounds as round_record
    join public.memberships as membership
      on membership.group_id = round_record.group_id
     and membership.user_id = (select auth.uid())
    join public.user_profiles as profile
      on profile.user_id = membership.user_id
    join auth.users as identity
      on identity.id = membership.user_id
    where round_record.id = p_round_id
      and round_record.group_id = p_group_id
      and round_record.state = 'live'
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
  );
$$;

revoke all on function app.can_read_live_score_projection(uuid, uuid)
from public, anon, authenticated, service_role;

grant select on table public.participant_score_projections to authenticated;

create policy participant_score_projections_live_read
on public.participant_score_projections
for select
to authenticated
using (app.can_read_live_score_projection(group_id, round_id));

alter table public.participant_score_projections replica identity full;
alter publication supabase_realtime add table public.participant_score_projections;

create function public.read_live_round_scores(
  p_actor_user_id uuid,
  p_round_id uuid
)
returns table (
  round_id app.entity_id,
  group_id app.entity_id,
  format public.round_format,
  scheduled_at app.utc_instant,
  group_time_zone app.iana_time_zone,
  round_version bigint,
  participant_id app.entity_id,
  participant_kind public.round_participant_kind,
  membership_id app.entity_id,
  sponsor_membership_id app.entity_id,
  first_name text,
  last_name text,
  rsvp_status public.round_rsvp_status,
  participant_version bigint,
  quota_snapshot app.quota_value,
  handicap_snapshot app.handicap_value,
  tee_snapshot text,
  enabled_final_total_fields jsonb,
  score_version bigint,
  score_revision_id app.entity_id,
  gross_score app.golf_score_value,
  net_score app.golf_score_value,
  golf_points app.golf_points_value,
  manual_merit app.manual_merit_value,
  plus_minus app.plus_minus_value,
  ranking_value app.plus_minus_value,
  score_changed_at app.utc_instant,
  can_edit boolean,
  can_author_manual_merit boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_round public.rounds%rowtype;
  snapshot_record public.round_rule_snapshots%rowtype;
  actor_membership public.memberships%rowtype;
begin
  if p_actor_user_id is null or p_round_id is null then
    raise exception 'score_read_context_required' using errcode = '22004';
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
  join public.user_profiles as profile
    on profile.user_id = membership.user_id
  join auth.users as identity
    on identity.id = membership.user_id
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
    );
  if not found then
    -- A guessed id from another tenant is deliberately indistinguishable from
    -- a missing resource.
    raise exception 'round_not_found' using errcode = 'P0002';
  end if;

  if target_round.state <> 'live' then
    raise exception 'round_scoring_locked' using errcode = 'P0001';
  end if;

  select snapshot.*
  into snapshot_record
  from public.round_rule_snapshots as snapshot
  where snapshot.round_id = target_round.id
    and snapshot.group_id = target_round.group_id;
  if not found then
    raise exception 'round_rule_snapshot_missing' using errcode = 'P0002';
  end if;

  return query
  select
    target_round.id,
    target_round.group_id,
    target_round.format,
    target_round.scheduled_at,
    target_round.group_time_zone,
    target_round.version,
    participant.id,
    participant.participant_kind,
    participant.membership_id,
    participant.sponsor_membership_id,
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
    participant.version,
    participant.quota_snapshot,
    participant.handicap_snapshot,
    participant.tee_snapshot,
    snapshot_record.enabled_final_total_fields,
    coalesce(projection.version, 0::bigint),
    projection.last_revision_id,
    projection.gross_score,
    projection.net_score,
    projection.golf_points,
    projection.manual_merit,
    projection.plus_minus,
    projection.ranking_value,
    projection.updated_at,
    (
      participant.rsvp_status = 'playing'
      and (
        actor_membership.role in ('coordinator', 'administrator')
        or (
          actor_membership.role = 'member'
          and (
            (
              participant.participant_kind = 'member'
              and participant.membership_id = actor_membership.id
            )
            or (
              participant.participant_kind = 'guest'
              and participant.sponsor_membership_id = actor_membership.id
            )
          )
        )
      )
    ),
    participant.rsvp_status = 'playing'
      and actor_membership.role in ('coordinator', 'administrator')
  from public.round_participants as participant
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
  left join public.participant_score_projections as projection
    on projection.participant_id = participant.id
   and projection.group_id = participant.group_id
   and projection.round_id = participant.round_id
  where participant.round_id = target_round.id
    and participant.group_id = target_round.group_id
  order by
    case when projection.ranking_value is null then 1 else 0 end,
    projection.ranking_value desc nulls last,
    pg_catalog.lower(
      coalesce(participant.guest_last_name, golfer.last_name, profile.last_name, '')
    ),
    pg_catalog.lower(
      coalesce(participant.guest_first_name, golfer.first_name, profile.first_name, '')
    ),
    participant.id;
end;
$$;

comment on function public.read_live_round_scores(uuid, uuid) is
  'Returns the tenant-authorized Live scorecard and current score projection. Clients receive capabilities, version, audit receipt metadata, and server-derived values but never raw revision history.';

revoke all on function public.read_live_round_scores(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.read_live_round_scores(uuid, uuid)
to service_role;
