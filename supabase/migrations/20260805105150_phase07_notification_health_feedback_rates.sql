-- Phase 07: privacy-safe provider feedback aggregates.
--
-- The existing health RPC exposes queue state only. This extension adds
-- tenant-scoped bounce/complaint and invalid-token rates derived from the
-- provider-event and push-delivery ledgers. It never returns addresses,
-- provider payloads, or push tokens.

drop function public.read_notification_delivery_health(uuid);

create function public.read_notification_delivery_health(
  p_actor_user_id uuid
)
returns table (
  group_id app.entity_id,
  outbox_queued bigint,
  outbox_processing bigint,
  outbox_retryable bigint,
  outbox_oldest_at app.utc_instant,
  email_queued bigint,
  email_sending bigint,
  email_retryable bigint,
  email_failed_permanent bigint,
  email_suppressed bigint,
  email_attempted bigint,
  email_bounced bigint,
  email_complained bigint,
  email_bounce_rate numeric,
  email_complaint_rate numeric,
  push_queued bigint,
  push_sending bigint,
  push_retryable bigint,
  push_failed_permanent bigint,
  push_cancelled bigint,
  push_invalid_token bigint,
  push_invalid_token_rate numeric,
  push_receipt_pending bigint,
  push_receipt_failed bigint,
  last_activity_at app.utc_instant,
  sampled_at app.utc_instant
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_group_id app.entity_id;
  sampled_at_value timestamptz := pg_catalog.statement_timestamp();
begin
  select actor.group_id
  into actor_group_id
  from app.resolve_member_management_actor(p_actor_user_id) as actor
  order by actor.group_id
  limit 1;

  if actor_group_id is null then
    raise exception 'notification_health_not_available' using errcode = 'P0002';
  end if;

  return query
  with outbox as (
    select
      count(*) filter (
        where state = 'queued'::public.notification_outbox_job_state
      )::bigint as queued,
      count(*) filter (
        where state = 'processing'::public.notification_outbox_job_state
      )::bigint as processing,
      count(*) filter (
        where state = 'retryable'::public.notification_outbox_job_state
      )::bigint as retryable,
      min(created_at) filter (
        where state in (
          'queued'::public.notification_outbox_job_state,
          'processing'::public.notification_outbox_job_state,
          'retryable'::public.notification_outbox_job_state
        )
      )::app.utc_instant as oldest_at,
      max(updated_at)::app.utc_instant as last_activity
    from public.notification_outbox_jobs as jobs
    where jobs.group_id = actor_group_id
  ), email as (
    select
      count(*) filter (
        where state = 'queued'::public.notification_delivery_state
      )::bigint as queued,
      count(*) filter (
        where state = 'sending'::public.notification_delivery_state
      )::bigint as sending,
      count(*) filter (
        where state = 'retryable'::public.notification_delivery_state
      )::bigint as retryable,
      count(*) filter (
        where state = 'failed_permanent'::public.notification_delivery_state
      )::bigint as failed_permanent,
      count(*) filter (
        where state = 'suppressed'::public.notification_delivery_state
      )::bigint as suppressed,
      count(*) filter (
        where attempts > 0 or provider_message_id is not null
      )::bigint as attempted,
      max(updated_at)::app.utc_instant as last_activity
    from public.notification_deliveries as deliveries
    where deliveries.group_id = actor_group_id
      and deliveries.channel = 'email'::public.notification_channel
  ), feedback as (
    select
      count(distinct event.delivery_id) filter (
        where event.event_type = 'email.bounced'
      )::bigint as bounced,
      count(distinct event.delivery_id) filter (
        where event.event_type = 'email.complained'
      )::bigint as complained,
      max(event.occurred_at)::app.utc_instant as last_activity
    from public.notification_provider_events as event
    where event.group_id = actor_group_id
      and event.event_type in ('email.bounced', 'email.complained')
  ), push as (
    select
      count(*) filter (
        where state = 'queued'::public.notification_delivery_state
      )::bigint as queued,
      count(*) filter (
        where state = 'sending'::public.notification_delivery_state
      )::bigint as sending,
      count(*) filter (
        where state = 'retryable'::public.notification_delivery_state
      )::bigint as retryable,
      count(*) filter (
        where state = 'failed_permanent'::public.notification_delivery_state
      )::bigint as failed_permanent,
      count(*) filter (
        where state = 'cancelled'::public.notification_delivery_state
      )::bigint as cancelled,
      count(*) filter (where attempts > 0)::bigint as attempted,
      max(updated_at)::app.utc_instant as last_activity
    from public.notification_push_deliveries as deliveries
    where deliveries.group_id = actor_group_id
  ), receipts as (
    select
      count(*) filter (
        where state in (
          'queued'::public.notification_push_receipt_state,
          'sending'::public.notification_push_receipt_state,
          'retryable'::public.notification_push_receipt_state
        )
      )::bigint as pending,
      count(*) filter (
        where state = 'failed_permanent'::public.notification_push_receipt_state
      )::bigint as failed,
      max(updated_at)::app.utc_instant as last_activity
    from public.notification_push_receipts as receipts_rows
    where receipts_rows.group_id = actor_group_id
  ), push_invalid as (
    select count(*)::bigint as invalid_token
    from (
      select deliveries.id as delivery_id
      from public.notification_push_deliveries as deliveries
      where deliveries.group_id = actor_group_id
        and deliveries.state = 'failed_permanent'::public.notification_delivery_state
        and deliveries.failure_reason = 'provider_invalid'
      union
      select receipts_rows.delivery_id
      from public.notification_push_receipts as receipts_rows
      where receipts_rows.group_id = actor_group_id
        and receipts_rows.failure_reason = 'provider_invalid'
    ) as invalid_deliveries
  )
  select
    actor_group_id,
    outbox.queued,
    outbox.processing,
    outbox.retryable,
    outbox.oldest_at,
    email.queued,
    email.sending,
    email.retryable,
    email.failed_permanent,
    email.suppressed,
    email.attempted,
    feedback.bounced,
    feedback.complained,
    coalesce(feedback.bounced::numeric / nullif(email.attempted, 0), 0),
    coalesce(feedback.complained::numeric / nullif(email.attempted, 0), 0),
    push.queued,
    push.sending,
    push.retryable,
    push.failed_permanent,
    push.cancelled,
    push_invalid.invalid_token,
    coalesce(push_invalid.invalid_token::numeric / nullif(push.attempted, 0), 0),
    receipts.pending,
    receipts.failed,
    greatest(
      outbox.last_activity,
      email.last_activity,
      feedback.last_activity,
      push.last_activity,
      receipts.last_activity
    )::app.utc_instant,
    sampled_at_value::app.utc_instant
  from outbox
  cross join email
  cross join feedback
  cross join push
  cross join receipts
  cross join push_invalid;
end;
$$;

comment on function public.read_notification_delivery_health(uuid) is
  'Coordinator/administrator aggregate notification health for the actor tenant; recipient addresses, tokens, and provider payloads are never returned.';

revoke all on function public.read_notification_delivery_health(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.read_notification_delivery_health(uuid)
to service_role;
