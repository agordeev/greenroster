-- Phase 07: make invitation retention expire natural pending rows and close
-- linked notification work before removing the invitation row.

create or replace function public.prune_privacy_retention()
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
  drop table if exists pg_temp.privacy_expired_invitations;
  create temporary table privacy_expired_invitations (
    id uuid not null,
    group_id uuid not null,
    membership_id uuid not null,
    primary key (id, group_id)
  ) on commit drop;

  insert into privacy_expired_invitations (id, group_id, membership_id)
  select invitation.id, invitation.group_id, invitation.membership_id
  from public.membership_invitations as invitation
  where (
      invitation.status = 'expired'::public.membership_invitation_status
      and invitation.expired_at < invitation_cutoff
    )
    or (
      invitation.status = 'pending'::public.membership_invitation_status
      and invitation.expires_at < invitation_cutoff
    )
  for update;

  -- Delivery and outbox rows do not have a foreign key to invitations. Lock
  -- and cancel them first so a queued/retryable job cannot remain sendable
  -- after its aggregate is removed. Addresses are scrubbed immediately.
  update public.notification_deliveries as delivery
  set state = 'cancelled'::public.notification_delivery_state,
      claim_token = null,
      claimed_at = null,
      failure_reason = 'invitation_expired',
      next_attempt_at = now_at
  from public.notification_outbox_jobs as outbox
  join privacy_expired_invitations as expired
    on expired.id = outbox.aggregate_id
   and expired.group_id = outbox.group_id
  where delivery.outbox_job_id = outbox.id
    and delivery.group_id = outbox.group_id
    and outbox.event_type = 'membership.invitation'
    and outbox.aggregate_type = 'membership_invitation'
    and delivery.state in (
      'queued'::public.notification_delivery_state,
      'retryable'::public.notification_delivery_state,
      'sending'::public.notification_delivery_state
    );

  update public.notification_deliveries as delivery
  set recipient_address = 'deleted+' || replace(delivery.id::text, '-', '') || '@invalid.greenroster.local',
      recipient_address_normalized = 'deleted+' || replace(delivery.id::text, '-', '') || '@invalid.greenroster.local'
  from public.notification_outbox_jobs as outbox
  join privacy_expired_invitations as expired
    on expired.id = outbox.aggregate_id
   and expired.group_id = outbox.group_id
  where delivery.outbox_job_id = outbox.id
    and delivery.group_id = outbox.group_id
    and outbox.event_type = 'membership.invitation'
    and outbox.aggregate_type = 'membership_invitation';

  update public.notification_outbox_jobs as outbox
  set state = 'cancelled'::public.notification_outbox_job_state,
      safe_error = 'invitation_expired',
      claimed_at = null,
      finished_at = now_at,
      next_attempt_at = now_at
  from privacy_expired_invitations as expired
  where outbox.aggregate_id = expired.id
    and outbox.group_id = expired.group_id
    and outbox.event_type = 'membership.invitation'
    and outbox.aggregate_type = 'membership_invitation'
    and outbox.state in (
      'queued'::public.notification_outbox_job_state,
      'processing'::public.notification_outbox_job_state,
      'retryable'::public.notification_outbox_job_state
    );

  -- Import rows can retain invitation addresses and raw CSV material after an
  -- invitation is gone. Keep the job audit row but remove direct identifiers.
  update public.member_csv_import_rows as import_row
  set raw_payload = pg_catalog.jsonb_build_object(
        'redacted', true,
        'reason', 'privacy_retention'
      ),
      invited_email = null,
      invited_email_normalized = null,
      invitation_id = null,
      handicap_id = null
  where exists (
    select 1
    from privacy_expired_invitations as expired
    where expired.id = import_row.invitation_id
  );

  delete from public.membership_invitations as invitation
  using privacy_expired_invitations as expired
  where invitation.id = expired.id
    and invitation.group_id = expired.group_id;
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
  'Service-only retention: locks and cancels linked invitation work, removes naturally or explicitly expired invitations after 30 days, and removes terminal notification history after 90 days while retaining sendable work, outbox history, audits, and sporting history.';

revoke all on function public.prune_privacy_retention()
from public, anon, authenticated, service_role;
grant execute on function public.prune_privacy_retention() to service_role;
