-- Phase 02: server-side e-mail delivery state and Resend feedback boundary.
--
-- Provider calls stay in trusted server jobs. These RPCs only claim work,
-- persist the provider result, and apply already-verified webhook semantics.
-- Raw provider payloads, invitation tokens, and recipient addresses never
-- enter the provider-event ledger or the audit stream.

alter table public.notification_deliveries
  add column claim_token uuid,
  add column claimed_at app.utc_instant;

alter table public.notification_deliveries
  drop constraint notification_deliveries_sent_state_consistent;

alter table public.notification_deliveries
  add constraint notification_deliveries_sent_state_consistent
  check (sent_at is null or state in ('sent', 'failed_permanent'));

alter table public.notification_deliveries
  add constraint notification_deliveries_claim_consistent
  check (
    (state = 'sending' and claim_token is not null and claimed_at is not null)
    or (state <> 'sending' and claim_token is null and claimed_at is null)
  );

alter table public.notification_deliveries
  add constraint notification_deliveries_provider_message_id_bounded
  check (
    provider_message_id is null
    or (
      pg_catalog.btrim(provider_message_id) = provider_message_id
      and pg_catalog.length(provider_message_id) between 1 and 255
    )
  );

create unique index notification_deliveries_provider_message_id_idx
  on public.notification_deliveries (provider_message_id)
  where provider_message_id is not null;

create unique index notification_deliveries_claim_token_unique_idx
  on public.notification_deliveries (claim_token)
  where claim_token is not null;

create table public.notification_provider_events (
  event_id text primary key,
  provider text not null default 'resend',
  event_type text not null,
  provider_message_id text not null,
  group_id app.entity_id not null,
  delivery_id app.entity_id not null,
  occurred_at app.utc_instant not null,
  bounce_type text,
  processed_at app.utc_instant not null default pg_catalog.clock_timestamp(),
  constraint notification_provider_events_provider_valid
    check (provider = 'resend'),
  constraint notification_provider_events_event_id_valid
    check (
      pg_catalog.btrim(event_id) = event_id
      and pg_catalog.length(event_id) between 1 and 255
    ),
  constraint notification_provider_events_type_valid
    check (event_type in (
      'email.delivered',
      'email.bounced',
      'email.complained',
      'email.failed',
      'email.suppressed'
    )),
  constraint notification_provider_events_message_id_valid
    check (
      pg_catalog.btrim(provider_message_id) = provider_message_id
      and pg_catalog.length(provider_message_id) between 1 and 255
    ),
  constraint notification_provider_events_bounce_type_valid
    check (bounce_type is null or (
      pg_catalog.btrim(bounce_type) = bounce_type
      and pg_catalog.length(bounce_type) between 1 and 64
      and bounce_type in ('permanent', 'transient', 'undetermined')
    )),
  constraint notification_provider_events_delivery_group_fk
    foreign key (delivery_id, group_id)
    references public.notification_deliveries (id, group_id)
    on delete restrict
);

comment on table public.notification_provider_events is
  'Idempotency ledger for already-verified Resend/Svix event IDs. It stores provider metadata only; never payloads, addresses, or tokens.';
comment on column public.notification_provider_events.bounce_type is
  'Small provider classification retained only to bind replay semantics; raw webhook payloads are not stored.';

create index notification_provider_events_delivery_idx
  on public.notification_provider_events (delivery_id, occurred_at desc);
create index notification_provider_events_provider_message_idx
  on public.notification_provider_events (provider_message_id, occurred_at desc);

alter table public.notification_provider_events enable row level security;
alter table public.notification_provider_events force row level security;

revoke all on table public.notification_provider_events from public, anon, authenticated;
grant select on table public.notification_provider_events to service_role;

create function public.claim_membership_invitation_email(p_claim_token uuid)
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
  selected_delivery record;
