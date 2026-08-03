-- Phase 04: service-only member-web Next round projection.
--
-- Members receive only the next upcoming Published round for their own
-- membership.  The projection is deliberately a narrow JSON envelope: raw
-- tenant tables remain force-RLS and ungranted to application roles, while
-- the trusted Next.js server calls this security-definer boundary.

create function public.read_member_next_round(
  p_actor_user_id uuid
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
  v_now timestamptz := pg_catalog.statement_timestamp();
begin
  if p_actor_user_id is null then
    raise exception 'member_next_round_context_required' using errcode = '22004';
  end if;

  -- A password-recovery session is not an application session.  Check this
  -- before the membership lookup so a recovery identity cannot use a still
  -- active membership to read tenant data.
  if exists (
    select 1
    from auth.users as identity
    where identity.id = p_actor_user_id
      and coalesce(identity.raw_app_meta_data, '{}'::jsonb)
        ? 'greenroster_password_recovery'
  ) then
    raise exception 'recovery_session_forbidden' using errcode = 'P0003';
  end if;

  -- Resolve both tenant and role from the authenticated identity.  Only an
  -- active, verified ordinary member may use this member-web projection;
  -- coordinators and administrators are intentionally denied so their web
  -- handoff remains the only path for coordinator capabilities.
  select membership.group_id, membership.id
  into actor_group_id, actor_membership_id
  from public.memberships as membership
  join public.user_profiles as profile
    on profile.user_id = membership.user_id
  join auth.users as identity
    on identity.id = membership.user_id
  where membership.user_id = p_actor_user_id
    and membership.role = 'member'
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
      or identity.banned_until <= v_now
    )
  order by membership.id
  limit 1;

  if actor_group_id is null or actor_membership_id is null then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  -- A missing round produces NULL, not an error: the member-web page can
  -- render its no-upcoming-round state without learning about other groups.
  -- Ordering by the absolute UTC start and then the immutable id makes the
  -- result deterministic when two rounds share a scheduled instant.
  return (
    select pg_catalog.jsonb_build_object(
      'round_id', round_record.id,
      'group_id', round_record.group_id,
      'description', round_record.description,
      'scheduled_at', round_record.scheduled_at,
      'group_time_zone', round_record.group_time_zone,
      'venue', round_record.venue,
      'notes', case
        when round_record.notes_visible_to_players then round_record.notes
        else null
      end,
      'format', round_record.format,
      'rsvp_deadline_at', round_record.rsvp_deadline_at,
      'participant', pg_catalog.jsonb_build_object(
        'rsvp_status', participant.rsvp_status,
        'version', participant.version,
        'changed_at', rsvp_change.changed_at
      )
    )
    from public.rounds as round_record
    join public.round_participants as participant
      on participant.round_id = round_record.id
     and participant.group_id = round_record.group_id
     and participant.membership_id = actor_membership_id
    left join lateral (
      select coalesce(
        nullif(event.after_state ->> 'changed_at', '')::timestamptz,
        event.occurred_at
      ) as changed_at
      from public.audit_events as event
      where event.group_id = round_record.group_id
        and event.action = 'round.participant_rsvp_changed'
        and event.target_id = participant.id
      order by event.occurred_at desc, event.id desc
      limit 1
    ) as rsvp_change on true
    where round_record.group_id = actor_group_id
      and round_record.state = 'published'
      and round_record.scheduled_at >= v_now
    order by round_record.scheduled_at asc, round_record.id asc
    limit 1
  );
end;
$$;

comment on function public.read_member_next_round(uuid) is
  'Service-only member-web projection of the next upcoming Published round and the caller membership RSVP state/version.';

revoke all on function public.read_member_next_round(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.read_member_next_round(uuid)
to service_role;
