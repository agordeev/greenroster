-- Phase 06: direct actor-derived round summary for result deep links.
--
-- The mobile list is intentionally paged. A notification or historical result
-- link therefore needs an exact, tenant-authorized summary lookup instead of
-- assuming the target round is in the first page of history.

create function public.read_mobile_round_summary(
  p_round_id uuid
)
returns table (
  round_id app.entity_id,
  group_id app.entity_id,
  description text,
  scheduled_at app.utc_instant,
  group_time_zone app.iana_time_zone,
  venue text,
  format public.round_format,
  state public.round_state,
  version bigint,
  participant_status public.round_rsvp_status,
  participant_version bigint,
  participant_count bigint,
  playing_count bigint,
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
    raise exception 'round_summary_context_required' using errcode = '22004';
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
    target_round.format,
    target_round.state,
    target_round.version,
    coalesce(actor_participant.rsvp_status, 'no_response'::public.round_rsvp_status),
    actor_participant.version,
    counts.participant_count,
    counts.playing_count,
    target_round.updated_at
  from (
    select
      count(*)::bigint as participant_count,
      count(*) filter (where participant.rsvp_status = 'playing')::bigint
        as playing_count
    from public.round_participants as participant
    where participant.round_id = target_round.id
      and participant.group_id = target_round.group_id
  ) as counts;
end;
$$;

comment on function public.read_mobile_round_summary(uuid) is
  'Authenticated actor-derived exact round summary for mobile deep links; completed rounds remain readable to active group members while other states require participation, sponsorship, or operational authority.';

revoke all on function public.read_mobile_round_summary(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.read_mobile_round_summary(uuid)
to authenticated;
