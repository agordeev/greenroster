-- Phase 04: server-authoritative round-scoped guest lifecycle.
--
-- Guest rows are participants, never memberships.  The trusted Next.js server
-- calls these RPCs with the verified actor identity.  Raw participant rows
-- remain force-RLS and ungranted to application roles.

-- Member snapshots stay append-only. Guest snapshots are deliberately mutable
-- through the lifecycle RPC before the first score (or by an audited
-- coordinator correction while the round is live). Direct table access remains
-- unavailable to all application roles.
create or replace function app.reject_round_participant_snapshot_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.participant_kind = 'guest'::public.round_participant_kind then
    return new;
  end if;
  raise exception 'round_participant_snapshot_immutable' using errcode = 'P0001';
end;
$$;

revoke all on function app.reject_round_participant_snapshot_mutation()
from public, anon, authenticated, service_role;

create index if not exists round_participants_guest_name_idx
  on public.round_participants (
    group_id,
    round_id,
    participant_kind,
    lower(guest_last_name),
    lower(guest_first_name)
  );

create function app.guest_actor_context(p_actor_user_id uuid)
returns table (
  group_id app.entity_id,
  membership_id app.entity_id,
  actor_role public.membership_role
)
language sql
stable
security definer
set search_path = ''
as $$
  select membership.group_id, membership.id, membership.role
  from public.memberships as membership
  join public.user_profiles as profile on profile.user_id = membership.user_id
  join auth.users as identity on identity.id = membership.user_id
  where membership.user_id = p_actor_user_id
    and membership.status = 'active'
    and profile.disabled_at is null
    and identity.email_confirmed_at is not null
    and identity.deleted_at is null
    and not identity.is_anonymous
    and not (coalesce(identity.raw_app_meta_data, '{}'::jsonb) ? 'greenroster_password_recovery')
    and (identity.banned_until is null or identity.banned_until <= pg_catalog.statement_timestamp());
$$;

revoke all on function app.guest_actor_context(uuid)
from public, anon, authenticated, service_role;

