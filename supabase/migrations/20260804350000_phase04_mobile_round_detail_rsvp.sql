-- Phase 04: authenticated mobile upcoming-round detail and RSVP boundaries.
--
-- The underlying round read and RSVP mutation remain server-authoritative.
-- These delegates derive the actor from the authenticated Supabase session so
-- the mobile client cannot choose a tenant, membership, or source.

create function public.read_mobile_round_detail(
  p_round_id uuid
)
returns table (
  round_id app.entity_id,
  group_id app.entity_id,
  description text,
  scheduled_at app.utc_instant,
  group_time_zone app.iana_time_zone,
  venue text,
  round_url text,
  notes text,
  format public.round_format,
  state public.round_state,
  version bigint,
  rsvp_deadline_at app.utc_instant,
  participant_status public.round_rsvp_status,
  participant_version bigint,
  rsvp_changed_at app.utc_instant,
  participant_count bigint,
  playing_count bigint,
  cancelled_at app.utc_instant,
  cancellation_reason text,
  updated_at app.utc_instant
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := (select auth.uid());
  actor_membership public.memberships%rowtype;
  target_round public.rounds%rowtype;
  actor_participant public.round_participants%rowtype;
  can_read boolean := false;
begin
  if actor_user_id is null or p_round_id is null then
    raise exception 'round_detail_context_required' using errcode = '22004';
  end if;

  if exists (
    select 1
    from auth.users as identity
    where identity.id = actor_user_id
      and coalesce(identity.raw_app_meta_data, '{}'::jsonb)
        ? 'greenroster_password_recovery'
  ) then
    raise exception 'recovery_session_forbidden' using errcode = 'P0003';
  end if;

  select membership.*
  into actor_membership
  from public.memberships as membership
  join public.user_profiles as profile
    on profile.user_id = membership.user_id
  join auth.users as identity
    on identity.id = membership.user_id
  where membership.user_id = actor_user_id
    and membership.status = 'active'
    and profile.disabled_at is null
    and identity.email_confirmed_at is not null
    and identity.deleted_at is null
    and not identity.is_anonymous
    and (
      identity.banned_until is null
      or identity.banned_until <= pg_catalog.statement_timestamp()
    )
  order by membership.id
  limit 1;
  if not found then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  select round_record.*
  into target_round
  from public.rounds as round_record
  where round_record.id = p_round_id
    and round_record.group_id = actor_membership.group_id;
  if not found or target_round.state = 'draft' then
    raise exception 'round_not_found' using errcode = 'P0002';
  end if;

  select participant.*
  into actor_participant
  from public.round_participants as participant
  where participant.round_id = target_round.id
    and participant.group_id = target_round.group_id
    and participant.membership_id = actor_membership.id;

  can_read := actor_membership.role in ('coordinator', 'administrator')
    or actor_participant.id is not null
    or exists (
      select 1
      from public.round_participants as sponsor_participant
      where sponsor_participant.round_id = target_round.id
        and sponsor_participant.group_id = target_round.group_id
        and sponsor_participant.sponsor_membership_id = actor_membership.id
    )
    or target_round.state = 'completed';

  if not can_read then
    raise exception 'round_not_found' using errcode = 'P0002';
  end if;

  return query
  select
    target_round.id,
    target_round.group_id,
    target_round.description,
    target_round.scheduled_at,
    target_round.group_time_zone,
    target_round.venue,
    target_round.round_url,
    case
      when target_round.notes_visible_to_players then target_round.notes
      else null
    end,
    target_round.format,
    target_round.state,
    target_round.version,
    target_round.rsvp_deadline_at,
    coalesce(actor_participant.rsvp_status, 'no_response'::public.round_rsvp_status),
    actor_participant.version,
    rsvp_change.changed_at::app.utc_instant,
    counts.participant_count,
    counts.playing_count,
    target_round.cancelled_at,
    target_round.cancellation_reason,
    target_round.updated_at
  from (
    select
      count(*)::bigint as participant_count,
      count(*) filter (where participant.rsvp_status = 'playing')::bigint
        as playing_count
    from public.round_participants as participant
    where participant.round_id = target_round.id
      and participant.group_id = target_round.group_id
  ) as counts
  left join lateral (
    select coalesce(
      nullif(event.after_state ->> 'changed_at', '')::timestamptz,
      event.occurred_at
    ) as changed_at
    from public.audit_events as event
    where event.group_id = target_round.group_id
      and event.action = 'round.participant_rsvp_changed'
      and event.target_id = actor_participant.id
    order by event.occurred_at desc, event.id desc
    limit 1
  ) as rsvp_change on true;
end;
$$;

comment on function public.read_mobile_round_detail(uuid) is
  'Authenticated actor-derived mobile round detail. Player-hidden notes are redacted before the payload leaves the database.';

revoke all on function public.read_mobile_round_detail(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.read_mobile_round_detail(uuid)
to authenticated;

create function public.set_mobile_round_participant_rsvp(
  p_round_id uuid,
  p_rsvp_status public.round_rsvp_status,
  p_expected_participant_version bigint,
  p_correlation_id uuid,
  p_operation_id uuid
)
returns table (
  round_id app.entity_id,
  group_id app.entity_id,
  participant_id app.entity_id,
  membership_id app.entity_id,
  rsvp_status public.round_rsvp_status,
  version bigint,
  changed_at app.utc_instant
)
language sql
security definer
set search_path = ''
as $$
  select *
  from public.set_round_participant_rsvp(
    (select auth.uid()),
    p_round_id,
    p_rsvp_status,
    p_expected_participant_version,
    'mobile',
    p_correlation_id,
    p_operation_id
  );
$$;

comment on function public.set_mobile_round_participant_rsvp(
  uuid, public.round_rsvp_status, bigint, uuid, uuid
) is
  'Authenticated actor-derived mobile RSVP. Source is always mobile and all authorization, deadline, stale-version, idempotency, audit, and receipt logic remains in the service-only RPC.';

revoke all on function public.set_mobile_round_participant_rsvp(
  uuid, public.round_rsvp_status, bigint, uuid, uuid
)
from public, anon, authenticated, service_role;
grant execute on function public.set_mobile_round_participant_rsvp(
  uuid, public.round_rsvp_status, bigint, uuid, uuid
)
to authenticated;
