-- Phase 07: mandatory coordinator/administrator alert when an invitation
-- provider delivery receives a permanent hard-bounce event.
--
-- The feedback RPC records the provider-event ledger before it transitions the
-- invitation delivery.  This trigger runs in that same transaction, and its
-- idempotency key is scoped to the source delivery and recipient membership.

create function app.enqueue_invitation_delivery_failed_alerts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_outbox public.notification_outbox_jobs%rowtype;
  invitation_record public.membership_invitations%rowtype;
  recipient record;
  queued_outbox public.notification_outbox_jobs%rowtype;
  now_at timestamptz := pg_catalog.clock_timestamp();
begin
  if old.state = new.state
    or new.state <> 'failed_permanent'::public.notification_delivery_state
    or new.failure_reason <> 'hard_bounce'
  then
    return new;
  end if;

  select outbox.*
  into source_outbox
  from public.notification_outbox_jobs as outbox
  join public.membership_invitations as invitation
    on invitation.id = outbox.aggregate_id
   and invitation.group_id = outbox.group_id
  where outbox.id = new.outbox_job_id
    and outbox.group_id = new.group_id
    and outbox.event_type = 'membership.invitation'
    and outbox.aggregate_type = 'membership_invitation';

  if not found then
    return new;
  end if;

  select invitation.*
  into invitation_record
  from public.membership_invitations as invitation
  where invitation.id = source_outbox.aggregate_id
    and invitation.group_id = source_outbox.group_id;

  for recipient in
    select
      membership.id as membership_id,
      membership.user_id,
      pg_catalog.btrim(identity.email) as recipient_address
    from public.memberships as membership
    join public.user_profiles as profile
      on profile.user_id = membership.user_id
    join auth.users as identity
      on identity.id = membership.user_id
    where membership.group_id = source_outbox.group_id
      and membership.status = 'active'::public.membership_status
      and membership.role in ('coordinator'::public.membership_role, 'administrator'::public.membership_role)
      and membership.user_id is not null
      and profile.disabled_at is null
      and identity.email_confirmed_at is not null
      and identity.deleted_at is null
      and not identity.is_anonymous
      and (identity.banned_until is null or identity.banned_until <= now_at)
      and identity.email is not null
      and pg_catalog.length(pg_catalog.btrim(identity.email)) between 3 and 320
      and pg_catalog.btrim(identity.email) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  loop
    insert into public.notification_outbox_jobs (
      group_id,
      event_type,
      aggregate_type,
      aggregate_id,
      aggregate_version,
      idempotency_key,
      state,
      attempts,
      next_attempt_at
    )
    values (
      source_outbox.group_id,
      'invitation_delivery_failed',
      'membership_invitation',
      invitation_record.id,
      invitation_record.version,
      'invitation_delivery_failed:' || new.id::text || ':' || recipient.membership_id::text,
      'queued',
      0,
      now_at
    )
    on conflict (idempotency_key) do nothing
    returning * into queued_outbox;

    if found then
      insert into public.notification_deliveries (
        group_id,
        outbox_job_id,
        recipient_membership_id,
        recipient_address,
        recipient_address_normalized,
        channel,
        state,
        attempts,
        next_attempt_at
      )
      values (
        source_outbox.group_id,
        queued_outbox.id,
        recipient.membership_id,
        recipient.recipient_address,
        pg_catalog.lower(recipient.recipient_address),
        'email',
        'queued',
        0,
        now_at
      );
    end if;
  end loop;

  return new;
end;
$$;

comment on function app.enqueue_invitation_delivery_failed_alerts() is
  'Same-transaction hard-bounce fan-out to current verified coordinator and administrator e-mail recipients.';

revoke all on function app.enqueue_invitation_delivery_failed_alerts()
from public, anon, authenticated, service_role;

create trigger notification_deliveries_invitation_delivery_failed
after update of state, failure_reason on public.notification_deliveries
for each row
when (
  old.state is distinct from new.state
  and new.state = 'failed_permanent'::public.notification_delivery_state
  and new.failure_reason = 'hard_bounce'
)
execute function app.enqueue_invitation_delivery_failed_alerts();