create function public.create_round_guest(
  p_actor_user_id uuid,
  p_round_id uuid,
  p_sponsor_membership_id uuid,
  p_first_name text,
  p_last_name text,
  p_quota_snapshot app.quota_value,
  p_handicap_snapshot app.handicap_value,
  p_tee_snapshot text,
  p_source text,
  p_correlation_id uuid,
  p_operation_id uuid
)
returns table (
  round_id app.entity_id,
  group_id app.entity_id,
  participant_id app.entity_id,
  participant_kind public.round_participant_kind,
  membership_id app.entity_id,
  sponsor_membership_id app.entity_id,
  first_name text,
  last_name text,
  rsvp_status public.round_rsvp_status,
  version bigint,
  quota_snapshot app.quota_value,
  quota_snapshot_source jsonb,
  handicap_snapshot app.handicap_value,
  handicap_snapshot_source public.member_handicap_source,
  handicap_snapshot_as_of date,
  tee_snapshot text,
  duplicate_like boolean,
  changed_at app.utc_instant
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_group_id uuid;
  actor_membership_id uuid;
  actor_role public.membership_role;
  resolved_sponsor_membership_id uuid;
  locked_group public.groups%rowtype;
  locked_round public.rounds%rowtype;
  sponsor_participant public.round_participants%rowtype;
  saved_participant public.round_participants%rowtype;
  prior_event public.audit_events%rowtype;
  normalized_first_name text;
  normalized_last_name text;
  normalized_tee text;
  normalized_source text;
  request_payload jsonb;
  request_fingerprint text;
  provenance jsonb;
  duplicate_like_value boolean;
  changed_at_value timestamptz := pg_catalog.clock_timestamp();
begin
  if p_actor_user_id is null or p_round_id is null then
    raise exception 'guest_context_required' using errcode = '22004';
  end if;
  if p_correlation_id is null or p_operation_id is null then
    raise exception 'operation_context_required' using errcode = '22004';
  end if;

  normalized_source := nullif(pg_catalog.btrim(p_source), '');
  if normalized_source is null or normalized_source not in ('mobile', 'portal') then
    raise exception 'guest_source_invalid' using errcode = '22023';
  end if;
  normalized_first_name := nullif(pg_catalog.btrim(p_first_name), '');
  normalized_last_name := nullif(pg_catalog.btrim(p_last_name), '');
  if normalized_first_name is null or pg_catalog.length(normalized_first_name) > 100
    or normalized_first_name ~ '[[:space:]]{2,}'
  then
    raise exception 'guest_first_name_invalid' using errcode = '22023';
  end if;
  if normalized_last_name is null or pg_catalog.length(normalized_last_name) > 100
    or normalized_last_name ~ '[[:space:]]{2,}'
  then
    raise exception 'guest_last_name_invalid' using errcode = '22023';
  end if;
  normalized_tee := nullif(pg_catalog.lower(pg_catalog.btrim(p_tee_snapshot)), '');
  if normalized_tee is not null and normalized_tee not in ('pro', 'back', 'middle', 'front') then
    raise exception 'guest_tee_invalid' using errcode = '22023';
  end if;

  select actor.group_id, actor.membership_id, actor.actor_role
  into actor_group_id, actor_membership_id, actor_role
  from app.guest_actor_context(p_actor_user_id) as actor
  limit 1;
  if actor_group_id is null then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;
  if exists (
    select 1 from auth.users as identity
    where identity.id = p_actor_user_id
      and coalesce(identity.raw_app_meta_data, '{}'::jsonb) ? 'greenroster_password_recovery'
  ) then
    raise exception 'recovery_session_forbidden' using errcode = 'P0003';
  end if;

  select group_record.* into locked_group
  from public.groups as group_record
  where group_record.id = actor_group_id
  for update;
  if not found then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  select membership.id, membership.role
  into actor_membership_id, actor_role
  from public.memberships as membership
  join public.user_profiles as profile on profile.user_id = membership.user_id
  join auth.users as identity on identity.id = membership.user_id
  where membership.id = actor_membership_id
    and membership.group_id = locked_group.id
    and membership.user_id = p_actor_user_id
    and membership.status = 'active'
    and profile.disabled_at is null
    and identity.email_confirmed_at is not null
    and identity.deleted_at is null
    and not identity.is_anonymous
    and not (coalesce(identity.raw_app_meta_data, '{}'::jsonb) ? 'greenroster_password_recovery')
    and (identity.banned_until is null or identity.banned_until <= changed_at_value)
  for update of membership;
  if not found then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  select round_record.* into locked_round
  from public.rounds as round_record
  where round_record.id = p_round_id
    and round_record.group_id = locked_group.id
  for update;
  if not found then
    raise exception 'round_not_found' using errcode = 'P0002';
  end if;
  if locked_round.state not in ('published', 'live') then
    raise exception 'round_guest_locked' using errcode = 'P0001';
  end if;

  resolved_sponsor_membership_id := coalesce(p_sponsor_membership_id, actor_membership_id);
  select participant.* into sponsor_participant
  from public.round_participants as participant
  join public.memberships as sponsor
    on sponsor.id = participant.membership_id
   and sponsor.group_id = participant.group_id
  where participant.round_id = locked_round.id
    and participant.group_id = locked_group.id
    and participant.membership_id = resolved_sponsor_membership_id
    and participant.participant_kind = 'member'::public.round_participant_kind
    and sponsor.status = 'active'
  for update;
  if not found or sponsor_participant.rsvp_status <> 'playing' then
    raise exception 'guest_sponsor_not_playing' using errcode = 'P0001';
  end if;

  if actor_role = 'member' then
    if resolved_sponsor_membership_id <> actor_membership_id then
      raise exception 'guest_sponsor_not_authorized' using errcode = 'P0003';
    end if;
    if not locked_group.allow_member_guests then
      raise exception 'guest_permission_denied' using errcode = 'P0003';
    end if;
    if locked_round.state <> 'published' then
      raise exception 'round_guest_locked' using errcode = 'P0001';
    end if;
    if (
      locked_round.rsvp_deadline_at is not null
      and changed_at_value >= locked_round.rsvp_deadline_at
    ) or (
      locked_round.rsvp_deadline_at is null
      and locked_round.scheduled_at is not null
      and changed_at_value >= locked_round.scheduled_at
    ) then
      raise exception 'round_guest_closed' using errcode = 'P0001';
    end if;
    if normalized_source <> 'mobile' then
      raise exception 'guest_source_invalid' using errcode = '22023';
    end if;
  end if;

  if locked_round.format = 'individual_net' and p_quota_snapshot is null then
    raise exception 'guest_quota_required' using errcode = '22023';
  end if;

  request_payload := pg_catalog.jsonb_build_object(
    'round_id', p_round_id,
    'sponsor_membership_id', resolved_sponsor_membership_id,
    'first_name', normalized_first_name,
    'last_name', normalized_last_name,
    'quota_snapshot', p_quota_snapshot,
    'handicap_snapshot', p_handicap_snapshot,
    'tee_snapshot', normalized_tee,
    'source', normalized_source
  );
  request_fingerprint := app.member_request_fingerprint(
    request_payload,
    p_actor_user_id::text || ':' || p_operation_id::text
  );

  select event.* into prior_event
  from public.audit_events as event
  where event.group_id = locked_group.id
    and event.actor_user_id = p_actor_user_id
    and event.action = 'round.guest_created'
    and event.operation_id = p_operation_id;
  if found then
    if prior_event.after_state ->> 'request_fingerprint' is distinct from request_fingerprint then
      raise exception 'operation_id_reused' using errcode = '23505';
    end if;
    return query
    select
      (prior_event.after_state ->> 'round_id')::app.entity_id,
      prior_event.group_id,
      (prior_event.after_state ->> 'participant_id')::app.entity_id,
      'guest'::public.round_participant_kind,
      null::app.entity_id,
      (prior_event.after_state ->> 'sponsor_membership_id')::app.entity_id,
      prior_event.after_state ->> 'first_name',
      prior_event.after_state ->> 'last_name',
      'playing'::public.round_rsvp_status,
      (prior_event.after_state ->> 'version')::bigint,
      (prior_event.after_state ->> 'quota_snapshot')::app.quota_value,
      prior_event.after_state -> 'quota_snapshot_source',
      (prior_event.after_state ->> 'handicap_snapshot')::app.handicap_value,
      (prior_event.after_state ->> 'handicap_snapshot_source')::public.member_handicap_source,
      (prior_event.after_state ->> 'handicap_snapshot_as_of')::date,
      prior_event.after_state ->> 'tee_snapshot',
      coalesce((prior_event.after_state ->> 'duplicate_like')::boolean, false),
      (prior_event.after_state ->> 'changed_at')::app.utc_instant;
    return;
  end if;

  duplicate_like_value := exists (
    select 1
    from public.round_participants as existing_guest
    where existing_guest.round_id = locked_round.id
      and existing_guest.group_id = locked_group.id
      and existing_guest.participant_kind = 'guest'::public.round_participant_kind
      and lower(existing_guest.guest_first_name) = lower(normalized_first_name)
      and lower(existing_guest.guest_last_name) = lower(normalized_last_name)
  );
  provenance := pg_catalog.jsonb_build_object(
    'source', 'guest_input',
    'actor_user_id', p_actor_user_id,
    'sponsor_membership_id', resolved_sponsor_membership_id,
    'operation_id', p_operation_id,
    'captured_at', changed_at_value
  );

  insert into public.round_participants (
    round_id, group_id, membership_id, participant_kind,
    sponsor_membership_id, guest_first_name, guest_last_name,
    rsvp_status, quota_snapshot, quota_snapshot_source,
    handicap_snapshot, handicap_snapshot_source, handicap_snapshot_as_of,
    tee_snapshot
  )
  values (
    locked_round.id, locked_group.id, null, 'guest'::public.round_participant_kind,
    resolved_sponsor_membership_id, normalized_first_name, normalized_last_name,
    'playing'::public.round_rsvp_status, p_quota_snapshot, provenance,
    p_handicap_snapshot,
    case when p_handicap_snapshot is null then null else 'manual'::public.member_handicap_source end,
    case when p_handicap_snapshot is null then null else changed_at_value::date end,
    normalized_tee
  )
  returning * into saved_participant;

  insert into public.audit_events (
    group_id, actor_user_id, action, target_type, target_id, target_version,
    before_state, after_state, source, correlation_id, operation_id
  )
  values (
    locked_group.id, p_actor_user_id, 'round.guest_created', 'round_participant',
    saved_participant.id, saved_participant.version,
    pg_catalog.jsonb_build_object('rsvp_status', 'no_response'),
    pg_catalog.jsonb_build_object(
      'round_id', saved_participant.round_id,
      'group_id', saved_participant.group_id,
      'participant_id', saved_participant.id,
      'participant_kind', saved_participant.participant_kind,
      'sponsor_membership_id', saved_participant.sponsor_membership_id,
      'first_name', saved_participant.guest_first_name,
      'last_name', saved_participant.guest_last_name,
      'rsvp_status', saved_participant.rsvp_status,
      'version', saved_participant.version,
      'quota_snapshot', saved_participant.quota_snapshot,
      'quota_snapshot_source', saved_participant.quota_snapshot_source,
      'handicap_snapshot', saved_participant.handicap_snapshot,
      'handicap_snapshot_source', saved_participant.handicap_snapshot_source,
      'handicap_snapshot_as_of', saved_participant.handicap_snapshot_as_of,
      'tee_snapshot', saved_participant.tee_snapshot,
      'duplicate_like', duplicate_like_value,
      'changed_at', changed_at_value,
      'request_fingerprint', request_fingerprint
    ),
    normalized_source, p_correlation_id, p_operation_id
  );

  -- The guest begins Playing. Keep the RSVP event explicit so the event
  -- history has the same shape as a member RSVP change.
  insert into public.audit_events (
    group_id, actor_user_id, action, target_type, target_id, target_version,
    before_state, after_state, source, correlation_id, operation_id
  )
  values (
    locked_group.id, p_actor_user_id, 'round.participant_rsvp_changed',
    'round_participant', saved_participant.id, saved_participant.version,
    pg_catalog.jsonb_build_object(
      'round_id', saved_participant.round_id,
      'participant_id', saved_participant.id,
      'rsvp_status', 'no_response',
      'participant_version', saved_participant.version
    ),
    pg_catalog.jsonb_build_object(
      'round_id', saved_participant.round_id,
      'group_id', saved_participant.group_id,
      'participant_id', saved_participant.id,
      'membership_id', null,
      'sponsor_membership_id', saved_participant.sponsor_membership_id,
      'rsvp_status', saved_participant.rsvp_status,
      'participant_version', saved_participant.version,
      'changed_at', changed_at_value,
      'request_fingerprint', request_fingerprint
    ),
    normalized_source, p_correlation_id, p_operation_id
  );

  return query
  select saved_participant.round_id, saved_participant.group_id,
    saved_participant.id, saved_participant.participant_kind,
    saved_participant.membership_id, saved_participant.sponsor_membership_id,
    saved_participant.guest_first_name, saved_participant.guest_last_name,
    saved_participant.rsvp_status, saved_participant.version,
    saved_participant.quota_snapshot, saved_participant.quota_snapshot_source,
    saved_participant.handicap_snapshot, saved_participant.handicap_snapshot_source,
    saved_participant.handicap_snapshot_as_of, saved_participant.tee_snapshot,
    duplicate_like_value, changed_at_value::app.utc_instant;
end;
$$;

comment on function public.create_round_guest(uuid, uuid, uuid, text, text, app.quota_value, app.handicap_value, text, text, uuid, uuid) is
  'Creates a round-scoped Playing guest atomically with an explicit RSVP audit event; tenant and sponsor authority come from the authenticated membership.';

revoke all on function public.create_round_guest(uuid, uuid, uuid, text, text, app.quota_value, app.handicap_value, text, text, uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.create_round_guest(uuid, uuid, uuid, text, text, app.quota_value, app.handicap_value, text, text, uuid, uuid)
to service_role;

create function public.update_round_guest(
  p_actor_user_id uuid,
  p_participant_id uuid,
  p_first_name text,
  p_last_name text,
  p_quota_snapshot app.quota_value,
  p_handicap_snapshot app.handicap_value,
  p_tee_snapshot text,
  p_expected_participant_version bigint,
  p_reason text,
  p_source text,
  p_correlation_id uuid,
  p_operation_id uuid
)
returns table (
  round_id app.entity_id,
  group_id app.entity_id,
  participant_id app.entity_id,
  participant_kind public.round_participant_kind,
  membership_id app.entity_id,
  sponsor_membership_id app.entity_id,
  first_name text,
  last_name text,
  rsvp_status public.round_rsvp_status,
  version bigint,
  quota_snapshot app.quota_value,
  quota_snapshot_source jsonb,
  handicap_snapshot app.handicap_value,
  handicap_snapshot_source public.member_handicap_source,
  handicap_snapshot_as_of date,
  tee_snapshot text,
  duplicate_like boolean,
  changed_at app.utc_instant
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_group_id uuid;
  actor_membership_id uuid;
  actor_role public.membership_role;
  locked_group public.groups%rowtype;
  locked_round public.rounds%rowtype;
  locked_participant public.round_participants%rowtype;
  saved_participant public.round_participants%rowtype;
  prior_event public.audit_events%rowtype;
  normalized_first_name text;
  normalized_last_name text;
  normalized_tee text;
  normalized_source text;
  normalized_reason text;
  request_payload jsonb;
  request_fingerprint text;
  duplicate_like_value boolean;
  score_exists boolean := false;
  snapshots_changed boolean;
  changed_at_value timestamptz := pg_catalog.clock_timestamp();
begin
  if p_actor_user_id is null or p_participant_id is null then
    raise exception 'guest_context_required' using errcode = '22004';
  end if;
  if p_expected_participant_version is null or p_expected_participant_version < 1 then
    raise exception 'guest_version_invalid' using errcode = '22023';
  end if;
  if p_correlation_id is null or p_operation_id is null then
    raise exception 'operation_context_required' using errcode = '22004';
  end if;
  normalized_source := nullif(pg_catalog.btrim(p_source), '');
  if normalized_source is null or normalized_source not in ('mobile', 'portal') then
    raise exception 'guest_source_invalid' using errcode = '22023';
  end if;
  normalized_reason := nullif(pg_catalog.btrim(p_reason), '');
  if normalized_reason is not null and pg_catalog.length(normalized_reason) > 500 then
    raise exception 'guest_reason_invalid' using errcode = '22023';
  end if;
  normalized_first_name := nullif(pg_catalog.btrim(p_first_name), '');
  normalized_last_name := nullif(pg_catalog.btrim(p_last_name), '');
  if normalized_first_name is null or pg_catalog.length(normalized_first_name) > 100
    or normalized_first_name ~ '[[:space:]]{2,}'
  then
    raise exception 'guest_first_name_invalid' using errcode = '22023';
  end if;
  if normalized_last_name is null or pg_catalog.length(normalized_last_name) > 100
    or normalized_last_name ~ '[[:space:]]{2,}'
  then
    raise exception 'guest_last_name_invalid' using errcode = '22023';
  end if;
  normalized_tee := nullif(pg_catalog.lower(pg_catalog.btrim(p_tee_snapshot)), '');
  if normalized_tee is not null and normalized_tee not in ('pro', 'back', 'middle', 'front') then
    raise exception 'guest_tee_invalid' using errcode = '22023';
  end if;

  select actor.group_id, actor.membership_id, actor.actor_role
  into actor_group_id, actor_membership_id, actor_role
  from app.guest_actor_context(p_actor_user_id) as actor
  limit 1;
  if actor_group_id is null then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;
  if exists (
    select 1 from auth.users as identity
    where identity.id = p_actor_user_id
      and coalesce(identity.raw_app_meta_data, '{}'::jsonb) ? 'greenroster_password_recovery'
  ) then
    raise exception 'recovery_session_forbidden' using errcode = 'P0003';
  end if;
  select group_record.* into locked_group
  from public.groups as group_record
  where group_record.id = actor_group_id
  for update;
  if not found then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;
  select membership.role into actor_role
  from public.memberships as membership
  join public.user_profiles as profile on profile.user_id = membership.user_id
  join auth.users as identity on identity.id = membership.user_id
  where membership.id = actor_membership_id
    and membership.group_id = locked_group.id
    and membership.user_id = p_actor_user_id
    and membership.status = 'active'
    and profile.disabled_at is null
    and identity.email_confirmed_at is not null
    and identity.deleted_at is null
    and not identity.is_anonymous
    and not (coalesce(identity.raw_app_meta_data, '{}'::jsonb) ? 'greenroster_password_recovery')
    and (identity.banned_until is null or identity.banned_until <= changed_at_value)
  for update of membership;
  if not found then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  select participant.* into locked_participant
  from public.round_participants as participant
  where participant.id = p_participant_id
    and participant.group_id = locked_group.id
  for update;
  if not found or locked_participant.participant_kind <> 'guest'::public.round_participant_kind then
    raise exception 'guest_not_found' using errcode = 'P0002';
  end if;
  select round_record.* into locked_round
  from public.rounds as round_record
  where round_record.id = locked_participant.round_id
    and round_record.group_id = locked_group.id
  for update;
  if not found then
    raise exception 'round_not_found' using errcode = 'P0002';
  end if;
  if locked_round.state not in ('published', 'live') then
    raise exception 'round_guest_locked' using errcode = 'P0001';
  end if;

  request_payload := pg_catalog.jsonb_build_object(
    'participant_id', p_participant_id,
    'first_name', normalized_first_name,
    'last_name', normalized_last_name,
    'quota_snapshot', p_quota_snapshot,
    'handicap_snapshot', p_handicap_snapshot,
    'tee_snapshot', normalized_tee,
    'expected_participant_version', p_expected_participant_version,
    'reason', normalized_reason,
    'source', normalized_source
  );
  request_fingerprint := app.member_request_fingerprint(
    request_payload,
    p_actor_user_id::text || ':' || p_operation_id::text
  );
  select event.* into prior_event
  from public.audit_events as event
  where event.group_id = locked_group.id
    and event.actor_user_id = p_actor_user_id
    and event.action = 'round.guest_updated'
    and event.target_id = p_participant_id
    and event.operation_id = p_operation_id;
  if found then
    if prior_event.after_state ->> 'request_fingerprint' is distinct from request_fingerprint then
      raise exception 'operation_id_reused' using errcode = '23505';
    end if;
    return query
    select
      (prior_event.after_state ->> 'round_id')::app.entity_id,
      prior_event.group_id,
      (prior_event.after_state ->> 'participant_id')::app.entity_id,
      'guest'::public.round_participant_kind,
      null::app.entity_id,
      (prior_event.after_state ->> 'sponsor_membership_id')::app.entity_id,
      prior_event.after_state ->> 'first_name', prior_event.after_state ->> 'last_name',
      (prior_event.after_state ->> 'rsvp_status')::public.round_rsvp_status,
      (prior_event.after_state ->> 'version')::bigint,
      (prior_event.after_state ->> 'quota_snapshot')::app.quota_value,
      prior_event.after_state -> 'quota_snapshot_source',
      (prior_event.after_state ->> 'handicap_snapshot')::app.handicap_value,
      (prior_event.after_state ->> 'handicap_snapshot_source')::public.member_handicap_source,
      (prior_event.after_state ->> 'handicap_snapshot_as_of')::date,
      prior_event.after_state ->> 'tee_snapshot',
      coalesce((prior_event.after_state ->> 'duplicate_like')::boolean, false),
      (prior_event.after_state ->> 'changed_at')::app.utc_instant;
    return;
  end if;

  if actor_role = 'member' then
    if normalized_source <> 'mobile'
      or locked_round.state <> 'published'
      or locked_participant.sponsor_membership_id <> actor_membership_id
    then
      raise exception 'guest_actor_not_authorized' using errcode = 'P0003';
    end if;
  elsif actor_role not in ('coordinator', 'administrator') then
    raise exception 'guest_actor_not_authorized' using errcode = 'P0003';
  end if;
  perform 1
  from public.participant_score_projections as projection
  where projection.participant_id = locked_participant.id
    and projection.group_id = locked_group.id
  for update;
  score_exists := found;
  snapshots_changed := locked_participant.quota_snapshot is distinct from p_quota_snapshot
    or locked_participant.handicap_snapshot is distinct from p_handicap_snapshot;
  if score_exists and snapshots_changed then
    raise exception 'guest_snapshot_locked' using errcode = 'P0001';
  end if;
  if actor_role <> 'member' and (locked_round.state = 'live' or score_exists)
    and normalized_reason is null
  then
    raise exception 'guest_reason_required' using errcode = '22023';
  end if;
  if locked_round.format = 'individual_net' and p_quota_snapshot is null then
    raise exception 'guest_quota_required' using errcode = '22023';
  end if;

  duplicate_like_value := exists (
    select 1 from public.round_participants as existing_guest
    where existing_guest.round_id = locked_round.id
      and existing_guest.group_id = locked_group.id
      and existing_guest.participant_kind = 'guest'::public.round_participant_kind
      and existing_guest.id <> locked_participant.id
      and lower(existing_guest.guest_first_name) = lower(normalized_first_name)
      and lower(existing_guest.guest_last_name) = lower(normalized_last_name)
  );
  update public.round_participants as participant
  set guest_first_name = normalized_first_name,
      guest_last_name = normalized_last_name,
      quota_snapshot = p_quota_snapshot,
      quota_snapshot_source = case
        when p_quota_snapshot is null then null
        else pg_catalog.jsonb_build_object(
          'source', 'guest_input',
          'actor_user_id', p_actor_user_id,
          'sponsor_membership_id', locked_participant.sponsor_membership_id,
          'operation_id', p_operation_id,
          'captured_at', changed_at_value
        )
      end,
      handicap_snapshot = p_handicap_snapshot,
      handicap_snapshot_source = case
        when p_handicap_snapshot is null then null
        else 'manual'::public.member_handicap_source
      end,
      handicap_snapshot_as_of = case
        when p_handicap_snapshot is null then null else changed_at_value::date end,
      tee_snapshot = normalized_tee,
      version = locked_participant.version + 1
  where participant.id = locked_participant.id
    and participant.group_id = locked_group.id
  returning * into saved_participant;

  insert into public.audit_events (
    group_id, actor_user_id, action, target_type, target_id, target_version,
    before_state, after_state, source, correlation_id, operation_id, reason
  )
  values (
    locked_group.id, p_actor_user_id, 'round.guest_updated', 'round_participant',
    saved_participant.id, saved_participant.version,
    pg_catalog.jsonb_build_object(
      'round_id', locked_participant.round_id,
      'participant_id', locked_participant.id,
      'first_name', locked_participant.guest_first_name,
      'last_name', locked_participant.guest_last_name,
      'rsvp_status', locked_participant.rsvp_status,
      'quota_snapshot', locked_participant.quota_snapshot,
      'handicap_snapshot', locked_participant.handicap_snapshot,
      'tee_snapshot', locked_participant.tee_snapshot,
      'version', locked_participant.version
    ),
    pg_catalog.jsonb_build_object(
      'round_id', saved_participant.round_id,
      'group_id', saved_participant.group_id,
      'participant_id', saved_participant.id,
      'sponsor_membership_id', saved_participant.sponsor_membership_id,
      'first_name', saved_participant.guest_first_name,
      'last_name', saved_participant.guest_last_name,
      'rsvp_status', saved_participant.rsvp_status,
      'version', saved_participant.version,
      'quota_snapshot', saved_participant.quota_snapshot,
      'quota_snapshot_source', saved_participant.quota_snapshot_source,
      'handicap_snapshot', saved_participant.handicap_snapshot,
      'handicap_snapshot_source', saved_participant.handicap_snapshot_source,
      'handicap_snapshot_as_of', saved_participant.handicap_snapshot_as_of,
      'tee_snapshot', saved_participant.tee_snapshot,
      'duplicate_like', duplicate_like_value,
      'changed_at', changed_at_value,
      'request_fingerprint', request_fingerprint
    ),
    normalized_source, p_correlation_id, p_operation_id, normalized_reason
  );

  return query
  select saved_participant.round_id, saved_participant.group_id,
    saved_participant.id, saved_participant.participant_kind,
    saved_participant.membership_id, saved_participant.sponsor_membership_id,
    saved_participant.guest_first_name, saved_participant.guest_last_name,
    saved_participant.rsvp_status, saved_participant.version,
    saved_participant.quota_snapshot, saved_participant.quota_snapshot_source,
    saved_participant.handicap_snapshot, saved_participant.handicap_snapshot_source,
    saved_participant.handicap_snapshot_as_of, saved_participant.tee_snapshot,
    duplicate_like_value, changed_at_value::app.utc_instant;
end;
$$;

comment on function public.update_round_guest(uuid, uuid, text, text, app.quota_value, app.handicap_value, text, bigint, text, text, uuid, uuid) is
  'Updates a round-scoped guest with sponsor/coordinator authority, first-score locking, optimistic versioning, provenance, and an audit record.';

revoke all on function public.update_round_guest(uuid, uuid, text, text, app.quota_value, app.handicap_value, text, bigint, text, text, uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.update_round_guest(uuid, uuid, text, text, app.quota_value, app.handicap_value, text, bigint, text, text, uuid, uuid)
to service_role;

create function public.withdraw_round_guest(
  p_actor_user_id uuid,
  p_round_id uuid,
  p_participant_id uuid,
  p_expected_participant_version bigint,
  p_confirmed boolean,
  p_reason text,
  p_source text,
  p_correlation_id uuid,
  p_operation_id uuid
)
returns table (
  round_id app.entity_id,
  group_id app.entity_id,
  participant_id app.entity_id,
  participant_kind public.round_participant_kind,
  membership_id app.entity_id,
  sponsor_membership_id app.entity_id,
  rsvp_status public.round_rsvp_status,
  version bigint,
  score_invalidated boolean,
  changed_at app.utc_instant
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_group_id uuid;
  actor_membership_id uuid;
  actor_role public.membership_role;
  locked_group public.groups%rowtype;
  locked_round public.rounds%rowtype;
  locked_participant public.round_participants%rowtype;
  locked_projection public.participant_score_projections%rowtype;
  saved_participant public.round_participants%rowtype;
  prior_event public.audit_events%rowtype;
  normalized_source text;
  normalized_reason text;
  request_payload jsonb;
  request_fingerprint text;
  score_invalidated_value boolean := false;
  changed_at_value timestamptz := pg_catalog.clock_timestamp();
begin
  if p_actor_user_id is null or p_round_id is null or p_participant_id is null then
    raise exception 'guest_context_required' using errcode = '22004';
  end if;
  if p_expected_participant_version is null or p_expected_participant_version < 1 then
    raise exception 'guest_version_invalid' using errcode = '22023';
  end if;
  if p_confirmed is distinct from true then
    raise exception 'guest_withdraw_confirmation_required' using errcode = '22023';
  end if;
  if p_correlation_id is null or p_operation_id is null then
    raise exception 'operation_context_required' using errcode = '22004';
  end if;
  normalized_source := nullif(pg_catalog.btrim(p_source), '');
  if normalized_source is null or normalized_source not in ('mobile', 'portal') then
    raise exception 'guest_source_invalid' using errcode = '22023';
  end if;
  normalized_reason := nullif(pg_catalog.btrim(p_reason), '');
  if normalized_reason is null or pg_catalog.length(normalized_reason) > 500 then
    raise exception 'guest_withdraw_reason_required' using errcode = '22023';
  end if;

  select actor.group_id, actor.membership_id, actor.actor_role
  into actor_group_id, actor_membership_id, actor_role
  from app.guest_actor_context(p_actor_user_id) as actor
  limit 1;
  if actor_group_id is null then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;
  if exists (
    select 1 from auth.users as identity
    where identity.id = p_actor_user_id
      and coalesce(identity.raw_app_meta_data, '{}'::jsonb) ? 'greenroster_password_recovery'
  ) then
    raise exception 'recovery_session_forbidden' using errcode = 'P0003';
  end if;
  select group_record.* into locked_group
  from public.groups as group_record
  where group_record.id = actor_group_id
  for update;
  if not found then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;
  select participant.* into locked_participant
  from public.round_participants as participant
  where participant.id = p_participant_id
    and participant.round_id = p_round_id
    and participant.group_id = locked_group.id
  for update;
  if not found or locked_participant.participant_kind <> 'guest'::public.round_participant_kind then
    raise exception 'guest_not_found' using errcode = 'P0002';
  end if;
  select round_record.* into locked_round
  from public.rounds as round_record
  where round_record.id = p_round_id and round_record.group_id = locked_group.id
  for update;
  if not found then
    raise exception 'round_not_found' using errcode = 'P0002';
  end if;
  if locked_round.state not in ('published', 'live') then
    raise exception 'round_guest_locked' using errcode = 'P0001';
  end if;

  request_payload := pg_catalog.jsonb_build_object(
    'round_id', p_round_id,
    'participant_id', p_participant_id,
    'expected_participant_version', p_expected_participant_version,
    'confirmed', p_confirmed,
    'reason', normalized_reason,
    'source', normalized_source
  );
  request_fingerprint := app.member_request_fingerprint(
    request_payload,
    p_actor_user_id::text || ':' || p_operation_id::text
  );
  select event.* into prior_event
  from public.audit_events as event
  where event.group_id = locked_group.id
    and event.actor_user_id = p_actor_user_id
    and event.action = 'round.guest_withdrawn'
    and event.target_id = p_participant_id
    and event.operation_id = p_operation_id;
  if found then
    if prior_event.after_state ->> 'request_fingerprint' is distinct from request_fingerprint then
      raise exception 'operation_id_reused' using errcode = '23505';
    end if;
    return query
    select
      (prior_event.after_state ->> 'round_id')::app.entity_id,
      prior_event.group_id,
      (prior_event.after_state ->> 'participant_id')::app.entity_id,
      'guest'::public.round_participant_kind,
      null::app.entity_id,
      (prior_event.after_state ->> 'sponsor_membership_id')::app.entity_id,
      'not_playing'::public.round_rsvp_status,
      (prior_event.after_state ->> 'version')::bigint,
      coalesce((prior_event.after_state ->> 'score_invalidated')::boolean, false),
      (prior_event.after_state ->> 'changed_at')::app.utc_instant;
    return;
  end if;
  if locked_participant.version <> p_expected_participant_version then
    raise exception 'guest_version_changed' using errcode = '40001';
  end if;
  if locked_participant.rsvp_status <> 'playing'::public.round_rsvp_status then
    raise exception 'guest_not_playing' using errcode = 'P0001';
  end if;
  if actor_role = 'member' then
    if locked_round.state <> 'published'
      or normalized_source <> 'mobile'
      or locked_participant.sponsor_membership_id <> actor_membership_id
    then
      raise exception 'guest_actor_not_authorized' using errcode = 'P0003';
    end if;
  elsif actor_role not in ('coordinator', 'administrator') then
    raise exception 'guest_actor_not_authorized' using errcode = 'P0003';
  end if;

  select projection.* into locked_projection
  from public.participant_score_projections as projection
  where projection.participant_id = locked_participant.id
    and projection.round_id = locked_round.id
    and projection.group_id = locked_group.id
  for update;
  if found then
    if actor_role = 'member' then
      raise exception 'guest_score_lock' using errcode = 'P0001';
    end if;
    score_invalidated_value := true;
  end if;
  update public.round_participants as participant
  set rsvp_status = 'not_playing', version = locked_participant.version + 1
  where participant.id = locked_participant.id and participant.group_id = locked_group.id
  returning * into saved_participant;
  if score_invalidated_value then
    delete from public.participant_score_projections as projection
    where projection.participant_id = locked_participant.id
      and projection.round_id = locked_round.id
      and projection.group_id = locked_group.id;
  end if;

  insert into public.audit_events (
    group_id, actor_user_id, action, target_type, target_id, target_version,
    before_state, after_state, source, correlation_id, operation_id, reason
  )
  values (
    locked_group.id, p_actor_user_id, 'round.guest_withdrawn', 'round_participant',
    saved_participant.id, saved_participant.version,
    pg_catalog.jsonb_build_object(
      'round_id', locked_participant.round_id,
      'participant_id', locked_participant.id,
      'rsvp_status', locked_participant.rsvp_status,
      'participant_version', locked_participant.version,
      'score_projection_version', case when score_invalidated_value then locked_projection.version else null end,
      'score_revision_id', case when score_invalidated_value then locked_projection.last_revision_id else null end
    ),
    pg_catalog.jsonb_build_object(
      'round_id', saved_participant.round_id,
      'group_id', saved_participant.group_id,
      'participant_id', saved_participant.id,
      'sponsor_membership_id', saved_participant.sponsor_membership_id,
      'rsvp_status', saved_participant.rsvp_status,
      'version', saved_participant.version,
      'score_invalidated', score_invalidated_value,
      'changed_at', changed_at_value,
      'request_fingerprint', request_fingerprint
    ),
    normalized_source, p_correlation_id, p_operation_id, normalized_reason
  );
  insert into public.audit_events (
    group_id, actor_user_id, action, target_type, target_id, target_version,
    before_state, after_state, source, correlation_id, operation_id, reason
  )
  values (
    locked_group.id, p_actor_user_id, 'round.participant_rsvp_changed',
    'round_participant', saved_participant.id, saved_participant.version,
    pg_catalog.jsonb_build_object(
      'round_id', saved_participant.round_id,
      'participant_id', saved_participant.id,
      'rsvp_status', locked_participant.rsvp_status,
      'participant_version', locked_participant.version
    ),
    pg_catalog.jsonb_build_object(
      'round_id', saved_participant.round_id,
      'group_id', saved_participant.group_id,
      'participant_id', saved_participant.id,
      'membership_id', null,
      'sponsor_membership_id', saved_participant.sponsor_membership_id,
      'rsvp_status', saved_participant.rsvp_status,
      'participant_version', saved_participant.version,
      'score_invalidated', score_invalidated_value,
      'changed_at', changed_at_value,
      'request_fingerprint', request_fingerprint
    ),
    normalized_source, p_correlation_id, p_operation_id, normalized_reason
  );

  return query
  select saved_participant.round_id, saved_participant.group_id,
    saved_participant.id, saved_participant.participant_kind,
    saved_participant.membership_id, saved_participant.sponsor_membership_id,
    saved_participant.rsvp_status, saved_participant.version,
    score_invalidated_value, changed_at_value::app.utc_instant;
end;
$$;

comment on function public.withdraw_round_guest(uuid, uuid, uuid, bigint, boolean, text, text, uuid, uuid) is
  'Withdraws a guest without deleting history; sponsors may withdraw before Live and coordinators/admins may correct a Published or Live round with audit.';

revoke all on function public.withdraw_round_guest(uuid, uuid, uuid, bigint, boolean, text, text, uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.withdraw_round_guest(uuid, uuid, uuid, bigint, boolean, text, text, uuid, uuid)
to service_role;
