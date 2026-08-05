-- Phase 07: optional push delivery when a published round opens scoring.
--
-- Opening scoring is a synchronous Published -> Live business transition.
-- This trigger queues one recipient-scoped outbox parent per Playing member
-- with an active, enabled push channel, then fans out one child per device in
-- the same transaction. Guests and members without a Playing RSVP are never
-- added to this notification audience.

create function app.queue_scoring_opened_outbox()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  now_at timestamptz := pg_catalog.clock_timestamp();
begin
  if old.state <> 'published'::public.round_state
    or new.state <> 'live'::public.round_state
  then
    return new;
  end if;

  insert into public.notification_outbox_jobs (
    group_id,
    event_type,
    aggregate_type,
    aggregate_id,
    aggregate_version,
    idempotency_key
  )
  select
    new.group_id,
    'scoring_opened',
    'round',
    new.id,
    new.version,
    'round.scoring_opened:' || new.id::text || ':' || new.version::text || ':' || participant.membership_id::text
  from public.round_participants as participant
  join public.memberships as membership
    on membership.id = participant.membership_id
   and membership.group_id = participant.group_id
   and membership.status = 'active'::public.membership_status
  join public.user_profiles as profile
    on profile.user_id = membership.user_id
   and profile.disabled_at is null
  join auth.users as identity
    on identity.id = membership.user_id
   and identity.email_confirmed_at is not null
   and identity.deleted_at is null
   and not identity.is_anonymous
   and (identity.banned_until is null or identity.banned_until <= now_at)
  join public.notification_category_policies as policy
    on policy.category = 'scoring_opened'::public.notification_preference_category
   and policy.push_allowed
  left join public.notification_preferences as preference
    on preference.membership_id = participant.membership_id
   and preference.group_id = participant.group_id
   and preference.category = policy.category
  where participant.round_id = new.id
    and participant.group_id = new.group_id
    and participant.participant_kind = 'member'::public.round_participant_kind
    and participant.rsvp_status = 'playing'::public.round_rsvp_status
    and coalesce(preference.push_enabled, policy.default_push_enabled)
    and exists (
      select 1
      from public.push_devices as device
      where device.user_id = membership.user_id
        and device.active
    )
  on conflict (idempotency_key) do nothing;

  insert into public.notification_push_deliveries (
    group_id,
    outbox_job_id,
    recipient_membership_id,
    recipient_user_id,
    device_id,
    state,
    next_attempt_at
  )
  select
    outbox.group_id,
    outbox.id,
    participant.membership_id,
    membership.user_id,
    device.device_id,
    'queued'::public.notification_delivery_state,
    app.optional_push_next_attempt(new.group_time_zone::text, now_at)
  from public.notification_outbox_jobs as outbox
  join public.round_participants as participant
    on participant.round_id = outbox.aggregate_id
   and participant.group_id = outbox.group_id
   and participant.participant_kind = 'member'::public.round_participant_kind
   and participant.rsvp_status = 'playing'::public.round_rsvp_status
  join public.memberships as membership
    on membership.id = participant.membership_id
   and membership.group_id = participant.group_id
   and membership.status = 'active'::public.membership_status
  join public.user_profiles as profile
    on profile.user_id = membership.user_id
   and profile.disabled_at is null
  join auth.users as identity
    on identity.id = membership.user_id
   and identity.email_confirmed_at is not null
   and identity.deleted_at is null
   and not identity.is_anonymous
   and (identity.banned_until is null or identity.banned_until <= now_at)
  join public.notification_category_policies as policy
    on policy.category = 'scoring_opened'::public.notification_preference_category
   and policy.push_allowed
  left join public.notification_preferences as preference
    on preference.membership_id = participant.membership_id
   and preference.group_id = participant.group_id
   and preference.category = policy.category
  join public.push_devices as device
    on device.user_id = membership.user_id
   and device.active
  where outbox.group_id = new.group_id
    and outbox.event_type = 'scoring_opened'
    and outbox.aggregate_type = 'round'
    and outbox.aggregate_id = new.id
    and outbox.aggregate_version = new.version
    and coalesce(preference.push_enabled, policy.default_push_enabled)
  on conflict (outbox_job_id, device_id) do nothing;

  return new;
