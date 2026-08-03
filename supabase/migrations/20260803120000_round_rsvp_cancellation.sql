-- Phase 03: published-round member RSVP, coordinator cancellation, and
-- durable cancellation e-mail work.
--
-- The trusted server calls these RPCs with the verified actor identity. Raw
-- participant, round, and notification tables remain force-RLS and ungranted
-- to application roles.

alter table public.rounds
  add column cancellation_reason text;

alter table public.rounds
  add constraint rounds_cancellation_reason_valid check (
    cancellation_reason is null
    or (
      pg_catalog.btrim(cancellation_reason) = cancellation_reason
      and pg_catalog.length(cancellation_reason) between 1 and 500
    )
  );

alter table public.rounds
  drop constraint rounds_cancelled_has_timestamp;

alter table public.rounds
  add constraint rounds_cancellation_state_consistent check (
    (
      state = 'cancelled'
      and cancelled_at is not null
      and cancellation_reason is not null
    )
    or (
      state <> 'cancelled'
      and cancelled_at is null
      and cancellation_reason is null
    )
  );

comment on column public.rounds.cancellation_reason is
  'Coordinator-supplied reason retained with the readable cancelled round.';

-- Participant versions make concurrent member retries deterministic without
-- exposing a direct table write path. Existing published rows start at one.
alter table public.round_participants
  add column version bigint not null default 1;

alter table public.round_participants
  add constraint round_participants_version_positive check (version > 0);

create function app.bump_round_participant_version()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.version = old.version then
    new.version := old.version + 1;
  end if;
  return new;
end;
$$;

revoke all on function app.bump_round_participant_version()
from public, anon, authenticated, service_role;

create trigger round_participants_bump_version
before update of rsvp_status, version on public.round_participants
for each row execute function app.bump_round_participant_version();

