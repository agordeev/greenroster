-- Phase 07: service-only privacy retention pruning.
--
-- Direct identifiers are removed by the approved anonymization operation.
-- This scheduled operation removes expired invitations after thirty days and
-- terminal notification delivery history after ninety days.  Sendable work,
-- outbox jobs, audit events, and pseudonymous sporting history are retained.

create function public.prune_privacy_retention()
returns table (
  expired_invitation_count bigint,
  email_provider_event_count bigint,
  email_delivery_count bigint,
  push_receipt_count bigint,
  push_delivery_count bigint,
  pruned_at app.utc_instant
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  now_at timestamptz := pg_catalog.clock_timestamp();
  invitation_cutoff timestamptz := now_at - interval '30 days';
  delivery_cutoff timestamptz := now_at - interval '90 days';
  deleted_expired_invitations bigint := 0;
  deleted_email_provider_events bigint := 0;
  deleted_email_deliveries bigint := 0;
  deleted_push_receipts bigint := 0;
  deleted_push_deliveries bigint := 0;
begin
  delete from public.membership_invitations as invitation
  where invitation.status = 'expired'::public.membership_invitation_status
    and invitation.expired_at < invitation_cutoff;
  get diagnostics deleted_expired_invitations = row_count;

  delete from public.notification_provider_events as event
  where exists (
    select 1
    from public.notification_deliveries as delivery
    where delivery.id = event.delivery_id
      and delivery.group_id = event.group_id
      and delivery.state in (
        'sent'::public.notification_delivery_state,
        'failed_permanent'::public.notification_delivery_state,
        'suppressed'::public.notification_delivery_state,
        'cancelled'::public.notification_delivery_state
      )
      and coalesce(delivery.sent_at, delivery.updated_at, delivery.created_at)
        < delivery_cutoff
  );
  get diagnostics deleted_email_provider_events = row_count;

  delete from public.notification_deliveries as delivery
  where delivery.state in (
      'sent'::public.notification_delivery_state,
      'failed_permanent'::public.notification_delivery_state,
      'suppressed'::public.notification_delivery_state,
      'cancelled'::public.notification_delivery_state
    )
    and coalesce(delivery.sent_at, delivery.updated_at, delivery.created_at)
      < delivery_cutoff;
  get diagnostics deleted_email_deliveries = row_count;

  delete from public.notification_push_receipts as receipt
  where exists (
    select 1
    from public.notification_push_deliveries as delivery
    where delivery.id = receipt.delivery_id
      and delivery.group_id = receipt.group_id
      and delivery.state in (
        'sent'::public.notification_delivery_state,
        'failed_permanent'::public.notification_delivery_state,
        'suppressed'::public.notification_delivery_state,
        'cancelled'::public.notification_delivery_state
      )
      and coalesce(delivery.sent_at, delivery.updated_at, delivery.created_at)
        < delivery_cutoff
  );
  get diagnostics deleted_push_receipts = row_count;

  delete from public.notification_push_deliveries as delivery
  where delivery.state in (
      'sent'::public.notification_delivery_state,
      'failed_permanent'::public.notification_delivery_state,
      'suppressed'::public.notification_delivery_state,
      'cancelled'::public.notification_delivery_state
    )
    and coalesce(delivery.sent_at, delivery.updated_at, delivery.created_at)
      < delivery_cutoff;
  get diagnostics deleted_push_deliveries = row_count;

  return query
  select
    deleted_expired_invitations,
    deleted_email_provider_events,
    deleted_email_deliveries,
    deleted_push_receipts,
    deleted_push_deliveries,
    now_at::app.utc_instant;
end;
$$;

comment on function public.prune_privacy_retention() is
  'Service-only scheduled privacy retention: removes expired invitations after 30 days and terminal notification delivery history after 90 days while retaining sendable work, outbox jobs, audit events, and pseudonymous sporting history.';

revoke all on function public.prune_privacy_retention()
from public, anon, authenticated, service_role;
grant execute on function public.prune_privacy_retention() to service_role;