end;
$$;

comment on function app.queue_scoring_opened_outbox() is
  'Queues optional scoring-opened push parents and per-device children for Playing member participants during the Published-to-Live transition.';

revoke all on function app.queue_scoring_opened_outbox()
from public, anon, authenticated, service_role;

create trigger rounds_scoring_opened_outbox
after update of state on public.rounds
for each row execute function app.queue_scoring_opened_outbox();

create function app.cancel_scoring_opened_push_on_preference_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  delivery_record record;
  now_at timestamptz;
begin
  if new.category <> 'scoring_opened'::public.notification_preference_category
    or new.push_enabled
  then
    return new;
  end if;

  now_at := pg_catalog.clock_timestamp();
  for delivery_record in
    select delivery.id, delivery.group_id, delivery.outbox_job_id
    from public.notification_push_deliveries as delivery
    join public.notification_outbox_jobs as outbox
      on outbox.id = delivery.outbox_job_id
     and outbox.group_id = delivery.group_id
    where delivery.recipient_membership_id = new.membership_id
      and delivery.group_id = new.group_id
      and delivery.state in (
        'queued'::public.notification_delivery_state,
        'retryable'::public.notification_delivery_state
      )
      and outbox.event_type = 'scoring_opened'
      and outbox.aggregate_type = 'round'
    for update of delivery, outbox skip locked
  loop
    update public.notification_push_deliveries as delivery
    set state = 'cancelled'::public.notification_delivery_state,
        failure_reason = 'preference_disabled',
        next_attempt_at = now_at
    where delivery.id = delivery_record.id
      and delivery.group_id = delivery_record.group_id;

    perform app.refresh_round_announcement_outbox_state(
      delivery_record.outbox_job_id,
      delivery_record.group_id
    );
  end loop;

  return new;
end;
$$;

comment on function app.cancel_scoring_opened_push_on_preference_change() is
  'Cancels queued scoring-opened push children when the same-group member disables that optional category.';

revoke all on function app.cancel_scoring_opened_push_on_preference_change()
from public, anon, authenticated, service_role;

create trigger notification_preferences_cancel_scoring_opened_push
after insert or update of push_enabled on public.notification_preferences
for each row execute function app.cancel_scoring_opened_push_on_preference_change();