create function public.set_round_participant_rsvp(
  p_actor_user_id uuid,
  p_round_id uuid,
  p_rsvp_status public.round_rsvp_status,
  p_expected_participant_version bigint,
  p_source text,
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
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_group_id uuid;
  actor_membership_id uuid;
  target_round public.rounds%rowtype;
  locked_participant public.round_participants%rowtype;
  saved_participant public.round_participants%rowtype;
  prior_event public.audit_events%rowtype;
  request_payload jsonb;
  request_fingerprint text;
  normalized_source text;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_actor_user_id is null or p_round_id is null or p_rsvp_status is null then
    raise exception 'rsvp_context_required' using errcode = '22004';
  end if;
  if p_correlation_id is null or p_operation_id is null then
    raise exception 'operation_context_required' using errcode = '22004';
  end if;
  if p_expected_participant_version is null or p_expected_participant_version < 1 then
    raise exception 'rsvp_version_invalid' using errcode = '22023';
  end if;
  normalized_source := nullif(pg_catalog.btrim(p_source), '');
  if normalized_source not in ('mobile', 'member_web') then
    raise exception 'rsvp_source_invalid' using errcode = '22023';
  end if;
  if p_rsvp_status = 'no_response' then
    raise exception 'rsvp_status_invalid' using errcode = '22023';
  end if;

  if exists (
    select 1
    from auth.users as identity
    where identity.id = p_actor_user_id
      and coalesce(identity.raw_app_meta_data, '{}'::jsonb) ? 'greenroster_password_recovery'
  ) then
    raise exception 'recovery_session_forbidden' using errcode = 'P0003';
  end if;

  select membership.group_id, membership.id
  into actor_group_id, actor_membership_id
  from public.memberships as membership
  join public.user_profiles as profile on profile.user_id = membership.user_id
  join auth.users as identity on identity.id = membership.user_id
  where membership.user_id = p_actor_user_id
    and membership.status = 'active'
    and profile.disabled_at is null
    and identity.email_confirmed_at is not null
    and identity.deleted_at is null
    and not identity.is_anonymous
    and (identity.banned_until is null or identity.banned_until <= v_now)
  order by membership.id
  limit 1;
  if actor_group_id is null then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  -- Serialize tenant and round state before resolving the participant. The
  -- client never supplies a group and a cross-group round is indistinguishable
  -- from a missing round.
  perform 1 from public.groups where id = actor_group_id for update;
  if not found then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  -- Membership/profile/identity state can change while the initial actor
  -- lookup waits for the tenant lock. Re-read and lock the actor membership
  -- after serialization so a concurrent deactivation, disablement, ban, or
  -- recovery-session transition cannot pass the mutation boundary.
  v_now := pg_catalog.clock_timestamp();
  if exists (
    select 1
    from auth.users as identity
    where identity.id = p_actor_user_id
      and coalesce(identity.raw_app_meta_data, '{}'::jsonb) ? 'greenroster_password_recovery'
  ) then
    raise exception 'recovery_session_forbidden' using errcode = 'P0003';
  end if;
  select membership.id
  into actor_membership_id
  from public.memberships as membership
  join public.user_profiles as profile on profile.user_id = membership.user_id
  join auth.users as identity on identity.id = membership.user_id
  where membership.id = actor_membership_id
    and membership.group_id = actor_group_id
    and membership.user_id = p_actor_user_id
    and membership.status = 'active'
    and profile.disabled_at is null
    and identity.email_confirmed_at is not null
    and identity.deleted_at is null
    and not identity.is_anonymous
    and not (coalesce(identity.raw_app_meta_data, '{}'::jsonb) ? 'greenroster_password_recovery')
    and (identity.banned_until is null or identity.banned_until <= v_now)
  for update of membership;
  if not found then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  select round_record.*
  into target_round
  from public.rounds as round_record
  where round_record.id = p_round_id
    and round_record.group_id = actor_group_id
  for update;
  if not found then
    raise exception 'round_not_found' using errcode = 'P0002';
  end if;

  select participant.*
  into locked_participant
  from public.round_participants as participant
  where participant.round_id = target_round.id
    and participant.group_id = target_round.group_id
    and participant.membership_id = actor_membership_id
  for update;
  if not found then
    raise exception 'participant_not_found' using errcode = 'P0002';
  end if;

  request_payload := pg_catalog.jsonb_build_object(
    'round_id', p_round_id,
    'participant_id', locked_participant.id,
    'rsvp_status', p_rsvp_status::text,
    'expected_participant_version', p_expected_participant_version,
    'source', normalized_source
  );
  request_fingerprint := app.member_request_fingerprint(
    request_payload,
    p_actor_user_id::text || ':' || p_operation_id::text
  );

  select event.*
  into prior_event
  from public.audit_events as event
  where event.group_id = target_round.group_id
    and event.actor_user_id = p_actor_user_id
    and event.action = 'round.participant_rsvp_changed'
    and event.target_id = locked_participant.id
    and event.operation_id = p_operation_id;
  if found then
    if prior_event.after_state ->> 'request_fingerprint' <> request_fingerprint then
      raise exception 'operation_id_reused' using errcode = '23505';
    end if;
    return query
    select
      (prior_event.after_state ->> 'round_id')::app.entity_id,
      (prior_event.after_state ->> 'group_id')::app.entity_id,
      (prior_event.after_state ->> 'participant_id')::app.entity_id,
      (prior_event.after_state ->> 'membership_id')::app.entity_id,
      (prior_event.after_state ->> 'rsvp_status')::public.round_rsvp_status,
      (prior_event.after_state ->> 'participant_version')::bigint,
      (prior_event.after_state ->> 'changed_at')::app.utc_instant;
    return;
  end if;

  if target_round.state <> 'published' then
    raise exception 'round_rsvp_closed' using errcode = 'P0001';
  end if;
  if (
    target_round.rsvp_deadline_at is not null
    and v_now >= target_round.rsvp_deadline_at
  ) or (
    target_round.rsvp_deadline_at is null
    and target_round.scheduled_at is not null
    and v_now >= target_round.scheduled_at
  ) then
    raise exception 'round_rsvp_closed' using errcode = 'P0001';
  end if;
  if locked_participant.version <> p_expected_participant_version then
    raise exception 'participant_version_changed' using errcode = '40001';
  end if;

  update public.round_participants as participant
  set rsvp_status = p_rsvp_status,
      version = locked_participant.version + 1
  where participant.id = locked_participant.id
    and participant.group_id = locked_participant.group_id
  returning * into saved_participant;

  insert into public.audit_events (
    group_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    target_version,
    before_state,
    after_state,
    source,
    correlation_id,
    operation_id
  )
  values (
    saved_participant.group_id,
    p_actor_user_id,
    'round.participant_rsvp_changed',
    'round_participant',
    saved_participant.id,
    saved_participant.version,
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
      'membership_id', saved_participant.membership_id,
      'rsvp_status', saved_participant.rsvp_status,
      'participant_version', saved_participant.version,
      'changed_at', v_now,
      'request_fingerprint', request_fingerprint
    ),
    normalized_source,
    p_correlation_id,
    p_operation_id
  );

  return query
  select
    saved_participant.round_id,
    saved_participant.group_id,
    saved_participant.id,
    saved_participant.membership_id,
    saved_participant.rsvp_status,
    saved_participant.version,
    v_now::app.utc_instant;
