-- Phase 07: mandatory push delivery for round cancellation.
--
-- Cancellation is a mandatory, quiet-hours-exempt event. The event keeps the
-- existing cancellation outbox as its aggregate parent and expands it into
-- one push child per active install. Raw Expo tokens are returned only from
-- the service-only claim RPC; they are never copied into notification rows or
-- audit payloads.

create function app.refresh_round_cancelled_outbox_state(
  p_outbox_job_id uuid,
  p_group_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  now_at timestamptz := pg_catalog.clock_timestamp();
  has_sending boolean;
  has_retryable boolean;
  has_queued boolean;
  has_failed_permanent boolean;
  has_sent boolean;
  has_cancelled boolean;
  next_retry_at timestamptz;
begin
  if p_outbox_job_id is null or p_group_id is null then
    return;
  end if;

  select
    exists (
      select 1 from public.notification_deliveries as delivery
      where delivery.outbox_job_id = p_outbox_job_id
        and delivery.group_id = p_group_id
        and delivery.state = 'sending'::public.notification_delivery_state
    ) or exists (
      select 1 from public.notification_push_deliveries as delivery
      where delivery.outbox_job_id = p_outbox_job_id
        and delivery.group_id = p_group_id
        and delivery.state = 'sending'::public.notification_delivery_state
    ),
    exists (
      select 1 from public.notification_deliveries as delivery
      where delivery.outbox_job_id = p_outbox_job_id
        and delivery.group_id = p_group_id
        and delivery.state = 'retryable'::public.notification_delivery_state
    ) or exists (
      select 1 from public.notification_push_deliveries as delivery
      where delivery.outbox_job_id = p_outbox_job_id
        and delivery.group_id = p_group_id
        and delivery.state = 'retryable'::public.notification_delivery_state
    ),
    exists (
      select 1 from public.notification_deliveries as delivery
      where delivery.outbox_job_id = p_outbox_job_id
        and delivery.group_id = p_group_id
        and delivery.state = 'queued'::public.notification_delivery_state
    ) or exists (
      select 1 from public.notification_push_deliveries as delivery
      where delivery.outbox_job_id = p_outbox_job_id
        and delivery.group_id = p_group_id
        and delivery.state = 'queued'::public.notification_delivery_state
    ),
    exists (
      select 1 from public.notification_deliveries as delivery
      where delivery.outbox_job_id = p_outbox_job_id
        and delivery.group_id = p_group_id
        and delivery.state = 'failed_permanent'::public.notification_delivery_state
    ) or exists (
      select 1 from public.notification_push_deliveries as delivery
      where delivery.outbox_job_id = p_outbox_job_id
        and delivery.group_id = p_group_id
        and delivery.state = 'failed_permanent'::public.notification_delivery_state
    ),
    exists (
      select 1 from public.notification_deliveries as delivery
      where delivery.outbox_job_id = p_outbox_job_id
        and delivery.group_id = p_group_id
        and delivery.state = 'sent'::public.notification_delivery_state
    ) or exists (
      select 1 from public.notification_push_deliveries as delivery
      where delivery.outbox_job_id = p_outbox_job_id
        and delivery.group_id = p_group_id
        and delivery.state = 'sent'::public.notification_delivery_state
    ),
    exists (
      select 1 from public.notification_deliveries as delivery
      where delivery.outbox_job_id = p_outbox_job_id
        and delivery.group_id = p_group_id
        and delivery.state in (
          'cancelled'::public.notification_delivery_state,
          'suppressed'::public.notification_delivery_state
        )
    ) or exists (
      select 1 from public.notification_push_deliveries as delivery
      where delivery.outbox_job_id = p_outbox_job_id
        and delivery.group_id = p_group_id
        and delivery.state = 'cancelled'::public.notification_delivery_state
    )
  into has_sending, has_retryable, has_queued, has_failed_permanent,
       has_sent, has_cancelled;

  if has_sending then
    update public.notification_outbox_jobs
    set state = 'processing'::public.notification_outbox_job_state,
        finished_at = null,
        next_attempt_at = now_at
    where id = p_outbox_job_id
      and group_id = p_group_id
      and state <> 'cancelled'::public.notification_outbox_job_state;
    return;
  end if;

  if has_retryable or has_queued then
    select least(
      coalesce((
        select min(delivery.next_attempt_at)
        from public.notification_deliveries as delivery
        where delivery.outbox_job_id = p_outbox_job_id
          and delivery.group_id = p_group_id
          and delivery.state in ('queued', 'retryable')
      ), 'infinity'::timestamptz),
      coalesce((
        select min(delivery.next_attempt_at)
        from public.notification_push_deliveries as delivery
        where delivery.outbox_job_id = p_outbox_job_id
          and delivery.group_id = p_group_id
          and delivery.state in ('queued', 'retryable')
      ), 'infinity'::timestamptz)
    ) into next_retry_at;

    update public.notification_outbox_jobs
    set state = case
          when has_retryable then 'retryable'::public.notification_outbox_job_state
          else 'queued'::public.notification_outbox_job_state
        end,
        safe_error = null,
        claimed_at = null,
        finished_at = null,
        next_attempt_at = coalesce(next_retry_at, now_at)
    where id = p_outbox_job_id
      and group_id = p_group_id
      and state <> 'cancelled'::public.notification_outbox_job_state;
    return;
  end if;

  update public.notification_outbox_jobs
  set state = case
        when has_failed_permanent then 'abandoned'::public.notification_outbox_job_state
        when has_sent then 'succeeded'::public.notification_outbox_job_state
        when has_cancelled then 'cancelled'::public.notification_outbox_job_state
        else 'succeeded'::public.notification_outbox_job_state
      end,
      safe_error = case
        when has_failed_permanent then 'child_delivery_failed'
        when has_cancelled and not has_sent then coalesce(safe_error, 'no_sendable_recipients')
        else null
      end,
      claimed_at = null,
      finished_at = now_at,
      next_attempt_at = now_at
  where id = p_outbox_job_id
    and group_id = p_group_id
    and state <> 'cancelled'::public.notification_outbox_job_state;
end;
$$;

-- The existing receipt worker is intentionally results-specific. Preserve the
-- generic receipt trigger used by health/retention projections, but remove the
-- cancellation receipt in the same trigger transaction so no unclaimable row
-- remains for the mandatory cancellation channel.
create or replace function app.enqueue_results_push_receipt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.state = 'sent'::public.notification_delivery_state
    and new.provider_message_id is not null
    and (
      tg_op = 'INSERT'
      or old.state is distinct from new.state
      or old.provider_message_id is distinct from new.provider_message_id
    )
  then
    insert into public.notification_push_receipts (
      group_id,
      delivery_id,
      device_id,
      provider_message_id,
      next_attempt_at
    )
    values (
      new.group_id,
      new.id,
      new.device_id,
      new.provider_message_id,
      pg_catalog.now() + interval '15 minutes'
    )
    on conflict (delivery_id) do nothing;

    delete from public.notification_push_receipts as receipt
    using public.notification_outbox_jobs as outbox
    where receipt.delivery_id = new.id
      and receipt.group_id = new.group_id
      and outbox.id = new.outbox_job_id
      and outbox.group_id = new.group_id
      and outbox.event_type = 'round.cancelled'
      and outbox.aggregate_type = 'round';
  end if;
  return new;
end;
$$;

revoke all on function app.enqueue_results_push_receipt()
from public, anon, authenticated, service_role;

revoke all on function app.refresh_round_cancelled_outbox_state(uuid, uuid)
from public, anon, authenticated, service_role;

create function app.queue_round_cancelled_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  now_at timestamptz := pg_catalog.clock_timestamp();
begin
  if new.event_type <> 'round.cancelled'
    or new.aggregate_type <> 'round'
  then
    return new;
  end if;

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
    new.group_id,
    new.id,
    participant.membership_id,
    membership.user_id,
    device.device_id,
    'queued'::public.notification_delivery_state,
    now_at
  from public.rounds as round_record
  join public.round_participants as participant
    on participant.round_id = round_record.id
   and participant.group_id = round_record.group_id
  join public.memberships as membership
    on membership.id = participant.membership_id
   and membership.group_id = participant.group_id
   and membership.status = 'active'::public.membership_status
   and membership.user_id is not null
  join public.user_profiles as profile
    on profile.user_id = membership.user_id
   and profile.disabled_at is null
  join auth.users as identity
    on identity.id = membership.user_id
   and identity.email_confirmed_at is not null
   and identity.deleted_at is null
   and not identity.is_anonymous
   and (identity.banned_until is null or identity.banned_until <= now_at)
  join public.push_devices as device
    on device.user_id = membership.user_id
   and device.active
  where round_record.id = new.aggregate_id
    and round_record.group_id = new.group_id
    and round_record.state = 'cancelled'::public.round_state
    and new.idempotency_key = 'round.cancelled:'
      || round_record.id::text
      || ':'
      || participant.membership_id::text
  on conflict do nothing;

  -- Draft cancellation can legitimately have no participants. Do not leave a
  -- permanently claimable parent in that case.
  if not exists (
    select 1
    from public.round_participants as participant
    where participant.round_id = new.aggregate_id
      and participant.group_id = new.group_id
  ) then
    update public.notification_outbox_jobs
    set state = 'succeeded'::public.notification_outbox_job_state,
        safe_error = 'no_sendable_recipients',
        finished_at = now_at,
        next_attempt_at = now_at
    where id = new.id
      and group_id = new.group_id
      and state = 'queued'::public.notification_outbox_job_state;
  end if;

  return new;
end;
$$;

revoke all on function app.queue_round_cancelled_push()
from public, anon, authenticated, service_role;

create trigger notification_outbox_round_cancelled_push_fanout
after insert on public.notification_outbox_jobs
for each row execute function app.queue_round_cancelled_push();

-- Existing cancellation e-mail code can terminalize the parent while a
-- mandatory push child is still queued. Re-open only the parent state; child
-- rows remain the durable source of truth and are reconciled below.
create function app.reconcile_round_cancelled_parent_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The refresh helper itself updates the parent, so nested trigger calls
  -- must stop after the first reconciliation pass.
  if pg_catalog.pg_trigger_depth() > 1 then
    return new;
  end if;

  if new.event_type = 'round.cancelled'
    and new.aggregate_type = 'round'
    and new.state in (
      'succeeded'::public.notification_outbox_job_state,
      'abandoned'::public.notification_outbox_job_state,
      'cancelled'::public.notification_outbox_job_state
    )
  then
    perform app.refresh_round_cancelled_outbox_state(new.id, new.group_id);
    return new;
  end if;

  return new;
end;
$$;

revoke all on function app.reconcile_round_cancelled_parent_state()
from public, anon, authenticated, service_role;

create trigger notification_outbox_round_cancelled_parent_reconcile
after update of state on public.notification_outbox_jobs
for each row execute function app.reconcile_round_cancelled_parent_state();

-- The original e-mail claim predates sibling push children and only accepts a
-- queued parent. A tiny compatibility wrapper makes a processing parent
-- claimable when only the e-mail child is waiting; the legacy body continues
-- to own all recipient validation and audit-safe claim semantics.
alter function public.claim_round_cancelled_email(uuid, timestamptz)
rename to claim_round_cancelled_email_legacy;

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
begin
  update public.notification_outbox_jobs as outbox
  set state = 'queued'::public.notification_outbox_job_state,
      claimed_at = null,
      finished_at = null,
      safe_error = null,
      next_attempt_at = pg_catalog.clock_timestamp()
  where outbox.event_type = 'round.cancelled'
    and outbox.aggregate_type = 'round'
    and outbox.state = 'processing'::public.notification_outbox_job_state
    and exists (
      select 1 from public.notification_deliveries as delivery
      where delivery.outbox_job_id = outbox.id
        and delivery.group_id = outbox.group_id
        and delivery.channel = 'email'::public.notification_channel
        and delivery.state in (
          'queued'::public.notification_delivery_state,
          'retryable'::public.notification_delivery_state
        )
    );

  return query
  select * from public.claim_round_cancelled_email_legacy(
    p_claim_token,
    p_stale_before
  );
end;
$$;

revoke all on function public.claim_round_cancelled_email(uuid, timestamptz)
from public, anon, authenticated, service_role;
grant execute on function public.claim_round_cancelled_email(uuid, timestamptz)
to service_role;
revoke all on function public.claim_round_cancelled_email_legacy(uuid, timestamptz)
from public, anon, authenticated, service_role;

create function public.claim_round_cancelled_push(
  p_claim_token uuid,
  p_stale_before timestamptz
)
returns table (
  delivery_id app.entity_id,
  outbox_job_id app.entity_id,
  round_id app.entity_id,
  group_id app.entity_id,
  round_description text,
  cancellation_reason text,
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
  selected_delivery record;
  stale_delivery record;
  invalid_delivery record;
begin
  if p_claim_token is null then
    raise exception 'delivery_claim_token_required' using errcode = '22004';
  end if;
  if p_stale_before is null or p_stale_before > now_at then
    raise exception 'delivery_stale_boundary_invalid' using errcode = '22023';
  end if;

  for stale_delivery in
    select delivery.id, delivery.group_id, delivery.outbox_job_id
    from public.notification_push_deliveries as delivery
    join public.notification_outbox_jobs as outbox
      on outbox.id = delivery.outbox_job_id
     and outbox.group_id = delivery.group_id
    where delivery.state = 'sending'::public.notification_delivery_state
      and delivery.claimed_at <= p_stale_before
      and outbox.event_type = 'round.cancelled'
      and outbox.aggregate_type = 'round'
      and outbox.state in (
        'processing'::public.notification_outbox_job_state,
        'queued'::public.notification_outbox_job_state,
        'retryable'::public.notification_outbox_job_state
      )
    for update of delivery, outbox skip locked
  loop
    update public.notification_push_deliveries as target
    set state = 'retryable'::public.notification_delivery_state,
        failure_reason = 'claim_expired',
        claim_token = null,
        claimed_at = null,
        next_attempt_at = now_at
    where target.id = stale_delivery.id
      and target.group_id = stale_delivery.group_id;
    perform app.refresh_round_cancelled_outbox_state(
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
        when round_record.state <> 'cancelled'::public.round_state then 'round_not_cancelled'
        when membership.status <> 'active'::public.membership_status then 'member_inactive'
        when profile.user_id is null or profile.disabled_at is not null
          or identity.id is null
          or identity.email_confirmed_at is null
          or identity.deleted_at is not null
          or identity.is_anonymous
          or (identity.banned_until is not null and identity.banned_until > now_at)
          then 'member_identity_unavailable'
        when device.user_id is distinct from membership.user_id or not device.active
          then 'push_device_unavailable'
        else null
      end as safe_reason
    from public.notification_push_deliveries as delivery
    join public.notification_outbox_jobs as outbox
      on outbox.id = delivery.outbox_job_id
     and outbox.group_id = delivery.group_id
    join public.rounds as round_record
      on round_record.id = outbox.aggregate_id
     and round_record.group_id = outbox.group_id
    join public.memberships as membership
      on membership.id = delivery.recipient_membership_id
     and membership.group_id = delivery.group_id
    left join public.user_profiles as profile
      on profile.user_id = membership.user_id
    left join auth.users as identity
      on identity.id = membership.user_id
    join public.push_devices as device
      on device.device_id = delivery.device_id
    where delivery.state in (
        'queued'::public.notification_delivery_state,
        'retryable'::public.notification_delivery_state
      )
      and delivery.next_attempt_at <= now_at
      and outbox.next_attempt_at <= now_at
      and outbox.event_type = 'round.cancelled'
      and outbox.aggregate_type = 'round'
      and outbox.state in (
        'queued'::public.notification_outbox_job_state,
        'retryable'::public.notification_outbox_job_state,
        'processing'::public.notification_outbox_job_state
      )
      and (
        round_record.state <> 'cancelled'::public.round_state
        or membership.status <> 'active'::public.membership_status
        or profile.user_id is null
        or profile.disabled_at is not null
        or identity.id is null
        or identity.email_confirmed_at is null
        or identity.deleted_at is not null
        or identity.is_anonymous
        or (identity.banned_until is not null and identity.banned_until > now_at)
        or device.user_id is distinct from membership.user_id
        or not device.active
      )
    order by delivery.next_attempt_at, delivery.created_at, delivery.id
    for update of delivery, outbox skip locked
  loop
    update public.notification_push_deliveries as target
    set state = 'cancelled'::public.notification_delivery_state,
        failure_reason = invalid_delivery.safe_reason,
        claim_token = null,
        claimed_at = null,
        next_attempt_at = now_at
    where target.id = invalid_delivery.id
      and target.group_id = invalid_delivery.group_id;
    perform app.refresh_round_cancelled_outbox_state(
      invalid_delivery.outbox_job_id,
      invalid_delivery.group_id
    );
  end loop;

  select
    delivery.id as delivery_id,
    outbox.id as outbox_job_id,
    round_record.id as round_id,
    delivery.group_id,
    coalesce(round_record.description, 'Round') as round_description,
    round_record.cancellation_reason,
    delivery.recipient_user_id,
    delivery.device_id,
    device.expo_push_token,
    delivery.attempts + 1 as attempt_number
  into selected_delivery
  from public.notification_push_deliveries as delivery
  join public.notification_outbox_jobs as outbox
    on outbox.id = delivery.outbox_job_id
   and outbox.group_id = delivery.group_id
  join public.rounds as round_record
    on round_record.id = outbox.aggregate_id
   and round_record.group_id = outbox.group_id
   and round_record.state = 'cancelled'::public.round_state
  join public.memberships as membership
    on membership.id = delivery.recipient_membership_id
   and membership.group_id = delivery.group_id
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
  join public.push_devices as device
    on device.device_id = delivery.device_id
   and device.user_id = membership.user_id
   and device.active
  where delivery.state in (
      'queued'::public.notification_delivery_state,
      'retryable'::public.notification_delivery_state
    )
    and delivery.next_attempt_at <= now_at
    and outbox.next_attempt_at <= now_at
    and outbox.event_type = 'round.cancelled'
    and outbox.aggregate_type = 'round'
    and outbox.state in (
      'queued'::public.notification_outbox_job_state,
      'retryable'::public.notification_outbox_job_state,
      'processing'::public.notification_outbox_job_state
    )
  order by delivery.next_attempt_at, device.device_id, delivery.created_at, delivery.id
  for update of delivery, outbox skip locked
  limit 1;

  if not found then
    return;
  end if;

  update public.notification_push_deliveries as target
  set state = 'sending'::public.notification_delivery_state,
      claim_token = p_claim_token,
      claimed_at = now_at,
      attempts = selected_delivery.attempt_number,
      failure_reason = null
  where target.id = selected_delivery.delivery_id
    and target.group_id = selected_delivery.group_id;

  update public.notification_outbox_jobs as target
  set state = 'processing'::public.notification_outbox_job_state,
      claimed_at = now_at,
      attempts = greatest(attempts, selected_delivery.attempt_number),
      safe_error = null,
      finished_at = null
  where target.id = selected_delivery.outbox_job_id
    and target.group_id = selected_delivery.group_id;

  return query
  select selected_delivery.delivery_id::app.entity_id,
         selected_delivery.outbox_job_id::app.entity_id,
         selected_delivery.round_id::app.entity_id,
         selected_delivery.group_id::app.entity_id,
         selected_delivery.round_description::text,
         selected_delivery.cancellation_reason::text,
         selected_delivery.recipient_user_id::app.entity_id,
         selected_delivery.device_id::app.entity_id,
         selected_delivery.expo_push_token::text,
         selected_delivery.attempt_number::integer;
end;
$$;

comment on function public.claim_round_cancelled_push(uuid, timestamptz) is
  'Service-only atomic claim for one mandatory cancellation push. Quiet hours do not delay cancellation alerts; raw Expo tokens are returned only to the trusted worker.';

revoke all on function public.claim_round_cancelled_push(uuid, timestamptz)
from public, anon, authenticated, service_role;
grant execute on function public.claim_round_cancelled_push(uuid, timestamptz)
to service_role;

create function public.record_round_cancelled_push_send_success(
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
  delivery_record public.notification_push_deliveries%rowtype;
  now_at timestamptz := pg_catalog.clock_timestamp();
begin
  if p_delivery_id is null or p_claim_token is null then
    raise exception 'delivery_context_required' using errcode = '22004';
  end if;
  if p_provider_message_id is null
    or pg_catalog.btrim(p_provider_message_id) <> p_provider_message_id
    or pg_catalog.length(p_provider_message_id) not between 1 and 255
  then
    raise exception 'provider_message_id_invalid' using errcode = '22023';
  end if;

  select delivery.* into delivery_record
  from public.notification_push_deliveries as delivery
  join public.notification_outbox_jobs as outbox
    on outbox.id = delivery.outbox_job_id
   and outbox.group_id = delivery.group_id
  where delivery.id = p_delivery_id
    and delivery.state = 'sending'::public.notification_delivery_state
    and delivery.claim_token = p_claim_token
    and outbox.event_type = 'round.cancelled'
    and outbox.aggregate_type = 'round'
  for update of delivery, outbox;
  if not found then
    raise exception 'delivery_claim_invalid' using errcode = 'P0002';
  end if;

  update public.notification_push_deliveries as target
  set provider_message_id = p_provider_message_id,
      state = 'sent'::public.notification_delivery_state,
      sent_at = now_at,
      claim_token = null,
      claimed_at = null,
      failure_reason = null,
      next_attempt_at = now_at
  where target.id = delivery_record.id
    and target.group_id = delivery_record.group_id;
  perform app.refresh_round_cancelled_outbox_state(
    delivery_record.outbox_job_id,
    delivery_record.group_id
  );
end;
$$;

revoke all on function public.record_round_cancelled_push_send_success(uuid, uuid, text)
from public, anon, authenticated, service_role;
grant execute on function public.record_round_cancelled_push_send_success(uuid, uuid, text)
to service_role;

create function public.record_round_cancelled_push_send_failure(
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
  delivery_record public.notification_push_deliveries%rowtype;
  now_at timestamptz := pg_catalog.clock_timestamp();
begin
  if p_delivery_id is null or p_claim_token is null then
    raise exception 'delivery_context_required' using errcode = '22004';
  end if;
  if p_safe_error is null
    or pg_catalog.length(pg_catalog.btrim(p_safe_error)) not between 1 and 200
    or p_safe_error !~ '^[a-z0-9][a-z0-9_.:-]{0,199}$'
  then
    raise exception 'safe_error_invalid' using errcode = '22023';
  end if;
  if p_retry_at is not null and p_retry_at <= now_at then
    raise exception 'retry_at_invalid' using errcode = '22023';
  end if;

  select delivery.* into delivery_record
  from public.notification_push_deliveries as delivery
  join public.notification_outbox_jobs as outbox
    on outbox.id = delivery.outbox_job_id
   and outbox.group_id = delivery.group_id
  where delivery.id = p_delivery_id
    and delivery.state = 'sending'::public.notification_delivery_state
    and delivery.claim_token = p_claim_token
    and outbox.event_type = 'round.cancelled'
    and outbox.aggregate_type = 'round'
  for update of delivery, outbox;
  if not found then
    raise exception 'delivery_claim_invalid' using errcode = 'P0002';
  end if;

  update public.notification_push_deliveries as target
  set state = case
        when p_retry_at is null then 'failed_permanent'::public.notification_delivery_state
        else 'retryable'::public.notification_delivery_state
      end,
      failure_reason = p_safe_error,
      claim_token = null,
      claimed_at = null,
      next_attempt_at = coalesce(p_retry_at, now_at)
  where target.id = delivery_record.id
    and target.group_id = delivery_record.group_id;
  perform app.refresh_round_cancelled_outbox_state(
    delivery_record.outbox_job_id,
    delivery_record.group_id
  );
end;
$$;

revoke all on function public.record_round_cancelled_push_send_failure(uuid, uuid, text, timestamptz)
from public, anon, authenticated, service_role;
grant execute on function public.record_round_cancelled_push_send_failure(uuid, uuid, text, timestamptz)
to service_role;

create function public.record_round_cancelled_push_invalid_device(
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
    or p_group_id is null or p_correlation_id is null or p_operation_id is null
  then
    raise exception 'delivery_context_required' using errcode = '22004';
  end if;

  select delivery.* into delivery_record
  from public.notification_push_deliveries as delivery
  join public.notification_outbox_jobs as outbox
    on outbox.id = delivery.outbox_job_id
   and outbox.group_id = delivery.group_id
  where delivery.id = p_delivery_id
    and delivery.state = 'sending'::public.notification_delivery_state
    and delivery.claim_token = p_claim_token
    and delivery.device_id = p_device_id
    and delivery.group_id = p_group_id
    and outbox.event_type = 'round.cancelled'
    and outbox.aggregate_type = 'round'
  for update of delivery, outbox;
  if not found then
    raise exception 'delivery_claim_invalid' using errcode = 'P0002';
  end if;

  perform public.retire_results_push_device_on_provider_invalid(
    p_device_id,
    p_group_id,
    p_correlation_id,
    p_operation_id
  );

  update public.notification_push_deliveries as target
  set state = 'failed_permanent'::public.notification_delivery_state,
      failure_reason = 'provider_invalid',
      claim_token = null,
      claimed_at = null,
      next_attempt_at = now_at
  where target.id = delivery_record.id
    and target.group_id = delivery_record.group_id;
  perform app.refresh_round_cancelled_outbox_state(
    delivery_record.outbox_job_id,
    delivery_record.group_id
  );
end;
$$;

comment on function public.record_round_cancelled_push_invalid_device(uuid, uuid, uuid, uuid, uuid, uuid) is
  'Service-only atomic provider-invalid finalization and Expo-device retirement boundary for cancellation pushes.';

revoke all on function public.record_round_cancelled_push_invalid_device(uuid, uuid, uuid, uuid, uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.record_round_cancelled_push_invalid_device(uuid, uuid, uuid, uuid, uuid, uuid)
to service_role;
