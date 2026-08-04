-- Phase 06: durable Expo push-receipt polling.
--
-- Expo accepts a push ticket before it has finished delivering to the device.
-- A separate, service-only receipt queue records that provider follow-up without
-- copying the raw token out of push_devices.  Receipt outcomes never mutate the
-- already-sent notification delivery or its completion outbox row; they only
-- make provider feedback durable and retire an invalid install atomically.

create type public.notification_push_receipt_state as enum (
  'queued',
  'sending',
  'succeeded',
  'retryable',
  'failed_permanent',
  'cancelled'
);

create table public.notification_push_receipts (
  id app.entity_id primary key default extensions.gen_random_uuid(),
  group_id app.entity_id not null,
  delivery_id app.entity_id not null,
  device_id app.entity_id not null references public.push_devices (device_id) on delete restrict,
  provider_message_id text not null,
  state public.notification_push_receipt_state not null default 'queued',
  attempts integer not null default 0,
  failure_reason text,
  next_attempt_at app.utc_instant not null default pg_catalog.now(),
  claim_token uuid,
  claimed_at app.utc_instant,
  resolved_at app.utc_instant,
  created_at app.utc_instant not null default pg_catalog.now(),
  updated_at app.utc_instant not null default pg_catalog.now(),
  constraint notification_push_receipts_id_group_unique unique (id, group_id),
  constraint notification_push_receipts_delivery_group_fk
    foreign key (delivery_id, group_id)
    references public.notification_push_deliveries (id, group_id)
    on delete restrict,
  constraint notification_push_receipts_attempts_nonnegative check (attempts >= 0),
  constraint notification_push_receipts_failure_reason_bounded check (
    failure_reason is null or pg_catalog.length(failure_reason) <= 2000
  ),
  constraint notification_push_receipts_provider_message_id_bounded check (
    pg_catalog.btrim(provider_message_id) = provider_message_id
    and pg_catalog.length(provider_message_id) between 1 and 255
  ),
  constraint notification_push_receipts_claim_consistent check (
    (state = 'sending' and claim_token is not null and claimed_at is not null)
    or (state <> 'sending' and claim_token is null and claimed_at is null)
  ),
  constraint notification_push_receipts_resolved_state_consistent check (
    resolved_at is null
    or state in (
      'succeeded'::public.notification_push_receipt_state,
      'failed_permanent'::public.notification_push_receipt_state,
      'cancelled'::public.notification_push_receipt_state
    )
  )
);

comment on table public.notification_push_receipts is
  'Service-only Expo receipt polling queue. It retains provider ticket identifiers and outcomes, never raw Expo push tokens.';
comment on column public.notification_push_receipts.provider_message_id is
  'Expo push ticket identifier returned by the trusted send worker; it is not the device token.';

create unique index notification_push_receipts_delivery_unique_idx
on public.notification_push_receipts (delivery_id);

create unique index notification_push_receipts_provider_message_unique_idx
on public.notification_push_receipts (provider_message_id);

create index notification_push_receipts_claim_idx
on public.notification_push_receipts (state, next_attempt_at, created_at, id);

create index notification_push_receipts_group_created_idx
on public.notification_push_receipts (group_id, created_at desc);

create trigger notification_push_receipts_immutable_id
before update of id on public.notification_push_receipts
for each row execute function app.reject_id_change('id');

create trigger notification_push_receipts_immutable_group
before update of group_id on public.notification_push_receipts
for each row execute function app.reject_id_change('group_id');

create trigger notification_push_receipts_immutable_delivery
before update of delivery_id on public.notification_push_receipts
for each row execute function app.reject_id_change('delivery_id');

create trigger notification_push_receipts_immutable_device
before update of device_id on public.notification_push_receipts
for each row execute function app.reject_id_change('device_id');

create trigger notification_push_receipts_immutable_provider_message
before update of provider_message_id on public.notification_push_receipts
for each row execute function app.reject_id_change('provider_message_id');

create trigger notification_push_receipts_set_updated_at
before update on public.notification_push_receipts
for each row execute function app.set_updated_at();

alter table public.notification_push_receipts enable row level security;
alter table public.notification_push_receipts force row level security;

revoke all on table public.notification_push_receipts
from public, anon, authenticated;
grant select on table public.notification_push_receipts to service_role;