end;
$$;

comment on function public.set_round_participant_rsvp(uuid, uuid, public.round_rsvp_status, bigint, text, uuid, uuid) is
  'Allows an active, verified member to change only their own RSVP on a published round before the server deadline.';

revoke all on function public.set_round_participant_rsvp(uuid, uuid, public.round_rsvp_status, bigint, text, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.set_round_participant_rsvp(uuid, uuid, public.round_rsvp_status, bigint, text, uuid, uuid)
to service_role;

create function public.cancel_round(
  p_actor_user_id uuid,
  p_round_id uuid,
  p_reason text,
  p_expected_round_version bigint,
  p_correlation_id uuid,
  p_operation_id uuid
)
returns table (
  round_id app.entity_id,
  group_id app.entity_id,
  state public.round_state,
  version bigint,
  cancelled_at app.utc_instant,
  cancellation_reason text,
  participant_count bigint,
  notification_count bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_group_id uuid;
  actor_membership_id uuid;
  actor_role public.membership_role;
  locked_round public.rounds%rowtype;
  saved_round public.rounds%rowtype;
  prior_event public.audit_events%rowtype;
  normalized_reason text;
  request_payload jsonb;
  request_fingerprint text;
  v_now timestamptz := pg_catalog.clock_timestamp();
  participant_total bigint;
  notification_total bigint;
begin
  if p_actor_user_id is null or p_round_id is null then
    raise exception 'round_context_required' using errcode = '22004';
  end if;
  if p_correlation_id is null or p_operation_id is null then
    raise exception 'operation_context_required' using errcode = '22004';
  end if;
  if p_expected_round_version is null or p_expected_round_version < 1 then
    raise exception 'round_version_invalid' using errcode = '22023';
  end if;
  normalized_reason := nullif(pg_catalog.btrim(p_reason), '');
  if normalized_reason is null or pg_catalog.length(normalized_reason) > 500 then
    raise exception 'round_cancellation_reason_required' using errcode = '22023';
  end if;

  if exists (
    select 1
    from auth.users as identity
    where identity.id = p_actor_user_id
      and coalesce(identity.raw_app_meta_data, '{}'::jsonb) ? 'greenroster_password_recovery'
  ) then
    raise exception 'recovery_session_forbidden' using errcode = 'P0003';
  end if;

  select actor.group_id, actor.membership_id, actor.actor_role
  into actor_group_id, actor_membership_id, actor_role
  from app.resolve_member_management_actor(p_actor_user_id) as actor
  limit 1;
  if actor_group_id is null or actor_role not in ('coordinator', 'administrator') then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  perform 1 from public.groups where id = actor_group_id for update;
  if not found then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  -- Re-read and lock the actor membership after tenant serialization. Role,
  -- status, profile, identity, ban, and recovery metadata may have changed
  -- since resolve_member_management_actor() ran.
  v_now := pg_catalog.clock_timestamp();
  if exists (
    select 1
    from auth.users as identity
    where identity.id = p_actor_user_id
      and coalesce(identity.raw_app_meta_data, '{}'::jsonb) ? 'greenroster_password_recovery'
  ) then
    raise exception 'recovery_session_forbidden' using errcode = 'P0003';
  end if;
  select membership.role
  into actor_role
  from public.memberships as membership
  join public.user_profiles as profile on profile.user_id = membership.user_id
  join auth.users as identity on identity.id = membership.user_id
  where membership.id = actor_membership_id
    and membership.group_id = actor_group_id
    and membership.user_id = p_actor_user_id
    and membership.status = 'active'
    and membership.role in ('coordinator', 'administrator')
    and profile.disabled_at is null
    and identity.email_confirmed_at is not null
    and identity.deleted_at is null
    and not identity.is_anonymous
    and not (coalesce(identity.raw_app_meta_data, '{}'::jsonb) ? 'greenroster_password_recovery')
    and (identity.banned_until is null or identity.banned_until <= v_now)
  for update of membership;
  if not found then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  select round_record.*
  into locked_round
  from public.rounds as round_record
  where round_record.id = p_round_id
    and round_record.group_id = actor_group_id
  for update;
  if not found then
    raise exception 'round_not_found' using errcode = 'P0002';
  end if;

  request_payload := pg_catalog.jsonb_build_object(
    'round_id', p_round_id,
    'reason', normalized_reason,
    'expected_round_version', p_expected_round_version
  );
  request_fingerprint := app.member_request_fingerprint(
    request_payload,
    p_actor_user_id::text || ':' || p_operation_id::text
  );

  select event.*
  into prior_event
  from public.audit_events as event
  where event.group_id = locked_round.group_id
    and event.actor_user_id = p_actor_user_id
    and event.action = 'round.cancelled'
    and event.target_id = locked_round.id
    and event.operation_id = p_operation_id;
  if found then
    if prior_event.after_state ->> 'request_fingerprint' <> request_fingerprint then
      raise exception 'operation_id_reused' using errcode = '23505';
    end if;
    return query
    select
      (prior_event.after_state ->> 'round_id')::app.entity_id,
      (prior_event.after_state ->> 'group_id')::app.entity_id,
      (prior_event.after_state ->> 'state')::public.round_state,
      (prior_event.after_state ->> 'version')::bigint,
      (prior_event.after_state ->> 'cancelled_at')::app.utc_instant,
      prior_event.after_state ->> 'cancellation_reason',
      (prior_event.after_state ->> 'participant_count')::bigint,
      (prior_event.after_state ->> 'notification_count')::bigint;
    return;
  end if;

  if locked_round.state not in ('draft', 'published', 'live') then
    raise exception 'round_state_locked' using errcode = 'P0001';
  end if;
  if locked_round.version <> p_expected_round_version then
    raise exception 'round_version_changed' using errcode = '40001';
  end if;

  select count(*) into participant_total
  from public.round_participants as participant
  where participant.round_id = locked_round.id
    and participant.group_id = locked_round.group_id;

  update public.rounds as round_record
  set state = 'cancelled',
      cancelled_at = v_now,
      cancellation_reason = normalized_reason,
      version = locked_round.version + 1
  where round_record.id = locked_round.id
    and round_record.group_id = locked_round.group_id
  returning * into saved_round;

  -- A published notification that has not entered a provider claim must not
  -- survive cancellation. In-flight sends are left to their existing claim
  -- token; every queued/retryable delivery is atomically terminalized here.
  with cancelled_deliveries as (
    update public.notification_deliveries as delivery
    set state = 'cancelled',
        failure_reason = 'round_cancelled',
        next_attempt_at = v_now
    from public.notification_outbox_jobs as outbox
    where delivery.outbox_job_id = outbox.id
      and delivery.group_id = outbox.group_id
      and delivery.channel = 'email'
      and delivery.state in ('queued', 'retryable')
      and outbox.event_type = 'round.published'
      and outbox.aggregate_type = 'round'
      and outbox.aggregate_id = saved_round.id
      and outbox.group_id = saved_round.group_id
    returning delivery.outbox_job_id, delivery.group_id
  )
  update public.notification_outbox_jobs as outbox
  set state = 'cancelled',
      safe_error = 'round_cancelled',
      claimed_at = null,
      finished_at = v_now,
      next_attempt_at = v_now
  from cancelled_deliveries as cancelled
  where outbox.id = cancelled.outbox_job_id
    and outbox.group_id = cancelled.group_id;

  -- One durable event/job and one recipient delivery per published
  -- participant. Draft cancellation still emits an auditable outbox event but
  -- has no recipients. Current verified identity data is resolved at commit;
  -- the claim RPC revalidates it immediately before sending.
  insert into public.notification_outbox_jobs (
    group_id, event_type, aggregate_type, aggregate_id, aggregate_version,
    idempotency_key
  )
  select
    saved_round.group_id,
    'round.cancelled',
    'round',
    saved_round.id,
    saved_round.version,
    'round.cancelled:' || saved_round.id::text || ':' || participant.membership_id::text
  from public.round_participants as participant
  where participant.round_id = saved_round.id
    and participant.group_id = saved_round.group_id;

  insert into public.notification_deliveries (
    group_id,
    outbox_job_id,
    recipient_membership_id,
    recipient_address,
    recipient_address_normalized,
    channel,
    state,
    failure_reason
  )
  select
    jobs.group_id,
    jobs.id,
    participant.membership_id,
    case
      when identity.email is not null
        and pg_catalog.length(pg_catalog.btrim(identity.email)) between 3 and 320
        and pg_catalog.btrim(identity.email) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        then pg_catalog.btrim(identity.email)
      else published_delivery.recipient_address
    end,
    pg_catalog.lower(case
      when identity.email is not null
        and pg_catalog.length(pg_catalog.btrim(identity.email)) between 3 and 320
        and pg_catalog.btrim(identity.email) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        then pg_catalog.btrim(identity.email)
      else published_delivery.recipient_address
    end),
    'email',
    case
      when membership.status <> 'active'
        or identity.id is null
        or identity.email_confirmed_at is null
        or identity.deleted_at is not null
        or identity.is_anonymous
        or (identity.banned_until is not null and identity.banned_until > v_now)
        or identity.email is null
        or pg_catalog.length(pg_catalog.btrim(identity.email)) not between 3 and 320
        or pg_catalog.btrim(identity.email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        then 'cancelled'::public.notification_delivery_state
      else 'queued'::public.notification_delivery_state
    end,
    case
      when membership.status <> 'active' then 'member_inactive'
      when identity.id is null
        or identity.email_confirmed_at is null
        or identity.deleted_at is not null
        or identity.is_anonymous
        or (identity.banned_until is not null and identity.banned_until > v_now)
        or identity.email is null
        or pg_catalog.length(pg_catalog.btrim(identity.email)) not between 3 and 320
        or pg_catalog.btrim(identity.email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        then 'member_identity_unavailable'
      else null
    end
  from public.notification_outbox_jobs as jobs
  join public.round_participants as participant
    on participant.round_id = saved_round.id
   and participant.group_id = jobs.group_id
   and jobs.idempotency_key = 'round.cancelled:' || saved_round.id::text || ':' || participant.membership_id::text
  join public.memberships as membership
    on membership.id = participant.membership_id
   and membership.group_id = participant.group_id
  left join auth.users as identity on identity.id = membership.user_id
  left join public.notification_outbox_jobs as published_outbox
    on published_outbox.group_id = participant.group_id
   and published_outbox.aggregate_id = participant.round_id
   and published_outbox.event_type = 'round.published'
   and published_outbox.aggregate_type = 'round'
  left join public.notification_deliveries as published_delivery
    on published_delivery.outbox_job_id = published_outbox.id
   and published_delivery.group_id = published_outbox.group_id
   and published_delivery.recipient_membership_id = participant.membership_id
  where jobs.group_id = saved_round.group_id
    and jobs.event_type = 'round.cancelled'
    and jobs.aggregate_type = 'round'
    and jobs.aggregate_id = saved_round.id
    and (
      case
        when identity.email is not null
          and pg_catalog.length(pg_catalog.btrim(identity.email)) between 3 and 320
          and pg_catalog.btrim(identity.email) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
          then pg_catalog.btrim(identity.email)
        else published_delivery.recipient_address
      end
    ) is not null
    and pg_catalog.length(pg_catalog.btrim(case
      when identity.email is not null
        and pg_catalog.length(pg_catalog.btrim(identity.email)) between 3 and 320
        and pg_catalog.btrim(identity.email) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        then pg_catalog.btrim(identity.email)
      else published_delivery.recipient_address
    end)) between 3 and 320
    and pg_catalog.btrim(case
      when identity.email is not null
        and pg_catalog.length(pg_catalog.btrim(identity.email)) between 3 and 320
        and pg_catalog.btrim(identity.email) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        then pg_catalog.btrim(identity.email)
      else published_delivery.recipient_address
    end) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$';

  -- Report only deliveries that remain queued for the worker. Invalid or
  -- inactive recipients are durable cancellation records but are already
  -- terminal and must not be presented as queued work to the coordinator.
  select count(*)
  into notification_total
  from public.notification_deliveries as delivery
  join public.notification_outbox_jobs as outbox
    on outbox.id = delivery.outbox_job_id
   and outbox.group_id = delivery.group_id
  where outbox.group_id = saved_round.group_id
    and outbox.event_type = 'round.cancelled'
    and outbox.aggregate_type = 'round'
    and outbox.aggregate_id = saved_round.id
    and delivery.state = 'queued';

  -- A delivery can be created already terminal when the participant's
  -- identity is inactive or unavailable. Its cancellation outbox job must be
  -- terminal too; otherwise queue depth reports work that can never be
  -- claimed. Active/verified recipients remain queued for the service claim.
  update public.notification_outbox_jobs as outbox
  set state = 'cancelled',
      safe_error = delivery.failure_reason,
      claimed_at = null,
      finished_at = v_now,
      next_attempt_at = v_now
  from public.notification_deliveries as delivery
  where delivery.outbox_job_id = outbox.id
    and delivery.group_id = outbox.group_id
    and delivery.state = 'cancelled'
    and delivery.failure_reason is not null
    and outbox.group_id = saved_round.group_id
    and outbox.event_type = 'round.cancelled'
    and outbox.aggregate_type = 'round'
    and outbox.aggregate_id = saved_round.id;

  insert into public.audit_events (
    group_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    target_version,
    before_state,
    after_state,
    source,
    correlation_id,
    operation_id,
    reason
  )
  values (
    saved_round.group_id,
    p_actor_user_id,
    'round.cancelled',
    'round',
    saved_round.id,
    saved_round.version,
    pg_catalog.jsonb_build_object(
      'state', locked_round.state,
      'version', locked_round.version
    ),
    pg_catalog.jsonb_build_object(
      'round_id', saved_round.id,
      'group_id', saved_round.group_id,
      'state', saved_round.state,
      'version', saved_round.version,
      'cancelled_at', saved_round.cancelled_at,
      'cancellation_reason', saved_round.cancellation_reason,
      'participant_count', participant_total,
      'notification_count', notification_total,
      'request_fingerprint', request_fingerprint
    ),
    'portal',
    p_correlation_id,
    p_operation_id,
    normalized_reason
  );

  return query
  select
    saved_round.id,
    saved_round.group_id,
    saved_round.state,
    saved_round.version,
    saved_round.cancelled_at,
    saved_round.cancellation_reason,
    participant_total,
    notification_total;
end;
$$;

comment on function public.cancel_round(uuid, uuid, text, bigint, uuid, uuid) is
  'Coordinator/administrator cancellation for Draft, Published, or Live rounds; preserves reason, audit, and participant e-mail work atomically.';

revoke all on function public.cancel_round(uuid, uuid, text, bigint, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.cancel_round(uuid, uuid, text, bigint, uuid, uuid)
to service_role;

create function public.claim_round_cancelled_email(
  p_claim_token uuid,
  p_stale_before timestamptz
)
returns table (
  delivery_id app.entity_id,
  outbox_job_id app.entity_id,
  round_id app.entity_id,
  group_id app.entity_id,
  group_name text,
  group_time_zone text,
  round_description text,
  scheduled_at app.utc_instant,
  format public.round_format,
  cancellation_reason text,
  recipient_address text,
  attempt_number integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  selected_delivery record;
begin
  if p_claim_token is null then
    raise exception 'delivery_claim_token_required' using errcode = '22004';
  end if;
  if p_stale_before is null or p_stale_before > v_now then
    raise exception 'delivery_stale_boundary_invalid' using errcode = '22023';
  end if;

  with stale_deliveries as (
    update public.notification_deliveries as delivery
    set state = 'retryable',
        failure_reason = 'claim_expired',
        claim_token = null,
        claimed_at = null,
        next_attempt_at = v_now
    from public.notification_outbox_jobs as outbox
    where delivery.outbox_job_id = outbox.id
      and delivery.group_id = outbox.group_id
      and delivery.channel = 'email'
      and delivery.state = 'sending'
      and delivery.claimed_at <= p_stale_before
      and outbox.event_type = 'round.cancelled'
      and outbox.aggregate_type = 'round'
      and outbox.state = 'processing'
    returning delivery.outbox_job_id, delivery.group_id
  )
  update public.notification_outbox_jobs as outbox
  set state = 'retryable',
      safe_error = 'claim_expired',
      claimed_at = null,
      finished_at = null,
      next_attempt_at = v_now
  from stale_deliveries as stale
  where outbox.id = stale.outbox_job_id
    and outbox.group_id = stale.group_id;

  with invalid as (
    select
      delivery.id,
      delivery.group_id,
      delivery.outbox_job_id,
      case
        when membership.status <> 'active' then 'member_inactive'
        when identity.email is null then 'member_identity_unavailable'
        else 'member_identity_unavailable'
      end as safe_reason
    from public.notification_deliveries as delivery
    join public.notification_outbox_jobs as outbox
      on outbox.id = delivery.outbox_job_id
     and outbox.group_id = delivery.group_id
    join public.round_participants as participant
      on participant.membership_id = delivery.recipient_membership_id
     and participant.group_id = delivery.group_id
     and participant.round_id = outbox.aggregate_id
    join public.memberships as membership
      on membership.id = participant.membership_id
     and membership.group_id = participant.group_id
    left join auth.users as identity on identity.id = membership.user_id
    left join public.user_profiles as profile on profile.user_id = membership.user_id
    where delivery.channel = 'email'
      and delivery.state in ('queued', 'retryable')
      and outbox.event_type = 'round.cancelled'
      and outbox.aggregate_type = 'round'
      and outbox.state in ('queued', 'retryable')
      and (
        membership.status <> 'active'
        or profile.user_id is null
        or profile.disabled_at is not null
        or identity.id is null
        or identity.email_confirmed_at is null
        or identity.deleted_at is not null
        or identity.is_anonymous
        or (identity.banned_until is not null and identity.banned_until > v_now)
        or identity.email is null
        or pg_catalog.length(pg_catalog.btrim(identity.email)) not between 3 and 320
        or pg_catalog.btrim(identity.email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      )
    order by delivery.next_attempt_at, delivery.created_at, delivery.id
    for update of delivery, outbox skip locked
  ), cancelled_deliveries as (
    update public.notification_deliveries as delivery
    set state = 'cancelled',
        failure_reason = invalid.safe_reason,
        claim_token = null,
        claimed_at = null,
        next_attempt_at = v_now
    from invalid
    where delivery.id = invalid.id
      and delivery.group_id = invalid.group_id
    returning delivery.outbox_job_id, delivery.group_id, delivery.failure_reason
  )
  update public.notification_outbox_jobs as outbox
  set state = 'cancelled',
      safe_error = cancelled.failure_reason,
      claimed_at = null,
      finished_at = v_now,
      next_attempt_at = v_now
  from cancelled_deliveries as cancelled
  where outbox.id = cancelled.outbox_job_id
    and outbox.group_id = cancelled.group_id;

  select
    delivery.id as delivery_id,
    outbox.id as outbox_job_id,
    round_record.id as round_id,
    delivery.group_id,
    group_record.name as group_name,
    round_record.group_time_zone::text as group_time_zone,
    round_record.description as round_description,
    round_record.scheduled_at,
    round_record.format,
    round_record.cancellation_reason,
    pg_catalog.btrim(identity.email) as recipient_address,
    delivery.attempts + 1 as attempt_number
  into selected_delivery
  from public.notification_deliveries as delivery
  join public.notification_outbox_jobs as outbox
    on outbox.id = delivery.outbox_job_id
   and outbox.group_id = delivery.group_id
  join public.rounds as round_record
    on round_record.id = outbox.aggregate_id
   and round_record.group_id = outbox.group_id
  join public.round_participants as participant
    on participant.membership_id = delivery.recipient_membership_id
   and participant.group_id = delivery.group_id
   and participant.round_id = outbox.aggregate_id
  join public.memberships as membership
    on membership.id = participant.membership_id
   and membership.group_id = participant.group_id
  join public.user_profiles as profile
    on profile.user_id = membership.user_id
   and profile.disabled_at is null
  join auth.users as identity on identity.id = membership.user_id
  join public.groups as group_record on group_record.id = delivery.group_id
  where delivery.channel = 'email'
    and delivery.state in ('queued', 'retryable')
    and delivery.next_attempt_at <= v_now
    and outbox.event_type = 'round.cancelled'
    and outbox.aggregate_type = 'round'
    and outbox.state in ('queued', 'retryable')
    and outbox.next_attempt_at <= v_now
    and round_record.state = 'cancelled'
    and membership.status = 'active'
    and identity.email_confirmed_at is not null
    and identity.deleted_at is null
    and not identity.is_anonymous
    and (identity.banned_until is null or identity.banned_until <= v_now)
    and identity.email is not null
    and pg_catalog.length(pg_catalog.btrim(identity.email)) between 3 and 320
    and pg_catalog.btrim(identity.email) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  order by delivery.next_attempt_at, delivery.created_at, delivery.id
  for update of delivery, outbox skip locked
  limit 1;

  if not found then
    return;
  end if;

  update public.notification_deliveries as delivery
  set state = 'sending',
      claim_token = p_claim_token,
      claimed_at = v_now,
      attempts = selected_delivery.attempt_number,
      failure_reason = null,
      recipient_address = selected_delivery.recipient_address,
      recipient_address_normalized = pg_catalog.lower(selected_delivery.recipient_address)
  where delivery.id = selected_delivery.delivery_id
    and delivery.group_id = selected_delivery.group_id;

  update public.notification_outbox_jobs as outbox
  set state = 'processing',
      claimed_at = v_now,
      attempts = selected_delivery.attempt_number,
      safe_error = null
  where outbox.id = selected_delivery.outbox_job_id
    and outbox.group_id = selected_delivery.group_id;

  return query
  select
    selected_delivery.delivery_id::app.entity_id,
    selected_delivery.outbox_job_id::app.entity_id,
    selected_delivery.round_id::app.entity_id,
    selected_delivery.group_id::app.entity_id,
    selected_delivery.group_name::text,
    selected_delivery.group_time_zone::text,
    selected_delivery.round_description::text,
    selected_delivery.scheduled_at::app.utc_instant,
    selected_delivery.format::public.round_format,
    selected_delivery.cancellation_reason::text,
    selected_delivery.recipient_address::text,
    selected_delivery.attempt_number::integer;
end;
$$;

comment on function public.claim_round_cancelled_email(uuid, timestamptz) is
  'Service-only atomic claim for one mandatory cancellation e-mail, returning the round snapshot zone and reason while revalidating identity; optional e-mail suppressions do not suppress cancellation notices.';

revoke all on function public.claim_round_cancelled_email(uuid, timestamptz)
from public, anon, authenticated, service_role;
grant execute on function public.claim_round_cancelled_email(uuid, timestamptz)
to service_role;