begin
  if p_claim_token is null then
    raise exception 'delivery_claim_token_required' using errcode = '22004';
  end if;

  -- Expired invitations must terminate their queued work instead of staying
  -- invisible in queue depth forever. The invitation lifecycle itself is
  -- intentionally left to acceptance/cleanup code in a later slice.
  with expired as (
    select
      delivery.id,
      delivery.group_id,
      delivery.outbox_job_id,
      case
        when invitation.status <> 'pending' or invitation.expires_at <= v_now
          then 'invitation_expired'
        else 'invitation_inactive'
      end as safe_reason
    from public.notification_deliveries as delivery
    join public.notification_outbox_jobs as outbox
      on outbox.id = delivery.outbox_job_id
     and outbox.group_id = delivery.group_id
    join public.membership_invitations as invitation
      on invitation.id = outbox.aggregate_id
     and invitation.group_id = outbox.group_id
    join public.memberships as membership
      on membership.id = invitation.membership_id
     and membership.group_id = invitation.group_id
    where delivery.channel = 'email'
      and delivery.state in ('queued', 'retryable')
      and outbox.event_type = 'membership.invitation'
      and outbox.aggregate_type = 'membership_invitation'
      and outbox.state in ('queued', 'retryable')
      and (
        invitation.status <> 'pending'
        or invitation.expires_at <= v_now
        or membership.status <> 'pending'
        or membership.user_id is not null
      )
    order by delivery.next_attempt_at, delivery.created_at, delivery.id
    for update of delivery, outbox skip locked
  ), expired_deliveries as (
    update public.notification_deliveries as delivery
    set state = 'cancelled',
        failure_reason = expired.safe_reason,
        next_attempt_at = v_now
    from expired
    where delivery.id = expired.id
      and delivery.group_id = expired.group_id
    returning delivery.outbox_job_id, delivery.group_id, delivery.failure_reason as safe_reason
  )
  update public.notification_outbox_jobs as outbox
  set state = 'cancelled',
      safe_error = expired.safe_reason,
      claimed_at = null,
      finished_at = v_now,
      next_attempt_at = v_now
  from expired_deliveries as expired
  where outbox.id = expired.outbox_job_id
    and outbox.group_id = expired.group_id;

  select
    delivery.id as delivery_id,
    outbox.id as outbox_job_id,
    invitation.id as invitation_id,
    delivery.group_id,
    group_record.name as group_name,
    delivery.recipient_address,
    profile.first_name as member_first_name,
    invitation.expires_at as invitation_expires_at,
    invitation.token_key_version,
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
    on membership.id = invitation.membership_id
   and membership.group_id = invitation.group_id
  join public.membership_golfer_profiles as profile
    on profile.membership_id = membership.id
   and profile.group_id = membership.group_id
  join public.groups as group_record
    on group_record.id = delivery.group_id
  where delivery.channel = 'email'
    and delivery.state in ('queued', 'retryable')
    and delivery.next_attempt_at <= v_now
    and outbox.event_type = 'membership.invitation'
    and outbox.aggregate_type = 'membership_invitation'
    and outbox.state in ('queued', 'retryable')
    and outbox.next_attempt_at <= v_now
    and invitation.status = 'pending'
    and invitation.expires_at > v_now
    and membership.status = 'pending'
    and membership.user_id is null
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
      failure_reason = null
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
    selected_delivery.invitation_id::app.entity_id,
    selected_delivery.group_id::app.entity_id,
    selected_delivery.group_name::text,
    selected_delivery.recipient_address::text,
    selected_delivery.member_first_name::text,
    selected_delivery.invitation_expires_at::app.utc_instant,
    selected_delivery.token_key_version::integer,
    selected_delivery.attempt_number::integer;
end;
$$;

comment on function public.claim_membership_invitation_email(uuid) is
  'Service-only, atomically claims one due membership invitation e-mail. The caller receives private recipient data only through this RPC.';

