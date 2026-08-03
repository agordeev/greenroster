-- Phase 03: expose the optimistic participant version at the existing
-- server-authoritative read boundary so a member can read, then submit an
-- RSVP mutation with the version it actually observed.

drop function public.read_round_participants(uuid, uuid);

create function public.read_round_participants(
  p_actor_user_id uuid,
  p_round_id uuid
)
returns table (
  round_id app.entity_id,
  participant_id app.entity_id,
  group_id app.entity_id,
  membership_id app.entity_id,
  first_name text,
  last_name text,
  rsvp_status public.round_rsvp_status,
  version bigint,
  quota_snapshot app.quota_value,
  quota_snapshot_source jsonb,
  handicap_snapshot app.handicap_value,
  handicap_snapshot_source public.member_handicap_source,
  handicap_snapshot_as_of date,
  tee_snapshot text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_group_id uuid;
  actor_membership_id uuid;
  actor_role public.membership_role;
  target_round public.rounds%rowtype;
begin
  if p_actor_user_id is null or p_round_id is null then
    raise exception 'publication_context_required' using errcode = '22004';
  end if;

  select membership.group_id, membership.id, membership.role
  into actor_group_id, actor_membership_id, actor_role
  from public.memberships as membership
  join public.user_profiles as profile
    on profile.user_id = membership.user_id
  join auth.users as identity
    on identity.id = membership.user_id
  where membership.user_id = p_actor_user_id
    and membership.status = 'active'
    and profile.disabled_at is null
    and identity.email_confirmed_at is not null
    and identity.deleted_at is null
    and not identity.is_anonymous
    and not (coalesce(identity.raw_app_meta_data, '{}'::jsonb) ? 'greenroster_password_recovery')
    and (identity.banned_until is null or identity.banned_until <= pg_catalog.statement_timestamp())
  limit 1;
  if actor_group_id is null then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  select round_record.*
  into target_round
  from public.rounds as round_record
  where round_record.id = p_round_id
    and round_record.group_id = actor_group_id;
  if not found or target_round.state = 'draft' then
    raise exception 'round_not_found' using errcode = 'P0002';
  end if;

  return query
  select
    participant.round_id,
    participant.id,
    participant.group_id,
    participant.membership_id,
    profile.first_name,
    profile.last_name,
    participant.rsvp_status,
    participant.version,
    participant.quota_snapshot,
    participant.quota_snapshot_source,
    participant.handicap_snapshot,
    participant.handicap_snapshot_source,
    participant.handicap_snapshot_as_of,
    participant.tee_snapshot
  from public.round_participants as participant
  join public.membership_golfer_profiles as profile
    on profile.membership_id = participant.membership_id
   and profile.group_id = participant.group_id
  where participant.round_id = target_round.id
    and participant.group_id = target_round.group_id
    and (
      actor_role in ('coordinator', 'administrator')
      or participant.membership_id = actor_membership_id
    )
  order by profile.last_name, profile.first_name, participant.membership_id;
end;
$$;

comment on function public.read_round_participants(uuid, uuid) is
  'Authenticated member read boundary. Members see only their own participant; coordinators/admins see their tenant roster, including the RSVP optimistic version.';

revoke all on function public.read_round_participants(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.read_round_participants(uuid, uuid)
to service_role;