create function public.claim_scoring_opened_push(
  p_claim_token uuid,
  p_stale_before timestamptz
)
returns table (
  delivery_id app.entity_id,
  outbox_job_id app.entity_id,
  event_type text,
  round_id app.entity_id,
  group_id app.entity_id,
  round_description text,
  scheduled_at app.utc_instant,
  venue text,
  rsvp_deadline_at app.utc_instant,
  recipient_user_id app.entity_id,
  device_id app.entity_id,
  expo_push_token text,
  attempt_number integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  now_at timestamptz := pg_catalog.clock_timestamp();
  stale_delivery record;
  invalid_delivery record;
  quiet_delivery record;
  selected_delivery record;
begin
  if p_claim_token is null then
    raise exception 'delivery_claim_token_required' using errcode = '22004';
  end if;
  if p_stale_before is null or p_stale_before > now_at then
    raise exception 'delivery_stale_boundary_invalid' using errcode = '22023';
  end if;

  for stale_delivery in
    select delivery.id, delivery.group_id, delivery.outbox_job_id,
      outbox.state as outbox_state
    from public.notification_push_deliveries as delivery
    join public.notification_outbox_jobs as outbox
      on outbox.id = delivery.outbox_job_id
     and outbox.group_id = delivery.group_id
    where delivery.state = 'sending'::public.notification_delivery_state
      and delivery.claimed_at <= p_stale_before
      and outbox.event_type = 'scoring_opened'
      and outbox.aggregate_type = 'round'
    for update of delivery, outbox skip locked
  loop
    update public.notification_push_deliveries as target
    set state = case
          when stale_delivery.outbox_state = 'cancelled'::public.notification_outbox_job_state
            then 'cancelled'::public.notification_delivery_state
          else 'retryable'::public.notification_delivery_state
        end,
        failure_reason = case
          when stale_delivery.outbox_state = 'cancelled'::public.notification_outbox_job_state
            then 'parent_cancelled'
          else 'claim_expired'
        end,
        claim_token = null,
        claimed_at = null,
        next_attempt_at = now_at
    where target.id = stale_delivery.id
      and target.group_id = stale_delivery.group_id;

    perform app.refresh_round_announcement_outbox_state(
      stale_delivery.outbox_job_id,
      stale_delivery.group_id
    );
  end loop;

  for invalid_delivery in
    select
      delivery.id,
      delivery.group_id,
      delivery.outbox_job_id,
      case
        when participant.id is null then 'participant_unavailable'
        when participant.participant_kind <> 'member'::public.round_participant_kind then 'guest_ineligible'
        when participant.rsvp_status <> 'playing'::public.round_rsvp_status then 'rsvp_not_playing'
        when membership.status <> 'active'::public.membership_status then 'member_inactive'
        when profile.user_id is null or profile.disabled_at is not null then 'member_profile_unavailable'
        when identity.id is null
          or identity.email_confirmed_at is null
          or identity.deleted_at is not null
          or identity.is_anonymous
          or (identity.banned_until is not null and identity.banned_until > now_at)
          then 'member_identity_unavailable'
        when device.active is not true then 'push_device_unavailable'
        when not coalesce(preference.push_enabled, policy.default_push_enabled) then 'preference_disabled'
        when round_record.state <> 'live'::public.round_state then 'round_state_locked'
        else null
      end as safe_reason
    from public.notification_push_deliveries as delivery
    join public.notification_outbox_jobs as outbox
      on outbox.id = delivery.outbox_job_id
     and outbox.group_id = delivery.group_id
    join public.rounds as round_record
      on round_record.id = outbox.aggregate_id
     and round_record.group_id = outbox.group_id
    left join public.round_participants as participant
      on participant.round_id = round_record.id
     and participant.group_id = round_record.group_id
     and participant.membership_id = delivery.recipient_membership_id
    join public.memberships as membership
      on membership.id = delivery.recipient_membership_id
     and membership.group_id = delivery.group_id
    left join public.user_profiles as profile
      on profile.user_id = membership.user_id
    left join auth.users as identity
      on identity.id = membership.user_id
    left join public.push_devices as device
      on device.device_id = delivery.device_id
    left join public.notification_category_policies as policy
      on policy.category = 'scoring_opened'::public.notification_preference_category
    left join public.notification_preferences as preference
      on preference.membership_id = membership.id
     and preference.group_id = membership.group_id
     and preference.category = policy.category
    where delivery.state in (
        'queued'::public.notification_delivery_state,
        'retryable'::public.notification_delivery_state
      )
      and outbox.event_type = 'scoring_opened'
      and outbox.aggregate_type = 'round'
      and outbox.state in (
        'queued'::public.notification_outbox_job_state,
        'retryable'::public.notification_outbox_job_state,
        'processing'::public.notification_outbox_job_state
      )
      and (
        participant.id is null
        or participant.participant_kind <> 'member'::public.round_participant_kind
        or participant.rsvp_status <> 'playing'::public.round_rsvp_status
        or membership.status <> 'active'::public.membership_status
        or profile.user_id is null
        or profile.disabled_at is not null
        or identity.id is null
        or identity.email_confirmed_at is null
        or identity.deleted_at is not null
        or identity.is_anonymous
        or (identity.banned_until is not null and identity.banned_until > now_at)
        or device.active is not true
        or not coalesce(preference.push_enabled, policy.default_push_enabled)
        or round_record.state <> 'live'::public.round_state
      )
    order by delivery.next_attempt_at, delivery.created_at, delivery.id
    for update of delivery skip locked
  loop
    update public.notification_push_deliveries as target
    set state = 'cancelled'::public.notification_delivery_state,
        failure_reason = invalid_delivery.safe_reason,
        claim_token = null,
        claimed_at = null,
        next_attempt_at = now_at
    where target.id = invalid_delivery.id
      and target.group_id = invalid_delivery.group_id;

    perform app.refresh_round_announcement_outbox_state(
      invalid_delivery.outbox_job_id,
      invalid_delivery.group_id
    );
  end loop;

  for quiet_delivery in
    select
      delivery.id,
      delivery.group_id,
      delivery.outbox_job_id,
      app.optional_push_next_attempt(round_record.group_time_zone::text, now_at) as quiet_until
    from public.notification_push_deliveries as delivery
    join public.notification_outbox_jobs as outbox
      on outbox.id = delivery.outbox_job_id
     and outbox.group_id = delivery.group_id
    join public.rounds as round_record
      on round_record.id = outbox.aggregate_id
     and round_record.group_id = outbox.group_id
    where delivery.state in (
        'queued'::public.notification_delivery_state,
        'retryable'::public.notification_delivery_state
      )
      and delivery.next_attempt_at <= now_at
      and outbox.next_attempt_at <= now_at
      and outbox.event_type = 'scoring_opened'
      and outbox.aggregate_type = 'round'
      and outbox.state in (
        'queued'::public.notification_outbox_job_state,
        'retryable'::public.notification_outbox_job_state,
        'processing'::public.notification_outbox_job_state
      )
      and app.optional_push_next_attempt(round_record.group_time_zone::text, now_at) > now_at
    order by delivery.next_attempt_at, delivery.created_at, delivery.id
    for update of delivery skip locked
  loop
    update public.notification_push_deliveries as target
    set next_attempt_at = quiet_delivery.quiet_until
    where target.id = quiet_delivery.id
      and target.group_id = quiet_delivery.group_id;

    perform app.refresh_round_announcement_outbox_state(
      quiet_delivery.outbox_job_id,
      quiet_delivery.group_id
    );
  end loop;

  select
    delivery.id as delivery_id,
    outbox.id as outbox_job_id,
    outbox.event_type as event_type,
    round_record.id as round_id,
    delivery.group_id as group_id,
    coalesce(round_record.description, 'Round') as round_description,
    round_record.scheduled_at as scheduled_at,
    round_record.venue as venue,
    round_record.rsvp_deadline_at as rsvp_deadline_at,
    delivery.recipient_user_id as recipient_user_id,
    delivery.device_id as device_id,
    device.expo_push_token as expo_push_token,
    delivery.attempts + 1 as attempt_number
  into selected_delivery
  from public.notification_push_deliveries as delivery
  join public.notification_outbox_jobs as outbox
    on outbox.id = delivery.outbox_job_id
   and outbox.group_id = delivery.group_id
  join public.rounds as round_record
    on round_record.id = outbox.aggregate_id
   and round_record.group_id = outbox.group_id
   and round_record.state = 'live'::public.round_state
  join public.round_participants as participant
    on participant.round_id = round_record.id
   and participant.group_id = round_record.group_id
   and participant.membership_id = delivery.recipient_membership_id
   and participant.participant_kind = 'member'::public.round_participant_kind
   and participant.rsvp_status = 'playing'::public.round_rsvp_status
  join public.memberships as membership
    on membership.id = participant.membership_id
   and membership.group_id = participant.group_id
   and membership.status = 'active'::public.membership_status
  join public.user_profiles as profile
    on profile.user_id = membership.user_id
   and profile.disabled_at is null
  join auth.users as identity
    on identity.id = membership.user_id
   and identity.email_confirmed_at is not null
   and identity.deleted_at is null
   and not identity.is_anonymous
   and (identity.banned_until is null or identity.banned_until <= now_at)
  join public.notification_category_policies as policy
    on policy.category = 'scoring_opened'::public.notification_preference_category
   and policy.push_allowed
  left join public.notification_preferences as preference
    on preference.membership_id = participant.membership_id
   and preference.group_id = participant.group_id
   and preference.category = policy.category
  join public.push_devices as device
    on device.device_id = delivery.device_id
   and device.active
   and device.user_id = delivery.recipient_user_id
  where delivery.state in (
      'queued'::public.notification_delivery_state,
      'retryable'::public.notification_delivery_state
    )
    and delivery.next_attempt_at <= now_at
    and outbox.next_attempt_at <= now_at
    and outbox.event_type = 'scoring_opened'
    and outbox.aggregate_type = 'round'
    and outbox.state in (
      'queued'::public.notification_outbox_job_state,
      'retryable'::public.notification_outbox_job_state,
      'processing'::public.notification_outbox_job_state
    )
    and coalesce(preference.push_enabled, policy.default_push_enabled)
  order by delivery.next_attempt_at, delivery.created_at, delivery.id
  for update of delivery, outbox skip locked
  limit 1;

  if not found then
    return;
  end if;

  update public.notification_push_deliveries as delivery
  set state = 'sending'::public.notification_delivery_state,
      claim_token = p_claim_token,
      claimed_at = now_at,
      attempts = selected_delivery.attempt_number,
      failure_reason = null
  where delivery.id = selected_delivery.delivery_id
    and delivery.group_id = selected_delivery.group_id;

  update public.notification_outbox_jobs as outbox
  set state = 'processing'::public.notification_outbox_job_state,
      claimed_at = now_at,
      attempts = greatest(outbox.attempts, selected_delivery.attempt_number),
      safe_error = null
  where outbox.id = selected_delivery.outbox_job_id
    and outbox.group_id = selected_delivery.group_id;

  return query
  select
    selected_delivery.delivery_id::app.entity_id,
    selected_delivery.outbox_job_id::app.entity_id,
    selected_delivery.event_type::text,
    selected_delivery.round_id::app.entity_id,
    selected_delivery.group_id::app.entity_id,
    selected_delivery.round_description::text,
    selected_delivery.scheduled_at::app.utc_instant,
    selected_delivery.venue::text,
    selected_delivery.rsvp_deadline_at::app.utc_instant,
    selected_delivery.recipient_user_id::app.entity_id,
    selected_delivery.device_id::app.entity_id,
    selected_delivery.expo_push_token::text,
    selected_delivery.attempt_number::integer;
end;
$$;

revoke all on function public.claim_scoring_opened_push(uuid, timestamptz)
from public, anon, authenticated;
grant execute on function public.claim_scoring_opened_push(uuid, timestamptz)
to service_role;

create function public.record_scoring_opened_push_send_success(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_provider_message_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  now_at timestamptz := pg_catalog.clock_timestamp();
  delivery_record public.notification_push_deliveries%rowtype;
  provider_id text := nullif(pg_catalog.btrim(p_provider_message_id), '');
begin
  if p_delivery_id is null or p_claim_token is null or provider_id is null
    or pg_catalog.length(provider_id) > 255 then
    raise exception 'delivery_context_invalid' using errcode = '22023';
  end if;

  select delivery.* into delivery_record
  from public.notification_push_deliveries as delivery
  join public.notification_outbox_jobs as outbox
    on outbox.id = delivery.outbox_job_id
   and outbox.group_id = delivery.group_id
  where delivery.id = p_delivery_id
    and delivery.state = 'sending'::public.notification_delivery_state
    and delivery.claim_token = p_claim_token
    and outbox.event_type = 'scoring_opened'
    and outbox.aggregate_type = 'round'
  for update of delivery;
  if not found then
    raise exception 'delivery_claim_invalid' using errcode = 'P0002';
  end if;

  update public.notification_push_deliveries
  set provider_message_id = provider_id,
      state = 'sent'::public.notification_delivery_state,
      sent_at = now_at,
      claim_token = null,
      claimed_at = null,
      failure_reason = null,
      next_attempt_at = now_at
  where id = delivery_record.id
    and group_id = delivery_record.group_id;

  perform app.refresh_round_announcement_outbox_state(
    delivery_record.outbox_job_id,
    delivery_record.group_id
  );
end;
$$;

revoke all on function public.record_scoring_opened_push_send_success(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.record_scoring_opened_push_send_success(uuid, uuid, text)
to service_role;

create function public.record_scoring_opened_push_send_failure(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_safe_error text,
  p_retry_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  now_at timestamptz := pg_catalog.clock_timestamp();
  delivery_record public.notification_push_deliveries%rowtype;
begin
  if p_delivery_id is null or p_claim_token is null
    or p_safe_error is null
    or pg_catalog.length(pg_catalog.btrim(p_safe_error)) not between 1 and 200
    or p_safe_error !~ '^[a-z0-9][a-z0-9_.:-]{0,199}$'
    or (p_retry_at is not null and p_retry_at <= now_at)
  then
    raise exception 'delivery_context_invalid' using errcode = '22023';
  end if;

  select delivery.* into delivery_record
  from public.notification_push_deliveries as delivery
  join public.notification_outbox_jobs as outbox
    on outbox.id = delivery.outbox_job_id
   and outbox.group_id = delivery.group_id
  where delivery.id = p_delivery_id
    and delivery.state = 'sending'::public.notification_delivery_state
    and delivery.claim_token = p_claim_token
    and outbox.event_type = 'scoring_opened'
    and outbox.aggregate_type = 'round'
  for update of delivery;
  if not found then
    raise exception 'delivery_claim_invalid' using errcode = 'P0002';
  end if;

  update public.notification_push_deliveries
  set state = case
        when p_retry_at is null then 'failed_permanent'::public.notification_delivery_state
        else 'retryable'::public.notification_delivery_state
      end,
      failure_reason = pg_catalog.btrim(p_safe_error),
      claim_token = null,
      claimed_at = null,
      next_attempt_at = coalesce(p_retry_at, now_at)
  where id = delivery_record.id
    and group_id = delivery_record.group_id;

  perform app.refresh_round_announcement_outbox_state(
    delivery_record.outbox_job_id,
    delivery_record.group_id
  );
end;
$$;

revoke all on function public.record_scoring_opened_push_send_failure(uuid, uuid, text, timestamptz)
from public, anon, authenticated;
grant execute on function public.record_scoring_opened_push_send_failure(uuid, uuid, text, timestamptz)
to service_role;

create function public.record_scoring_opened_push_invalid_device(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_device_id uuid,
  p_group_id uuid,
  p_correlation_id uuid,
  p_operation_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  delivery_record public.notification_push_deliveries%rowtype;
  now_at timestamptz := pg_catalog.clock_timestamp();
begin
  if p_delivery_id is null or p_claim_token is null or p_device_id is null
    or p_group_id is null or p_correlation_id is null or p_operation_id is null then
    raise exception 'delivery_context_required' using errcode = '22004';
  end if;

  select delivery.* into delivery_record
  from public.notification_push_deliveries as delivery
  join public.notification_outbox_jobs as outbox
    on outbox.id = delivery.outbox_job_id
   and outbox.group_id = delivery.group_id
  where delivery.id = p_delivery_id
    and delivery.group_id = p_group_id
    and delivery.device_id = p_device_id
    and delivery.state = 'sending'::public.notification_delivery_state
    and delivery.claim_token = p_claim_token
    and outbox.event_type = 'scoring_opened'
    and outbox.aggregate_type = 'round'
  for update of delivery;
  if not found then
    raise exception 'delivery_claim_invalid' using errcode = 'P0002';
  end if;

  perform public.retire_results_push_device_on_provider_invalid(
    delivery_record.device_id,
    delivery_record.group_id,
    p_correlation_id,
    p_operation_id
  );

  update public.notification_push_deliveries
  set state = 'failed_permanent'::public.notification_delivery_state,
      failure_reason = 'provider_invalid',
      claim_token = null,
      claimed_at = null,
      next_attempt_at = now_at
  where id = delivery_record.id
    and group_id = delivery_record.group_id;

  perform app.refresh_round_announcement_outbox_state(
    delivery_record.outbox_job_id,
    delivery_record.group_id
  );
end;
$$;

revoke all on function public.record_scoring_opened_push_invalid_device(uuid, uuid, uuid, uuid, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.record_scoring_opened_push_invalid_device(uuid, uuid, uuid, uuid, uuid, uuid)
to service_role;

comment on function public.claim_scoring_opened_push(uuid, timestamptz) is
  'Service-only atomic claim for one scoring-opened push, with stale-claim recovery, quiet-hours deferral, send-time membership/Auth/device checks, and tenant-scoped delivery output.';

comment on function public.record_scoring_opened_push_invalid_device(uuid, uuid, uuid, uuid, uuid, uuid) is
  'Service-only atomic scoring-opened invalid-device retirement and delivery finalization.';