create function public.claim_invitation_delivery_failed_email(
  p_claim_token uuid,
  p_stale_before timestamptz
)
returns table (
  delivery_id app.entity_id,
  outbox_job_id app.entity_id,
  invitation_id app.entity_id,
  group_id app.entity_id,
  group_name text,
  recipient_address text,
  invited_address text,
  attempt_number integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  now_at timestamptz := pg_catalog.clock_timestamp();
  selected_delivery record;
begin
  if p_claim_token is null then
    raise exception 'delivery_claim_token_required' using errcode = '22004';
  end if;
  if p_stale_before is null or p_stale_before > now_at then
    raise exception 'delivery_stale_boundary_invalid' using errcode = '22023';
  end if;

  with stale_deliveries as (
    update public.notification_deliveries as delivery
    set state = 'retryable',
        failure_reason = 'claim_expired',
        claim_token = null,
        claimed_at = null,
        next_attempt_at = now_at
    from public.notification_outbox_jobs as outbox
    where delivery.outbox_job_id = outbox.id
      and delivery.group_id = outbox.group_id
      and delivery.channel = 'email'
      and delivery.state = 'sending'
      and delivery.claimed_at <= p_stale_before
      and outbox.event_type = 'invitation_delivery_failed'
      and outbox.aggregate_type = 'membership_invitation'
      and outbox.state = 'processing'
    returning delivery.outbox_job_id, delivery.group_id
  )
  update public.notification_outbox_jobs as outbox
  set state = 'retryable',
      safe_error = 'claim_expired',
      claimed_at = null,
      finished_at = null,
      next_attempt_at = now_at
  from stale_deliveries as stale
  where outbox.id = stale.outbox_job_id
    and outbox.group_id = stale.group_id;

  with invalid as (
    select
      delivery.id,
      delivery.group_id,
      delivery.outbox_job_id,
      case
        when membership.status <> 'active'::public.membership_status then 'member_inactive'
        else 'member_identity_unavailable'
      end as safe_reason
    from public.notification_deliveries as delivery
    join public.notification_outbox_jobs as outbox
      on outbox.id = delivery.outbox_job_id
     and outbox.group_id = delivery.group_id
    join public.memberships as membership
      on membership.id = delivery.recipient_membership_id
     and membership.group_id = delivery.group_id
    left join public.user_profiles as profile
      on profile.user_id = membership.user_id
    left join auth.users as identity
      on identity.id = membership.user_id
    where delivery.channel = 'email'
      and delivery.state in ('queued', 'retryable')
      and outbox.event_type = 'invitation_delivery_failed'
      and outbox.aggregate_type = 'membership_invitation'
      and outbox.state in ('queued', 'retryable')
      and (
        membership.status <> 'active'::public.membership_status
        or membership.user_id is null
        or membership.role not in ('coordinator'::public.membership_role, 'administrator'::public.membership_role)
        or profile.user_id is null
        or profile.disabled_at is not null
        or identity.id is null
        or identity.email_confirmed_at is null
        or identity.deleted_at is not null
        or identity.is_anonymous
        or (identity.banned_until is not null and identity.banned_until > now_at)
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
        next_attempt_at = now_at
    from invalid
    where delivery.id = invalid.id
      and delivery.group_id = invalid.group_id
    returning delivery.outbox_job_id, delivery.group_id, delivery.failure_reason
  )
  update public.notification_outbox_jobs as outbox
  set state = 'cancelled',
      safe_error = cancelled.failure_reason,
      claimed_at = null,
      finished_at = now_at,
      next_attempt_at = now_at
  from cancelled_deliveries as cancelled
  where outbox.id = cancelled.outbox_job_id
    and outbox.group_id = cancelled.group_id;

  select
    delivery.id as delivery_id,
    outbox.id as outbox_job_id,
    invitation.id as invitation_id,
    delivery.group_id,
    group_record.name as group_name,
    pg_catalog.btrim(identity.email) as recipient_address,
    invitation.invited_email as invited_address,
    delivery.attempts + 1 as attempt_number
  into selected_delivery
  from public.notification_deliveries as delivery
  join public.notification_outbox_jobs as outbox
    on outbox.id = delivery.outbox_job_id
   and outbox.group_id = delivery.group_id
  join public.membership_invitations as invitation
    on invitation.id = outbox.aggregate_id
   and invitation.group_id = outbox.group_id
  join public.memberships as membership
    on membership.id = delivery.recipient_membership_id
   and membership.group_id = delivery.group_id
  join public.user_profiles as profile
    on profile.user_id = membership.user_id
   and profile.disabled_at is null
  join auth.users as identity
    on identity.id = membership.user_id
  join public.groups as group_record
    on group_record.id = delivery.group_id
  where delivery.channel = 'email'
    and delivery.state in ('queued', 'retryable')
    and delivery.next_attempt_at <= now_at
    and outbox.event_type = 'invitation_delivery_failed'
    and outbox.aggregate_type = 'membership_invitation'
    and outbox.state in ('queued', 'retryable')
    and outbox.next_attempt_at <= now_at
    and membership.status = 'active'::public.membership_status
    and membership.role in ('coordinator'::public.membership_role, 'administrator'::public.membership_role)
    and identity.email_confirmed_at is not null
    and identity.deleted_at is null
    and not identity.is_anonymous
    and (identity.banned_until is null or identity.banned_until <= now_at)
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
      claimed_at = now_at,
      attempts = selected_delivery.attempt_number,
      failure_reason = null,
      recipient_address = selected_delivery.recipient_address,
      recipient_address_normalized = pg_catalog.lower(selected_delivery.recipient_address)
  where delivery.id = selected_delivery.delivery_id
    and delivery.group_id = selected_delivery.group_id;

  update public.notification_outbox_jobs as outbox
  set state = 'processing',
      claimed_at = now_at,
      attempts = selected_delivery.attempt_number,
      safe_error = null
  where outbox.id = selected_delivery.outbox_job_id
    and outbox.group_id = selected_delivery.group_id;

  return query select
    selected_delivery.delivery_id::app.entity_id,
    selected_delivery.outbox_job_id::app.entity_id,
    selected_delivery.invitation_id::app.entity_id,
    selected_delivery.group_id::app.entity_id,
    selected_delivery.group_name::text,
    selected_delivery.recipient_address::text,
    selected_delivery.invited_address::text,
    selected_delivery.attempt_number::integer;
end;
$$;

comment on function public.claim_invitation_delivery_failed_email(uuid, timestamptz) is
  'Service-only atomic claim for one mandatory invitation hard-bounce alert with stale-lease recovery and send-time identity/role checks.';

revoke all on function public.claim_invitation_delivery_failed_email(uuid, timestamptz)
from public, anon, authenticated, service_role;
grant execute on function public.claim_invitation_delivery_failed_email(uuid, timestamptz)
to service_role;

create function app.cancel_invitation_delivery_failed_alerts_before_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  now_at timestamptz := pg_catalog.clock_timestamp();
begin
  update public.notification_deliveries as delivery
  set state = 'cancelled'::public.notification_delivery_state,
      claim_token = null,
      claimed_at = null,
      failure_reason = 'invitation_expired',
      next_attempt_at = now_at
  from public.notification_outbox_jobs as outbox
  where outbox.id = delivery.outbox_job_id
    and outbox.group_id = delivery.group_id
    and outbox.aggregate_id = old.id
    and outbox.group_id = old.group_id
    and outbox.event_type = 'invitation_delivery_failed'
    and outbox.aggregate_type = 'membership_invitation'
    and delivery.state in (
      'queued'::public.notification_delivery_state,
      'retryable'::public.notification_delivery_state,
      'sending'::public.notification_delivery_state
    );

  update public.notification_outbox_jobs as outbox
  set state = 'cancelled'::public.notification_outbox_job_state,
      safe_error = 'invitation_expired',
      claimed_at = null,
      finished_at = now_at,
      next_attempt_at = now_at
  where outbox.aggregate_id = old.id
    and outbox.group_id = old.group_id
    and outbox.event_type = 'invitation_delivery_failed'
    and outbox.aggregate_type = 'membership_invitation'
    and outbox.state in (
      'queued'::public.notification_outbox_job_state,
      'processing'::public.notification_outbox_job_state,
      'retryable'::public.notification_outbox_job_state
    );

  return old;
end;
$$;

comment on function app.cancel_invitation_delivery_failed_alerts_before_delete() is
  'Cancels queued, retryable, or leased hard-bounce alerts before retention removes their invitation aggregate.';

revoke all on function app.cancel_invitation_delivery_failed_alerts_before_delete()
from public, anon, authenticated, service_role;

create trigger membership_invitations_cancel_delivery_failed_alerts
before delete on public.membership_invitations
for each row execute function app.cancel_invitation_delivery_failed_alerts_before_delete();