revoke all on function public.claim_membership_invitation_email(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_membership_invitation_email(uuid) to service_role;

create function public.record_email_send_success(
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
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_provider_message_id text := nullif(pg_catalog.btrim(p_provider_message_id), '');
  delivery_record public.notification_deliveries%rowtype;
begin
  if p_delivery_id is null or p_claim_token is null then
    raise exception 'delivery_context_required' using errcode = '22004';
  end if;

  if v_provider_message_id is null
    or pg_catalog.length(v_provider_message_id) > 255
  then
    raise exception 'provider_message_id_invalid' using errcode = '22023';
  end if;

  select delivery.*
  into delivery_record
  from public.notification_deliveries as delivery
  join public.notification_outbox_jobs as outbox
    on outbox.id = delivery.outbox_job_id
   and outbox.group_id = delivery.group_id
  where delivery.id = p_delivery_id
    and delivery.state = 'sending'
    and delivery.claim_token = p_claim_token
    and outbox.state = 'processing'
    and outbox.claimed_at is not null
  for update of delivery, outbox;

  if not found then
    raise exception 'delivery_claim_invalid' using errcode = 'P0002';
  end if;

  update public.notification_deliveries
  set provider_message_id = v_provider_message_id,
      state = 'sent',
      sent_at = v_now,
      claim_token = null,
      claimed_at = null,
      failure_reason = null,
      next_attempt_at = v_now
  where id = delivery_record.id
    and group_id = delivery_record.group_id;

  update public.notification_outbox_jobs
  set state = 'succeeded',
      claimed_at = null,
      finished_at = v_now,
      safe_error = null,
      next_attempt_at = v_now
  where id = delivery_record.outbox_job_id
    and group_id = delivery_record.group_id;
end;
$$;

comment on function public.record_email_send_success(uuid, uuid, text) is
  'Service-only completion of the current delivery claim. Provider IDs are retained without provider payloads.';

revoke all on function public.record_email_send_success(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.record_email_send_success(uuid, uuid, text) to service_role;

create function public.record_email_send_failure(
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
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_safe_error text := nullif(pg_catalog.btrim(p_safe_error), '');
  delivery_record public.notification_deliveries%rowtype;
begin
  if p_delivery_id is null or p_claim_token is null then
    raise exception 'delivery_context_required' using errcode = '22004';
  end if;

  if v_safe_error is null
    or pg_catalog.length(v_safe_error) > 200
    or v_safe_error !~ '^[a-z0-9][a-z0-9_.:-]{0,199}$'
  then
    raise exception 'safe_error_invalid' using errcode = '22023';
  end if;

  if p_retry_at is not null and p_retry_at <= v_now then
    raise exception 'retry_at_invalid' using errcode = '22023';
  end if;

  select delivery.*
  into delivery_record
  from public.notification_deliveries as delivery
  join public.notification_outbox_jobs as outbox
    on outbox.id = delivery.outbox_job_id
   and outbox.group_id = delivery.group_id
  where delivery.id = p_delivery_id
    and delivery.state = 'sending'
    and delivery.claim_token = p_claim_token
    and outbox.state = 'processing'
    and outbox.claimed_at is not null
  for update of delivery, outbox;

  if not found then
    raise exception 'delivery_claim_invalid' using errcode = 'P0002';
  end if;

  if p_retry_at is null then
    update public.notification_deliveries
    set state = 'failed_permanent',
        failure_reason = v_safe_error,
        claim_token = null,
        claimed_at = null
    where id = delivery_record.id
      and group_id = delivery_record.group_id;

    update public.notification_outbox_jobs
    set state = 'abandoned',
        safe_error = v_safe_error,
        claimed_at = null,
        finished_at = v_now
    where id = delivery_record.outbox_job_id
      and group_id = delivery_record.group_id;
  else
    update public.notification_deliveries
    set state = 'retryable',
        failure_reason = v_safe_error,
        next_attempt_at = p_retry_at,
        claim_token = null,
        claimed_at = null
    where id = delivery_record.id
      and group_id = delivery_record.group_id;

    update public.notification_outbox_jobs
    set state = 'retryable',
        safe_error = v_safe_error,
        next_attempt_at = p_retry_at,
        claimed_at = null,
        finished_at = null
    where id = delivery_record.outbox_job_id
      and group_id = delivery_record.group_id;
  end if;
end;
$$;

comment on function public.record_email_send_failure(uuid, uuid, text, timestamptz) is
  'Service-only completion of a delivery claim with a bounded, allowlisted-safe error and optional future retry time.';

revoke all on function public.record_email_send_failure(uuid, uuid, text, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.record_email_send_failure(uuid, uuid, text, timestamptz) to service_role;

create function public.record_resend_email_feedback(
  p_event_id text,
  p_event_type text,
  p_provider_message_id text,
  p_occurred_at timestamptz,
  p_recipient_address text,
  p_bounce_type text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_event_id text := nullif(pg_catalog.btrim(p_event_id), '');
  v_event_type text := nullif(pg_catalog.btrim(p_event_type), '');
  v_provider_message_id text := nullif(pg_catalog.btrim(p_provider_message_id), '');
  v_recipient_address text := nullif(pg_catalog.btrim(p_recipient_address), '');
  v_recipient_normalized text;
  v_bounce_type text := nullif(pg_catalog.lower(pg_catalog.btrim(p_bounce_type)), '');
  existing_event public.notification_provider_events%rowtype;
  delivery_record public.notification_deliveries%rowtype;
  inserted_count integer;
  is_permanent_bounce boolean := false;
begin
  if v_bounce_type = 'temporary' then
    v_bounce_type := 'transient';
  end if;

  if v_event_id is null or pg_catalog.length(v_event_id) > 255 then
    raise exception 'provider_event_id_invalid' using errcode = '22023';
  end if;
  if v_event_type is null or v_event_type not in (
    'email.delivered', 'email.bounced', 'email.complained',
    'email.failed', 'email.suppressed'
  ) then
    raise exception 'provider_event_type_invalid' using errcode = '22023';
  end if;
  if v_provider_message_id is null or pg_catalog.length(v_provider_message_id) > 255 then
    raise exception 'provider_message_id_invalid' using errcode = '22023';
  end if;
  if p_occurred_at is null then
    raise exception 'provider_event_time_required' using errcode = '22004';
  end if;
  if v_recipient_address is null
    or pg_catalog.length(v_recipient_address) not between 3 and 320
    or v_recipient_address !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  then
    raise exception 'provider_recipient_invalid' using errcode = '22023';
  end if;
  v_recipient_normalized := pg_catalog.lower(v_recipient_address);

  if v_event_type <> 'email.bounced' and v_bounce_type is not null then
    raise exception 'provider_bounce_type_invalid' using errcode = '22023';
  end if;
  if v_event_type = 'email.bounced' and (
    v_bounce_type is null
    or v_bounce_type not in ('permanent', 'transient', 'undetermined')
  )
  then
    raise exception 'provider_bounce_type_invalid' using errcode = '22023';
  end if;
  is_permanent_bounce := v_event_type = 'email.bounced'
    and v_bounce_type = 'permanent';

  select event.*
  into existing_event
  from public.notification_provider_events as event
  where event.event_id = v_event_id
  for update;

  if found then
    if existing_event.event_type <> v_event_type
      or existing_event.provider_message_id <> v_provider_message_id
      or existing_event.occurred_at is distinct from p_occurred_at
      or existing_event.bounce_type is distinct from v_bounce_type
    then
      raise exception 'provider_event_replay_mismatch' using errcode = '23505';
    end if;

    select delivery.*
    into delivery_record
    from public.notification_deliveries as delivery
    where delivery.id = existing_event.delivery_id
      and delivery.group_id = existing_event.group_id;
    if not found or delivery_record.recipient_address_normalized <> v_recipient_normalized then
      raise exception 'provider_event_replay_mismatch' using errcode = '23505';
    end if;
    return;
  end if;

  select delivery.*
  into delivery_record
  from public.notification_deliveries as delivery
  where delivery.provider_message_id = v_provider_message_id
    and delivery.recipient_address_normalized = v_recipient_normalized
    and delivery.state in ('sent', 'failed_permanent')
  for update;

  if not found then
    raise exception 'provider_delivery_not_found' using errcode = 'P0002';
  end if;

  insert into public.notification_provider_events (
    event_id,
    provider,
    event_type,
    provider_message_id,
    group_id,
    delivery_id,
    occurred_at,
    bounce_type,
    processed_at
  )
  values (
    v_event_id,
    'resend',
    v_event_type,
    v_provider_message_id,
    delivery_record.group_id,
    delivery_record.id,
    p_occurred_at,
    v_bounce_type,
    v_now
  )
  on conflict (event_id) do nothing;

  get diagnostics inserted_count = row_count;
  if inserted_count = 0 then
    select event.*
    into existing_event
    from public.notification_provider_events as event
    where event.event_id = v_event_id
    for update;
    if existing_event.event_type <> v_event_type
      or existing_event.provider_message_id <> v_provider_message_id
      or existing_event.group_id <> delivery_record.group_id
      or existing_event.delivery_id <> delivery_record.id
      or existing_event.occurred_at is distinct from p_occurred_at
      or existing_event.bounce_type is distinct from v_bounce_type
    then
      raise exception 'provider_event_replay_mismatch' using errcode = '23505';
    end if;
    return;
  end if;

  if is_permanent_bounce then
    update public.notification_deliveries
    set state = 'failed_permanent',
        failure_reason = 'hard_bounce',
        claim_token = null,
        claimed_at = null
    where id = delivery_record.id
      and group_id = delivery_record.group_id;

    insert into public.email_suppressions (
      normalized_address,
      reason,
      first_occurred_at,
      last_occurred_at
    )
    values (
      v_recipient_normalized,
      'bounce',
      p_occurred_at,
      p_occurred_at
    )
    on conflict (normalized_address) do update
    set first_occurred_at = least(public.email_suppressions.first_occurred_at, excluded.first_occurred_at),
        last_occurred_at = greatest(public.email_suppressions.last_occurred_at, excluded.last_occurred_at),
        reason = case
          when excluded.last_occurred_at >= public.email_suppressions.last_occurred_at
            then excluded.reason
          else public.email_suppressions.reason
        end;
  elsif v_event_type = 'email.complained' then
    insert into public.email_suppressions (
      normalized_address,
      reason,
      first_occurred_at,
      last_occurred_at
    )
    values (
      v_recipient_normalized,
      'complaint',
      p_occurred_at,
      p_occurred_at
    )
    on conflict (normalized_address) do update
    set first_occurred_at = least(public.email_suppressions.first_occurred_at, excluded.first_occurred_at),
        last_occurred_at = greatest(public.email_suppressions.last_occurred_at, excluded.last_occurred_at),
        reason = case
          when excluded.last_occurred_at >= public.email_suppressions.last_occurred_at
            then excluded.reason
          else public.email_suppressions.reason
        end;
  elsif v_event_type in ('email.failed', 'email.suppressed') then
    update public.notification_deliveries
    set state = 'failed_permanent',
        failure_reason = case v_event_type
          when 'email.failed' then 'provider_failed'
          else 'provider_suppressed'
        end,
        claim_token = null,
        claimed_at = null
    where id = delivery_record.id
      and group_id = delivery_record.group_id;
  end if;
end;
$$;

comment on function public.record_resend_email_feedback(text, text, text, timestamptz, text, text) is
  'Service-only application of already signature-verified Resend events. Svix event IDs are idempotent; only safe provider metadata is retained.';

revoke all on function public.record_resend_email_feedback(text, text, text, timestamptz, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.record_resend_email_feedback(text, text, text, timestamptz, text, text)
  to service_role;
