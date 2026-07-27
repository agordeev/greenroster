create table public.membership_role_change_notifications (
  outbox_job_id app.entity_id primary key,
  group_id app.entity_id not null,
  membership_id app.entity_id not null,
  old_role public.membership_role not null,
  new_role public.membership_role not null,
  created_at app.utc_instant not null default pg_catalog.now(),
  constraint membership_role_change_notifications_outbox_fk
    foreign key (outbox_job_id, group_id)
    references public.notification_outbox_jobs (id, group_id)
    on delete restrict,
  constraint membership_role_change_notifications_membership_fk
    foreign key (membership_id, group_id)
    references public.memberships (id, group_id)
    on delete restrict,
  constraint membership_role_change_notifications_transition_check
    check (old_role <> new_role)
);

alter table public.membership_role_change_notifications enable row level security;
alter table public.membership_role_change_notifications force row level security;

revoke all on table public.membership_role_change_notifications
from public, anon, authenticated, service_role;
grant select on table public.membership_role_change_notifications to service_role;

revoke all on table
  public.membership_invitations,
  public.notification_outbox_jobs,
  public.notification_deliveries,
  public.email_suppressions,
  public.notification_provider_events
from service_role;
grant select on table
  public.membership_invitations,
  public.notification_outbox_jobs,
  public.notification_deliveries,
  public.email_suppressions,
  public.notification_provider_events
to service_role;

