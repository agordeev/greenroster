-- Phase 06: align Expo receipt polling with the provider retention window.
--
-- Expo recommends checking receipts about fifteen minutes after a send and
-- removes them after twenty-four hours. Receipt work is intentionally separate
-- from e-mail retry settings: the first queue item is delayed, retries use a
-- fifteen-minute cadence, and aged tickets are terminalized before another
-- provider request can be made.

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
  end if;
  return new;
end;
$$;

create or replace function public.claim_results_push_receipt(
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
  expired_receipt record;
begin
  if p_claim_token is null then
    raise exception 'receipt_claim_token_required' using errcode = '22004';
  end if;
  if p_stale_before is null or p_stale_before > now_at then
    raise exception 'receipt_stale_boundary_invalid' using errcode = '22023';
  end if;

  -- Provider receipts are retained for at most twenty-four hours. Retire an
  -- aged ticket before claiming it, while preserving the normal reopen
  -- cancellation path for result events that were withdrawn.
  for expired_receipt in
    select
      receipt.id,
      receipt.group_id,
      delivery.outbox_job_id,
      app.results_outbox_withdrawn(delivery.outbox_job_id, delivery.group_id) as withdrawn
    from public.notification_push_receipts as receipt
    join public.notification_push_deliveries as delivery
      on delivery.id = receipt.delivery_id
     and delivery.group_id = receipt.group_id
    join public.notification_outbox_jobs as outbox
      on outbox.id = delivery.outbox_job_id
     and outbox.group_id = delivery.group_id
    where receipt.state in (
        'queued'::public.notification_push_receipt_state,
        'retryable'::public.notification_push_receipt_state,
        'sending'::public.notification_push_receipt_state
      )
      and receipt.created_at < now_at - interval '24 hours'
      and delivery.state = 'sent'::public.notification_delivery_state
      and outbox.event_type = 'results_published'
      and outbox.aggregate_type = 'round_completion'
    for update of receipt skip locked
  loop
    update public.notification_push_receipts as target
    set state = case
          when expired_receipt.withdrawn
            then 'cancelled'::public.notification_push_receipt_state
          else 'failed_permanent'::public.notification_push_receipt_state
        end,
        failure_reason = case
          when expired_receipt.withdrawn then 'round_reopened'
          else 'provider_receipt_expired'
        end,
        claim_token = null,
        claimed_at = null,
        resolved_at = now_at,
        next_attempt_at = now_at
    where target.id = expired_receipt.id
      and target.group_id = expired_receipt.group_id;
  end loop;

  -- A crashed receipt worker must not strand a provider ticket. Reopened
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
  'Service-only Expo receipt lease with a fifteen-minute cadence and a bounded twenty-four-hour provider retention window.';