-- A push ticket is not a delivery receipt yet.  Queue exactly one provider
-- follow-up whenever the delivery transitions to sent.  The unique delivery
-- key keeps a replayed provider success from creating duplicate polling work.
create function app.enqueue_results_push_receipt()
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
      provider_message_id
    )
    values (
      new.group_id,
      new.id,
      new.device_id,
      new.provider_message_id
    )
    on conflict (delivery_id) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function app.enqueue_results_push_receipt()
from public, anon, authenticated, service_role;

create trigger notification_push_deliveries_enqueue_receipt
after insert or update of state, provider_message_id
on public.notification_push_deliveries
for each row execute function app.enqueue_results_push_receipt();

create function public.claim_results_push_receipt(
  p_claim_token uuid,
  p_stale_before timestamptz
)
returns table (
  receipt_id app.entity_id,
  delivery_id app.entity_id,
  group_id app.entity_id,
  device_id app.entity_id,
  provider_message_id text,
  attempt_number integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  now_at timestamptz := pg_catalog.clock_timestamp();
  selected_receipt record;
  stale_receipt record;
begin
  if p_claim_token is null then
    raise exception 'receipt_claim_token_required' using errcode = '22004';
  end if;
  if p_stale_before is null or p_stale_before > now_at then
    raise exception 'receipt_stale_boundary_invalid' using errcode = '22023';
  end if;

  -- A crashed receipt worker must not strand a provider ticket.  Reopened
  -- result events are cancelled; otherwise the ticket becomes due again.
  for stale_receipt in
    select
      receipt.id,
      receipt.group_id,
      receipt.delivery_id,
      delivery.outbox_job_id,
      app.results_outbox_withdrawn(delivery.outbox_job_id, delivery.group_id) as withdrawn
    from public.notification_push_receipts as receipt
    join public.notification_push_deliveries as delivery
      on delivery.id = receipt.delivery_id
     and delivery.group_id = receipt.group_id
    join public.notification_outbox_jobs as outbox
      on outbox.id = delivery.outbox_job_id
     and outbox.group_id = delivery.group_id
    where receipt.state = 'sending'::public.notification_push_receipt_state
      and receipt.claimed_at <= p_stale_before
      and delivery.state = 'sent'::public.notification_delivery_state
      and outbox.event_type = 'results_published'
      and outbox.aggregate_type = 'round_completion'
    for update of receipt skip locked
  loop
    update public.notification_push_receipts as target
    set state = case
          when stale_receipt.withdrawn
            then 'cancelled'::public.notification_push_receipt_state
          else 'retryable'::public.notification_push_receipt_state
        end,
        failure_reason = case
          when stale_receipt.withdrawn then 'round_reopened'
          else 'claim_expired'
        end,
        claim_token = null,
        claimed_at = null,
        resolved_at = case
          when stale_receipt.withdrawn then now_at
          else null
        end,
        next_attempt_at = now_at
    where target.id = stale_receipt.id
      and target.group_id = stale_receipt.group_id;
  end loop;

  select
    receipt.id as receipt_id,
    receipt.delivery_id,
    receipt.group_id,
    receipt.device_id,
    receipt.provider_message_id,
    receipt.attempts + 1 as attempt_number
  into selected_receipt
  from public.notification_push_receipts as receipt
  join public.notification_push_deliveries as delivery
    on delivery.id = receipt.delivery_id
   and delivery.group_id = receipt.group_id
   and delivery.state = 'sent'::public.notification_delivery_state
   and delivery.provider_message_id = receipt.provider_message_id
  join public.notification_outbox_jobs as outbox
    on outbox.id = delivery.outbox_job_id
   and outbox.group_id = delivery.group_id
  where receipt.state in (
      'queued'::public.notification_push_receipt_state,
      'retryable'::public.notification_push_receipt_state
    )
    and receipt.next_attempt_at <= now_at
    and outbox.event_type = 'results_published'
    and outbox.aggregate_type = 'round_completion'
  order by receipt.next_attempt_at, receipt.created_at, receipt.id
  for update of receipt
  skip locked
  limit 1;

  if not found then
    return;
  end if;

  update public.notification_push_receipts as target
  set state = 'sending'::public.notification_push_receipt_state,
      claim_token = p_claim_token,
      claimed_at = now_at,
      attempts = selected_receipt.attempt_number,
      failure_reason = null,
      resolved_at = null
  where target.id = selected_receipt.receipt_id
    and target.group_id = selected_receipt.group_id;

  return query
  select
    selected_receipt.receipt_id::app.entity_id,
    selected_receipt.delivery_id::app.entity_id,
    selected_receipt.group_id::app.entity_id,
    selected_receipt.device_id::app.entity_id,
    selected_receipt.provider_message_id::text,
    selected_receipt.attempt_number::integer;
end;
$$;

comment on function public.claim_results_push_receipt(uuid, timestamptz) is
  'Service-only lease for one Expo push receipt. Stale leases are retried, while reopened result events are cancelled.';

revoke all on function public.claim_results_push_receipt(uuid, timestamptz)
from public, anon, authenticated;
grant execute on function public.claim_results_push_receipt(uuid, timestamptz)
to service_role;

create function public.record_results_push_receipt_success(
  p_receipt_id uuid,
  p_claim_token uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  receipt_record public.notification_push_receipts%rowtype;
  now_at timestamptz := pg_catalog.clock_timestamp();
begin
  if p_receipt_id is null or p_claim_token is null then
    raise exception 'receipt_context_required' using errcode = '22004';
  end if;

  select receipt.*
  into receipt_record
  from public.notification_push_receipts as receipt
  join public.notification_push_deliveries as delivery
    on delivery.id = receipt.delivery_id
   and delivery.group_id = receipt.group_id
  join public.notification_outbox_jobs as outbox
    on outbox.id = delivery.outbox_job_id
   and outbox.group_id = delivery.group_id
  where receipt.id = p_receipt_id
    and receipt.state = 'sending'::public.notification_push_receipt_state
    and receipt.claim_token = p_claim_token
    and delivery.state = 'sent'::public.notification_delivery_state
    and outbox.event_type = 'results_published'
    and outbox.aggregate_type = 'round_completion'
  for update of receipt;
  if not found then
    raise exception 'receipt_claim_invalid' using errcode = 'P0002';
  end if;

  update public.notification_push_receipts as target
  set state = 'succeeded'::public.notification_push_receipt_state,
      claim_token = null,
      claimed_at = null,
      failure_reason = null,
      resolved_at = now_at,
      next_attempt_at = now_at
  where target.id = receipt_record.id
    and target.group_id = receipt_record.group_id;
end;
$$;

revoke all on function public.record_results_push_receipt_success(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.record_results_push_receipt_success(uuid, uuid)
to service_role;

create function public.record_results_push_receipt_failure(
  p_receipt_id uuid,
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
  receipt_record public.notification_push_receipts%rowtype;
  now_at timestamptz := pg_catalog.clock_timestamp();
begin
  if p_receipt_id is null or p_claim_token is null then
    raise exception 'receipt_context_required' using errcode = '22004';
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

  select receipt.*
  into receipt_record
  from public.notification_push_receipts as receipt
  join public.notification_push_deliveries as delivery
    on delivery.id = receipt.delivery_id
   and delivery.group_id = receipt.group_id
  join public.notification_outbox_jobs as outbox
    on outbox.id = delivery.outbox_job_id
   and outbox.group_id = delivery.group_id
  where receipt.id = p_receipt_id
    and receipt.state = 'sending'::public.notification_push_receipt_state
    and receipt.claim_token = p_claim_token
    and delivery.state = 'sent'::public.notification_delivery_state
    and outbox.event_type = 'results_published'
    and outbox.aggregate_type = 'round_completion'
  for update of receipt;
  if not found then
    raise exception 'receipt_claim_invalid' using errcode = 'P0002';
  end if;

  if app.results_outbox_withdrawn(
    (
      select delivery.outbox_job_id
      from public.notification_push_deliveries as delivery
      where delivery.id = receipt_record.delivery_id
        and delivery.group_id = receipt_record.group_id
    ),
    receipt_record.group_id
  ) then
    update public.notification_push_receipts as target
    set state = 'cancelled'::public.notification_push_receipt_state,
        failure_reason = 'round_reopened',
        claim_token = null,
        claimed_at = null,
        resolved_at = now_at,
        next_attempt_at = now_at
    where target.id = receipt_record.id
      and target.group_id = receipt_record.group_id;
  elsif p_retry_at is null then
    update public.notification_push_receipts as target
    set state = 'failed_permanent'::public.notification_push_receipt_state,
        failure_reason = p_safe_error,
        claim_token = null,
        claimed_at = null,
        resolved_at = now_at,
        next_attempt_at = now_at
    where target.id = receipt_record.id
      and target.group_id = receipt_record.group_id;
  else
    update public.notification_push_receipts as target
    set state = 'retryable'::public.notification_push_receipt_state,
        failure_reason = p_safe_error,
        claim_token = null,
        claimed_at = null,
        resolved_at = null,
        next_attempt_at = p_retry_at
    where target.id = receipt_record.id
      and target.group_id = receipt_record.group_id;
  end if;
end;
$$;

revoke all on function public.record_results_push_receipt_failure(uuid, uuid, text, timestamptz)
from public, anon, authenticated;
grant execute on function public.record_results_push_receipt_failure(uuid, uuid, text, timestamptz)
to service_role;

create function public.record_results_push_receipt_invalid_device(
  p_receipt_id uuid,
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
  receipt_record public.notification_push_receipts%rowtype;
  now_at timestamptz := pg_catalog.clock_timestamp();
begin
  if p_receipt_id is null
    or p_claim_token is null
    or p_device_id is null
    or p_group_id is null
    or p_correlation_id is null
    or p_operation_id is null
  then
    raise exception 'receipt_context_required' using errcode = '22004';
  end if;

  select receipt.*
  into receipt_record
  from public.notification_push_receipts as receipt
  join public.notification_push_deliveries as delivery
    on delivery.id = receipt.delivery_id
   and delivery.group_id = receipt.group_id
   and delivery.device_id = p_device_id
  join public.notification_outbox_jobs as outbox
    on outbox.id = delivery.outbox_job_id
   and outbox.group_id = delivery.group_id
  where receipt.id = p_receipt_id
    and receipt.group_id = p_group_id
    and receipt.device_id = p_device_id
    and receipt.state = 'sending'::public.notification_push_receipt_state
    and receipt.claim_token = p_claim_token
    and delivery.state = 'sent'::public.notification_delivery_state
    and outbox.event_type = 'results_published'
    and outbox.aggregate_type = 'round_completion'
  for update of receipt;
  if not found then
    raise exception 'receipt_claim_invalid' using errcode = 'P0002';
  end if;

  -- The retirement helper locks the device and writes its redacted provider
  -- audit event.  Any error rolls this receipt update back atomically.
  perform public.retire_results_push_device_on_provider_invalid(
    p_device_id,
    p_group_id,
    p_correlation_id,
    p_operation_id
  );

  if app.results_outbox_withdrawn(
    (
      select delivery.outbox_job_id
      from public.notification_push_deliveries as delivery
      where delivery.id = receipt_record.delivery_id
        and delivery.group_id = receipt_record.group_id
    ),
    receipt_record.group_id
  ) then
    update public.notification_push_receipts as target
    set state = 'cancelled'::public.notification_push_receipt_state,
        failure_reason = 'round_reopened',
        claim_token = null,
        claimed_at = null,
        resolved_at = now_at,
        next_attempt_at = now_at
    where target.id = receipt_record.id
      and target.group_id = receipt_record.group_id;
  else
    update public.notification_push_receipts as target
    set state = 'failed_permanent'::public.notification_push_receipt_state,
        failure_reason = 'provider_invalid',
        claim_token = null,
        claimed_at = null,
        resolved_at = now_at,
        next_attempt_at = now_at
    where target.id = receipt_record.id
      and target.group_id = receipt_record.group_id;
  end if;
end;
$$;

comment on function public.record_results_push_receipt_invalid_device(uuid, uuid, uuid, uuid, uuid, uuid) is
  'Service-only atomic provider-invalid receipt finalization and Expo-device retirement boundary.';

revoke all on function public.record_results_push_receipt_invalid_device(uuid, uuid, uuid, uuid, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.record_results_push_receipt_invalid_device(uuid, uuid, uuid, uuid, uuid, uuid)
to service_role;

grant usage on schema app to service_role;
grant usage on type app.entity_id, app.utc_instant to service_role;