create function app.queue_membership_role_change_email(
  p_group_id uuid,
  p_membership_id uuid,
  p_recipient_address text,
  p_old_role public.membership_role,
  p_new_role public.membership_role,
  p_membership_version bigint,
  p_event_key text
)
returns table (
  outbox_job_id app.entity_id,
  delivery_id app.entity_id
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_address text;
  queued_outbox public.notification_outbox_jobs%rowtype;
  queued_delivery public.notification_deliveries%rowtype;
begin
  normalized_address := pg_catalog.lower(pg_catalog.btrim(p_recipient_address));
  if p_group_id is null
    or p_membership_id is null
    or p_old_role is null
    or p_new_role is null
    or p_old_role = p_new_role
    or p_membership_version is null
    or p_membership_version < 1
    or nullif(pg_catalog.btrim(p_event_key), '') is null
    or normalized_address is null
    or pg_catalog.length(normalized_address) not between 3 and 320
    or normalized_address !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  then
    raise exception 'role_notification_invalid' using errcode = '22023';
  end if;

  select outbox.*
  into queued_outbox
  from public.notification_outbox_jobs as outbox
  where outbox.idempotency_key = p_event_key;
  if found then
    if queued_outbox.group_id <> p_group_id
      or queued_outbox.event_type <> 'membership.role_changed'
      or queued_outbox.aggregate_type <> 'membership'
      or queued_outbox.aggregate_id <> p_membership_id
      or queued_outbox.aggregate_version <> p_membership_version
      or not exists (
        select 1
        from public.membership_role_change_notifications as role_event
        where role_event.outbox_job_id = queued_outbox.id
          and role_event.group_id = p_group_id
          and role_event.membership_id = p_membership_id
          and role_event.old_role = p_old_role
          and role_event.new_role = p_new_role
      )
    then
      raise exception 'role_notification_inconsistent' using errcode = '23505';
    end if;
    select delivery.*
    into queued_delivery
    from public.notification_deliveries as delivery
    where delivery.outbox_job_id = queued_outbox.id
      and delivery.group_id = queued_outbox.group_id
      and delivery.recipient_membership_id = p_membership_id
      and delivery.channel = 'email';
    if not found then
      raise exception 'role_notification_inconsistent' using errcode = 'P0002';
    end if;
    return query select queued_outbox.id, queued_delivery.id;
    return;
  end if;

  insert into public.notification_outbox_jobs (
    group_id,
    event_type,
    aggregate_type,
    aggregate_id,
    aggregate_version,
    idempotency_key
  )
  values (
    p_group_id,
    'membership.role_changed',
    'membership',
    p_membership_id,
    p_membership_version,
    p_event_key
  )
  returning * into queued_outbox;

  insert into public.membership_role_change_notifications (
    outbox_job_id,
    group_id,
    membership_id,
    old_role,
    new_role
  )
  values (
    queued_outbox.id,
    p_group_id,
    p_membership_id,
    p_old_role,
    p_new_role
  );

  insert into public.notification_deliveries (
    group_id,
    outbox_job_id,
    recipient_membership_id,
    recipient_address,
    recipient_address_normalized,
    channel
  )
  values (
    p_group_id,
    queued_outbox.id,
    p_membership_id,
    pg_catalog.btrim(p_recipient_address),
    normalized_address,
    'email'
  )
  returning * into queued_delivery;

  return query select queued_outbox.id, queued_delivery.id;
end;
$$;

revoke all on function app.queue_membership_role_change_email(
  uuid, uuid, text, public.membership_role, public.membership_role, bigint, text
) from public, anon, authenticated, service_role;

create function public.change_member_role(
  p_actor_user_id uuid,
  p_membership_id uuid,
  p_new_role public.membership_role,
  p_expected_membership_version bigint,
  p_confirmed boolean,
  p_reason text,
  p_correlation_id uuid,
  p_operation_id uuid
)
returns table (
  membership_id app.entity_id,
  group_id app.entity_id,
  membership_version bigint,
  old_role public.membership_role,
  new_role public.membership_role,
  role_changed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_group_id uuid;
  actor_membership public.memberships%rowtype;
  target_membership public.memberships%rowtype;
  locked_group public.groups%rowtype;
  prior_event public.audit_events%rowtype;
  identity_record auth.users%rowtype;
  normalized_reason text;
  request_payload jsonb;
  request_fingerprint text;
  prior_role public.membership_role;
  before_state jsonb;
  after_state jsonb;
  now_at timestamptz := pg_catalog.clock_timestamp();
begin
  if p_actor_user_id is null or p_membership_id is null or p_new_role is null then
    raise exception 'member_role_context_required' using errcode = '22004';
  end if;
  if p_expected_membership_version is null or p_expected_membership_version < 1 then
    raise exception 'member_membership_version_invalid' using errcode = '22023';
  end if;
  if p_correlation_id is null or p_operation_id is null then
    raise exception 'operation_context_required' using errcode = '22004';
  end if;

  normalized_reason := nullif(pg_catalog.btrim(p_reason), '');
  if p_confirmed is distinct from true
    or normalized_reason is null
    or pg_catalog.length(normalized_reason) > 500
  then
    raise exception 'member_role_confirmation_required' using errcode = '22023';
  end if;

  request_payload := pg_catalog.jsonb_build_object(
    'membership_id', p_membership_id,
    'new_role', p_new_role,
    'expected_membership_version', p_expected_membership_version,
    'confirmed', p_confirmed,
    'reason', normalized_reason
  );
  request_fingerprint := app.member_request_fingerprint(
    request_payload,
    p_actor_user_id::text || ':' || p_operation_id::text
  );

  select membership.group_id
  into actor_group_id
  from public.memberships as membership
  where membership.user_id = p_actor_user_id;
  if not found then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  select group_record.*
  into locked_group
  from public.groups as group_record
  where group_record.id = actor_group_id
  for update;

  select membership.*
  into actor_membership
  from public.memberships as membership
  join public.user_profiles as profile on profile.user_id = membership.user_id
  join auth.users as identity on identity.id = membership.user_id
  where membership.user_id = p_actor_user_id
    and membership.group_id = locked_group.id
    and membership.status = 'active'
    and profile.disabled_at is null
    and identity.email_confirmed_at is not null
    and identity.deleted_at is null
    and not identity.is_anonymous
    and (identity.banned_until is null or identity.banned_until <= now_at)
  for update of membership;
  if not found then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  select event.*
  into prior_event
  from public.audit_events as event
  where event.group_id = locked_group.id
    and event.actor_user_id = p_actor_user_id
    and event.action = 'membership.role_changed'
    and event.operation_id = p_operation_id;
  if found then
    if (prior_event.after_state ->> 'membership_id')::uuid <> p_membership_id
      or prior_event.after_state ->> 'request_fingerprint' <> request_fingerprint
    then
      raise exception 'operation_id_reused' using errcode = '23505';
    end if;
    return query select
      (prior_event.after_state ->> 'membership_id')::app.entity_id,
      prior_event.group_id,
      (prior_event.after_state ->> 'membership_version')::bigint,
      (prior_event.before_state ->> 'role')::public.membership_role,
      (prior_event.after_state ->> 'role')::public.membership_role,
      true;
    return;
  end if;

  if actor_membership.role <> 'administrator' then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  select membership.*
  into target_membership
  from public.memberships as membership
  join public.user_profiles as profile on profile.user_id = membership.user_id
  join auth.users as identity on identity.id = membership.user_id
  where membership.id = p_membership_id
    and membership.group_id = locked_group.id
    and membership.status = 'active'
    and membership.user_id is not null
    and profile.disabled_at is null
    and identity.email_confirmed_at is not null
    and identity.deleted_at is null
    and not identity.is_anonymous
    and (identity.banned_until is null or identity.banned_until <= now_at)
  for update of membership;
  if not found then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;

  select identity.*
  into identity_record
  from auth.users as identity
  where identity.id = target_membership.user_id;

  if target_membership.version <> p_expected_membership_version then
    raise exception 'member_membership_version_changed' using errcode = '40001';
  end if;
  if target_membership.role = p_new_role then
    raise exception 'member_role_transition_forbidden' using errcode = '22023';
  end if;

  prior_role := target_membership.role;
  before_state := pg_catalog.jsonb_build_object(
    'membership_id', target_membership.id,
    'membership_version', target_membership.version,
    'role', prior_role,
    'status', target_membership.status
  );

  update public.memberships as membership
  set role = p_new_role,
      version = membership.version + 1
  where membership.id = target_membership.id
    and membership.group_id = target_membership.group_id
  returning * into target_membership;

  after_state := pg_catalog.jsonb_build_object(
    'membership_id', target_membership.id,
    'membership_version', target_membership.version,
    'role', target_membership.role,
    'status', target_membership.status,
    'request_fingerprint', request_fingerprint
  );

  insert into public.audit_events (
    group_id, actor_user_id, action, target_type, target_id, target_version,
    before_state, after_state, source, correlation_id, operation_id, reason
  ) values (
    target_membership.group_id, p_actor_user_id, 'membership.role_changed',
    'membership', target_membership.id, target_membership.version,
    before_state, after_state, 'portal', p_correlation_id, p_operation_id,
    normalized_reason
  );

  perform * from app.queue_membership_role_change_email(
    target_membership.group_id,
    target_membership.id,
    identity_record.email,
    prior_role,
    target_membership.role,
    target_membership.version,
    'membership.role_changed:' || p_actor_user_id::text || ':' || target_membership.id::text || ':' || p_operation_id::text
  );

  return query select
    target_membership.id,
    target_membership.group_id,
    target_membership.version,
    prior_role,
    target_membership.role,
    true;
end;
$$;

comment on function public.change_member_role(
  uuid, uuid, public.membership_role, bigint, boolean, text, uuid, uuid
) is
  'Service-only confirmed and reasoned membership role transition with server-derived tenant and administrator authority, optimistic versioning, idempotent audit, and atomic mandatory e-mail enqueue.';

revoke all on function public.change_member_role(
  uuid, uuid, public.membership_role, bigint, boolean, text, uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.change_member_role(
  uuid, uuid, public.membership_role, bigint, boolean, text, uuid, uuid
) to service_role;

-- Keep the already-verified transfer transaction as the state/audit authority,
-- but make it private so the public wrapper can add mandatory notifications in
-- the same outer transaction without duplicating the transfer business rules.
alter function public.transfer_group_administrator(
  uuid, uuid, bigint, boolean, text, uuid, uuid
) set schema app;

revoke all on function app.transfer_group_administrator(
  uuid, uuid, bigint, boolean, text, uuid, uuid
) from public, anon, authenticated, service_role;

create function public.transfer_group_administrator(
  p_actor_user_id uuid,
  p_replacement_membership_id uuid,
  p_expected_group_version bigint,
  p_confirmed boolean,
  p_reason text,
  p_correlation_id uuid,
  p_operation_id uuid
)
returns table (
  transferred_group_id app.entity_id,
  group_version bigint,
  previous_administrator_membership_id app.entity_id,
  previous_administrator_role public.membership_role,
  replacement_membership_id app.entity_id,
  replacement_role public.membership_role
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  transfer_result record;
  transfer_event public.audit_events%rowtype;
  prior_transfer_event public.audit_events%rowtype;
  previous_membership public.memberships%rowtype;
  replacement_membership public.memberships%rowtype;
  previous_identity auth.users%rowtype;
  replacement_identity auth.users%rowtype;
  previous_old_role public.membership_role;
  replacement_old_role public.membership_role;
  actor_group_id uuid;
  normalized_reason text;
  is_transfer_replay boolean := false;
begin
  normalized_reason := nullif(pg_catalog.btrim(p_reason), '');

  select membership.group_id
  into actor_group_id
  from public.memberships as membership
  where membership.user_id = p_actor_user_id;

  if actor_group_id is not null then
    perform 1
    from public.groups as group_record
    where group_record.id = actor_group_id
    for update;

    select event.*
    into prior_transfer_event
    from public.audit_events as event
    where event.group_id = actor_group_id
      and event.actor_user_id = p_actor_user_id
      and event.action = 'membership.administrator_transferred'
      and event.operation_id = p_operation_id;

    is_transfer_replay := found;

    if is_transfer_replay and (
      p_confirmed is distinct from true
      or normalized_reason is distinct from prior_transfer_event.reason
      or p_expected_group_version is distinct from
        (prior_transfer_event.before_state ->> 'group_version')::bigint
      or p_replacement_membership_id is distinct from
        (prior_transfer_event.after_state -> 'replacement' ->> 'membership_id')::uuid
    ) then
      raise exception 'operation_id_reused' using errcode = '23505';
    end if;
  end if;

  select *
  into transfer_result
  from app.transfer_group_administrator(
    p_actor_user_id,
    p_replacement_membership_id,
    p_expected_group_version,
    p_confirmed,
    p_reason,
    p_correlation_id,
    p_operation_id
  );

  if is_transfer_replay then
    return query select
      transfer_result.transferred_group_id::app.entity_id,
      transfer_result.group_version::bigint,
      transfer_result.previous_administrator_membership_id::app.entity_id,
      transfer_result.previous_administrator_role::public.membership_role,
      transfer_result.replacement_membership_id::app.entity_id,
      transfer_result.replacement_role::public.membership_role;
    return;
  end if;

  select event.*
  into strict transfer_event
  from public.audit_events as event
  where event.group_id = transfer_result.transferred_group_id
    and event.actor_user_id = p_actor_user_id
    and event.action = 'membership.administrator_transferred'
    and event.operation_id = p_operation_id;

  previous_old_role := (
    transfer_event.before_state -> 'previous_administrator' ->> 'role'
  )::public.membership_role;
  replacement_old_role := (
    transfer_event.before_state -> 'replacement' ->> 'role'
  )::public.membership_role;

  select membership.*
  into strict previous_membership
  from public.memberships as membership
  where membership.id = transfer_result.previous_administrator_membership_id
    and membership.group_id = transfer_result.transferred_group_id;

  select identity.*
  into strict previous_identity
  from auth.users as identity
  where identity.id = previous_membership.user_id;

  select membership.*
  into strict replacement_membership
  from public.memberships as membership
  where membership.id = transfer_result.replacement_membership_id
    and membership.group_id = transfer_result.transferred_group_id;

  select identity.*
  into strict replacement_identity
  from auth.users as identity
  where identity.id = replacement_membership.user_id;

  if previous_old_role <> transfer_result.previous_administrator_role then
    perform * from app.queue_membership_role_change_email(
      transfer_result.transferred_group_id,
      previous_membership.id,
      previous_identity.email,
      previous_old_role,
      transfer_result.previous_administrator_role,
      previous_membership.version,
      'membership.administrator_transferred:' || p_actor_user_id::text || ':' || p_operation_id::text || ':' || previous_membership.id::text
    );
  end if;

  if replacement_old_role <> transfer_result.replacement_role then
    perform * from app.queue_membership_role_change_email(
      transfer_result.transferred_group_id,
      replacement_membership.id,
      replacement_identity.email,
      replacement_old_role,
      transfer_result.replacement_role,
      replacement_membership.version,
      'membership.administrator_transferred:' || p_actor_user_id::text || ':' || p_operation_id::text || ':' || replacement_membership.id::text
    );
  end if;

  return query select
    transfer_result.transferred_group_id::app.entity_id,
    transfer_result.group_version::bigint,
    transfer_result.previous_administrator_membership_id::app.entity_id,
    transfer_result.previous_administrator_role::public.membership_role,
    transfer_result.replacement_membership_id::app.entity_id,
    transfer_result.replacement_role::public.membership_role;
end;
$$;

comment on function public.transfer_group_administrator(
  uuid, uuid, bigint, boolean, text, uuid, uuid
) is
  'Server-only atomic administrator transfer. The existing locked role/audit transaction is preserved and one mandatory role-change e-mail is queued for each membership whose role changed.';

revoke all on function public.transfer_group_administrator(
  uuid, uuid, bigint, boolean, text, uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.transfer_group_administrator(
  uuid, uuid, bigint, boolean, text, uuid, uuid
) to service_role;

-- Add a caller-supplied lease boundary to the existing invitation claim
-- transaction without duplicating its invitation/token selection rules.
alter function public.claim_membership_invitation_email(uuid) set schema app;
revoke all on function app.claim_membership_invitation_email(uuid)
from public, anon, authenticated, service_role;

create function public.claim_membership_invitation_email(
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
  member_first_name text,
  invitation_expires_at app.utc_instant,
  token_key_version integer,
  attempt_number integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
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
      and outbox.event_type = 'membership.invitation'
      and outbox.aggregate_type = 'membership_invitation'
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

  return query
  select * from app.claim_membership_invitation_email(p_claim_token);
end;
$$;

comment on function public.claim_membership_invitation_email(uuid, timestamptz) is
  'Service-only invitation e-mail claim with stale worker-lease recovery before the existing invitation selection transaction.';
revoke all on function public.claim_membership_invitation_email(uuid, timestamptz)
from public, anon, authenticated, service_role;
grant execute on function public.claim_membership_invitation_email(uuid, timestamptz)
to service_role;

create function public.claim_membership_role_change_email(
  p_claim_token uuid,
  p_stale_before timestamptz
)
returns table (
  delivery_id app.entity_id,
  outbox_job_id app.entity_id,
  membership_id app.entity_id,
  group_id app.entity_id,
  group_name text,
  recipient_address text,
  old_role public.membership_role,
  new_role public.membership_role,
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
    from public.notification_outbox_jobs as outbox,
         public.membership_role_change_notifications as role_event
    where delivery.outbox_job_id = outbox.id
      and delivery.group_id = outbox.group_id
      and role_event.outbox_job_id = outbox.id
      and role_event.group_id = outbox.group_id
      and delivery.channel = 'email'
      and delivery.state = 'sending'
      and delivery.claimed_at <= p_stale_before
      and outbox.event_type = 'membership.role_changed'
      and outbox.aggregate_type = 'membership'
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
        else 'member_identity_unavailable'
      end as safe_reason
    from public.notification_deliveries as delivery
    join public.notification_outbox_jobs as outbox
      on outbox.id = delivery.outbox_job_id
     and outbox.group_id = delivery.group_id
    join public.membership_role_change_notifications as role_event
      on role_event.outbox_job_id = outbox.id
     and role_event.group_id = outbox.group_id
    join public.memberships as membership
      on membership.id = role_event.membership_id
     and membership.group_id = role_event.group_id
    left join public.user_profiles as profile
      on profile.user_id = membership.user_id
    left join auth.users as identity
      on identity.id = membership.user_id
    where delivery.channel = 'email'
      and delivery.state in ('queued', 'retryable')
      and outbox.event_type = 'membership.role_changed'
      and outbox.aggregate_type = 'membership'
      and outbox.state in ('queued', 'retryable')
      and (
        membership.status <> 'active'
        or membership.user_id is null
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
    role_event.membership_id,
    delivery.group_id,
    group_record.name as group_name,
    pg_catalog.btrim(identity.email) as recipient_address,
    role_event.old_role,
    role_event.new_role,
    delivery.attempts + 1 as attempt_number
  into selected_delivery
  from public.notification_deliveries as delivery
  join public.notification_outbox_jobs as outbox
    on outbox.id = delivery.outbox_job_id
   and outbox.group_id = delivery.group_id
  join public.membership_role_change_notifications as role_event
    on role_event.outbox_job_id = outbox.id
   and role_event.group_id = outbox.group_id
  join public.memberships as membership
    on membership.id = role_event.membership_id
   and membership.group_id = role_event.group_id
  join public.user_profiles as profile
    on profile.user_id = membership.user_id
   and profile.disabled_at is null
  join auth.users as identity
    on identity.id = membership.user_id
  join public.groups as group_record
    on group_record.id = delivery.group_id
  where delivery.channel = 'email'
    and delivery.state in ('queued', 'retryable')
    and delivery.next_attempt_at <= v_now
    and outbox.event_type = 'membership.role_changed'
    and outbox.aggregate_type = 'membership'
    and outbox.state in ('queued', 'retryable')
    and outbox.next_attempt_at <= v_now
    and membership.status = 'active'
    and membership.user_id is not null
    and identity.email_confirmed_at is not null
    and identity.deleted_at is null
    and not identity.is_anonymous
    and (identity.banned_until is null or identity.banned_until <= v_now)
    and identity.email is not null
    and pg_catalog.length(pg_catalog.btrim(identity.email)) between 3 and 320
    and pg_catalog.btrim(identity.email) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    and not exists (
      select 1
      from public.membership_role_change_notifications as older_event
      join public.notification_outbox_jobs as older_outbox
        on older_outbox.id = older_event.outbox_job_id
       and older_outbox.group_id = older_event.group_id
      join public.notification_deliveries as older_delivery
        on older_delivery.outbox_job_id = older_outbox.id
       and older_delivery.group_id = older_outbox.group_id
      where older_event.group_id = role_event.group_id
        and older_event.membership_id = role_event.membership_id
        and older_outbox.aggregate_version < outbox.aggregate_version
        and older_outbox.state in ('queued', 'retryable', 'processing')
        and older_delivery.state in ('queued', 'retryable', 'sending')
    )
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

  return query select
    selected_delivery.delivery_id::app.entity_id,
    selected_delivery.outbox_job_id::app.entity_id,
    selected_delivery.membership_id::app.entity_id,
    selected_delivery.group_id::app.entity_id,
    selected_delivery.group_name::text,
    selected_delivery.recipient_address::text,
    selected_delivery.old_role::public.membership_role,
    selected_delivery.new_role::public.membership_role,
    selected_delivery.attempt_number::integer;
end;
$$;

comment on function public.claim_membership_role_change_email(uuid, timestamptz) is
  'Service-only atomic claim for one mandatory role-change e-mail. It re-resolves active identity state and the current verified account e-mail at send time.';

revoke all on function public.claim_membership_role_change_email(uuid, timestamptz)
from public, anon, authenticated, service_role;
grant execute on function public.claim_membership_role_change_email(uuid, timestamptz)
to service_role;
