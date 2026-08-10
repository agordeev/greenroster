-- Member-web parity for the server-authorized live score and guest contracts.
--
-- The member route uses the same score/guest service boundaries as mobile.  A
-- member may read and manage only guests that the member sponsors, and only
-- before the published-round guest window closes.  This projection never
-- exposes raw participant rows to an application role.

create function public.read_member_round_guest_context(
  p_actor_user_id uuid,
  p_round_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_group_id uuid;
  actor_membership_id uuid;
  target_round public.rounds%rowtype;
  target_group public.groups%rowtype;
  guest_rows jsonb;
begin
  if p_actor_user_id is null or p_round_id is null then
    raise exception 'member_round_guest_context_required' using errcode = '22004';
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

  select actor.group_id, actor.membership_id
  into actor_group_id, actor_membership_id
  from app.guest_actor_context(p_actor_user_id) as actor
  where actor.actor_role = 'member'
  limit 1;
  if actor_group_id is null then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  select round_record.*
  into target_round
  from public.rounds as round_record
  where round_record.id = p_round_id
    and round_record.group_id = actor_group_id;
  if not found or target_round.state not in ('published', 'live') then
    raise exception 'round_not_found' using errcode = 'P0002';
  end if;

  select group_record.*
  into target_group
  from public.groups as group_record
  where group_record.id = actor_group_id;
  if not found then
    raise exception 'round_not_found' using errcode = 'P0002';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'participant_id', participant.id,
        'sponsor_membership_id', participant.sponsor_membership_id,
        'first_name', participant.guest_first_name,
        'last_name', participant.guest_last_name,
        'rsvp_status', participant.rsvp_status,
        'version', participant.version,
        'quota_snapshot', participant.quota_snapshot,
        'handicap_snapshot', participant.handicap_snapshot,
        'tee_snapshot', participant.tee_snapshot,
        'duplicate_like', false,
        'changed_at', participant.updated_at
      )
      order by pg_catalog.lower(participant.guest_last_name),
        pg_catalog.lower(participant.guest_first_name), participant.id
    ),
    '[]'::jsonb
  )
  into guest_rows
  from public.round_participants as participant
  where participant.round_id = target_round.id
    and participant.group_id = actor_group_id
    and participant.participant_kind = 'guest'
    and participant.sponsor_membership_id = actor_membership_id;

  return pg_catalog.jsonb_build_object(
    'round_id', target_round.id,
    'group_id', target_round.group_id,
    'format', target_round.format,
    'state', target_round.state,
    'can_manage', target_round.state = 'published' and target_group.allow_member_guests,
    'guests', guest_rows
  );
end;
$$;

comment on function public.read_member_round_guest_context(uuid, uuid) is
  'Service-only member projection of sponsored guests and the current guest permission. It never returns another member''s guests or raw participant data.';

revoke all on function public.read_member_round_guest_context(uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.read_member_round_guest_context(uuid, uuid)
to service_role;
