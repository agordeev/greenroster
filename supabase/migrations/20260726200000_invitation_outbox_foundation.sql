-- Phase 02: invitation and transactional e-mail outbox foundation.
--
-- This migration deliberately stops at durable queueing.  A later server job
-- owns provider calls, retries, and bounce/complaint webhooks.  No raw token is
-- persisted here; the trusted server supplies only its SHA-256 digest.

create type public.membership_invitation_status as enum (
  'pending',
  'accepted',
  'revoked',
  'expired'
);

create type public.notification_outbox_job_state as enum (
  'queued',
  'processing',
  'retryable',
  'succeeded',
  'abandoned',
  'cancelled'
);

create type public.notification_delivery_state as enum (
  'queued',
  'sending',
  'sent',
  'retryable',
  'failed_permanent',
  'suppressed',
  'cancelled'
);

create type public.notification_channel as enum ('email');

create type public.email_suppression_reason as enum ('bounce', 'complaint');

create table public.membership_invitations (
  id app.entity_id primary key,
  group_id app.entity_id not null references public.groups (id) on delete restrict,
  membership_id app.entity_id not null,
  invited_email text not null,
  invited_email_normalized text not null,
  role public.membership_role not null,
  token_digest_sha256 text not null,
  token_key_version integer not null,
  status public.membership_invitation_status not null default 'pending',
  issued_at app.utc_instant not null default pg_catalog.now(),
  expires_at app.utc_instant not null,
  inviter_user_id app.entity_id not null references auth.users (id) on delete restrict,
  accepted_at app.utc_instant,
  revoked_at app.utc_instant,
  expired_at app.utc_instant,
  version bigint not null default 1,
  created_at app.utc_instant not null default pg_catalog.now(),
  updated_at app.utc_instant not null default pg_catalog.now(),
  constraint membership_invitations_id_group_unique unique (id, group_id),
  constraint membership_invitations_membership_group_fk
    foreign key (membership_id, group_id)
    references public.memberships (id, group_id)
    on delete restrict,
  constraint membership_invitations_email_display_valid
    check (
      pg_catalog.btrim(invited_email) = invited_email
      and pg_catalog.length(invited_email) between 3 and 320
      and invited_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    ),
  constraint membership_invitations_email_normalized_consistent
    check (
      invited_email_normalized = pg_catalog.lower(pg_catalog.btrim(invited_email))
      and invited_email_normalized ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    ),
  constraint membership_invitations_token_digest_valid
    check (token_digest_sha256 ~ '^[0-9a-f]{64}$'),
  constraint membership_invitations_token_key_version_positive
    check (token_key_version > 0),
  constraint membership_invitations_expiry_after_issue
    check (expires_at > issued_at),
  constraint membership_invitations_version_positive
    check (version > 0),
  constraint membership_invitations_status_timestamp_consistent
    check (
      (status = 'pending' and accepted_at is null and revoked_at is null and expired_at is null)
      or (status = 'accepted' and accepted_at is not null and revoked_at is null and expired_at is null)
      or (status = 'revoked' and accepted_at is null and revoked_at is not null and expired_at is null)
      or (status = 'expired' and accepted_at is null and revoked_at is null and expired_at is not null)
    )
);

comment on table public.membership_invitations is
  'One immutable token issuance for a pending membership. Raw invitation tokens are never stored.';
comment on column public.membership_invitations.token_digest_sha256 is
  'Lower-case SHA-256 hex digest of the canonical one-time token supplied by trusted server code.';
comment on column public.membership_invitations.expires_at is
  'Trusted server configuration supplies this future instant; the schema intentionally chooses no TTL.';

create trigger membership_invitations_immutable_id
before update of id on public.membership_invitations
for each row execute function app.reject_id_change('id');

create trigger membership_invitations_immutable_group
before update of group_id on public.membership_invitations
for each row execute function app.reject_id_change('group_id');

create trigger membership_invitations_immutable_membership
before update of membership_id on public.membership_invitations
for each row execute function app.reject_id_change('membership_id');

create trigger membership_invitations_set_updated_at
before update on public.membership_invitations
for each row execute function app.set_updated_at();

create unique index membership_invitations_one_pending_membership_idx
on public.membership_invitations (membership_id)
where status = 'pending';

create unique index membership_invitations_one_pending_group_email_idx
on public.membership_invitations (group_id, invited_email_normalized)
where status = 'pending';

create index membership_invitations_group_issued_idx
on public.membership_invitations (group_id, issued_at desc);

create table public.notification_outbox_jobs (
  id app.entity_id primary key default pg_catalog.gen_random_uuid(),
  group_id app.entity_id not null references public.groups (id) on delete restrict,
  event_type text not null,
  aggregate_type text not null,
  aggregate_id app.entity_id not null,
  aggregate_version bigint not null,
  idempotency_key text not null,
  state public.notification_outbox_job_state not null default 'queued',
  attempts integer not null default 0,
  next_attempt_at app.utc_instant not null default pg_catalog.now(),
  safe_error text,
  claimed_at app.utc_instant,
  finished_at app.utc_instant,
  version bigint not null default 1,
  created_at app.utc_instant not null default pg_catalog.now(),
  updated_at app.utc_instant not null default pg_catalog.now(),
  constraint notification_outbox_jobs_id_group_unique unique (id, group_id),
  constraint notification_outbox_jobs_event_type_valid check (pg_catalog.btrim(event_type) <> ''),
  constraint notification_outbox_jobs_aggregate_type_valid check (pg_catalog.btrim(aggregate_type) <> ''),
  constraint notification_outbox_jobs_aggregate_version_positive check (aggregate_version > 0),
  constraint notification_outbox_jobs_idempotency_key_valid check (pg_catalog.btrim(idempotency_key) <> ''),
  constraint notification_outbox_jobs_attempts_nonnegative check (attempts >= 0),
  constraint notification_outbox_jobs_safe_error_bounded check (safe_error is null or pg_catalog.length(safe_error) <= 2000),
  constraint notification_outbox_jobs_version_positive check (version > 0),
  constraint notification_outbox_jobs_finished_state_consistent check (
    (finished_at is null or state in ('succeeded', 'abandoned', 'cancelled'))
  ),
  constraint notification_outbox_jobs_processing_claim_consistent check (
    (state <> 'processing' or claimed_at is not null)
  )
);

create unique index notification_outbox_jobs_idempotency_idx
on public.notification_outbox_jobs (idempotency_key);
create index notification_outbox_jobs_claim_idx
on public.notification_outbox_jobs (state, next_attempt_at, created_at);
create index notification_outbox_jobs_group_created_idx
on public.notification_outbox_jobs (group_id, created_at desc);

create trigger notification_outbox_jobs_immutable_id
before update of id on public.notification_outbox_jobs
for each row execute function app.reject_id_change('id');

create trigger notification_outbox_jobs_immutable_group
before update of group_id on public.notification_outbox_jobs
for each row execute function app.reject_id_change('group_id');

create trigger notification_outbox_jobs_set_updated_at
before update on public.notification_outbox_jobs
for each row execute function app.set_updated_at();

create table public.notification_deliveries (
  id app.entity_id primary key default pg_catalog.gen_random_uuid(),
  group_id app.entity_id not null,
  outbox_job_id app.entity_id not null,
  recipient_membership_id app.entity_id,
  recipient_user_id app.entity_id,
  recipient_address text not null,
  recipient_address_normalized text not null,
  channel public.notification_channel not null,
  provider_message_id text,
  state public.notification_delivery_state not null default 'queued',
  attempts integer not null default 0,
  failure_reason text,
  next_attempt_at app.utc_instant not null default pg_catalog.now(),
  sent_at app.utc_instant,
  created_at app.utc_instant not null default pg_catalog.now(),
  updated_at app.utc_instant not null default pg_catalog.now(),
  constraint notification_deliveries_id_group_unique unique (id, group_id),
  constraint notification_deliveries_outbox_group_fk
    foreign key (outbox_job_id, group_id)
    references public.notification_outbox_jobs (id, group_id)
    on delete restrict,
  constraint notification_deliveries_membership_group_fk
    foreign key (recipient_membership_id, group_id)
    references public.memberships (id, group_id)
    on delete restrict,
  constraint notification_deliveries_recipient_present check (
    pg_catalog.num_nonnulls(recipient_membership_id, recipient_user_id) = 1
  ),
  constraint notification_deliveries_email_valid check (
    pg_catalog.btrim(recipient_address) = recipient_address
    and pg_catalog.length(recipient_address) between 3 and 320
    and recipient_address ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    and recipient_address_normalized = pg_catalog.lower(pg_catalog.btrim(recipient_address))
    and recipient_address_normalized ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  constraint notification_deliveries_attempts_nonnegative check (attempts >= 0),
  constraint notification_deliveries_failure_reason_bounded check (failure_reason is null or pg_catalog.length(failure_reason) <= 2000),
  constraint notification_deliveries_sent_state_consistent check (sent_at is null or state = 'sent')
);

create unique index notification_deliveries_event_recipient_channel_idx
on public.notification_deliveries (
  outbox_job_id,
  coalesce(recipient_user_id, recipient_membership_id),
  channel
);
create index notification_deliveries_claim_idx
on public.notification_deliveries (state, next_attempt_at, created_at);
create index notification_deliveries_group_created_idx
on public.notification_deliveries (group_id, created_at desc);

create trigger notification_deliveries_immutable_id
before update of id on public.notification_deliveries
for each row execute function app.reject_id_change('id');

create trigger notification_deliveries_immutable_group
before update of group_id on public.notification_deliveries
for each row execute function app.reject_id_change('group_id');

create trigger notification_deliveries_set_updated_at
before update on public.notification_deliveries
for each row execute function app.set_updated_at();

create table public.email_suppressions (
  normalized_address text primary key,
  reason public.email_suppression_reason not null,
  first_occurred_at app.utc_instant not null default pg_catalog.now(),
  last_occurred_at app.utc_instant not null default pg_catalog.now(),
  created_at app.utc_instant not null default pg_catalog.now(),
  updated_at app.utc_instant not null default pg_catalog.now(),
  constraint email_suppressions_address_valid check (
    normalized_address = pg_catalog.lower(pg_catalog.btrim(normalized_address))
    and pg_catalog.length(normalized_address) between 3 and 320
    and normalized_address ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  constraint email_suppressions_occurrence_order check (last_occurred_at >= first_occurred_at)
);

create trigger email_suppressions_set_updated_at
before update on public.email_suppressions
for each row execute function app.set_updated_at();

alter table public.membership_invitations enable row level security;
alter table public.membership_invitations force row level security;
alter table public.notification_outbox_jobs enable row level security;
alter table public.notification_outbox_jobs force row level security;
alter table public.notification_deliveries enable row level security;
alter table public.notification_deliveries force row level security;
alter table public.email_suppressions enable row level security;
alter table public.email_suppressions force row level security;

revoke all on table
  public.membership_invitations,
  public.notification_outbox_jobs,
  public.notification_deliveries,
  public.email_suppressions
from public, anon, authenticated;

grant select on table
  public.membership_invitations,
  public.notification_outbox_jobs,
  public.notification_deliveries,
  public.email_suppressions
to service_role;

create function public.issue_membership_invitation(
  p_actor_user_id uuid,
  p_membership_id uuid,
  p_invitation_id uuid,
  p_invited_email text,
  p_token_digest text,
  p_token_key_version integer,
  p_expires_at timestamptz,
  p_correlation_id uuid,
  p_operation_id uuid
)
returns table (
  issued_invitation_id app.entity_id,
  membership_id app.entity_id,
  issued_group_id app.entity_id,
  queued_outbox_id app.entity_id,
  queued_delivery_id app.entity_id,
  invited_email text,
  invited_email_normalized text,
  role public.membership_role,
  status public.membership_invitation_status,
  invitation_expires_at app.utc_instant
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  actor_group_id uuid;
  locked_group public.groups%rowtype;
  target_membership public.memberships%rowtype;
  prior_event public.audit_events%rowtype;
  invitation_record public.membership_invitations%rowtype;
  outbox_record public.notification_outbox_jobs%rowtype;
  delivery_record public.notification_deliveries%rowtype;
  normalized_email text;
begin
  if p_actor_user_id is null
    or p_membership_id is null
    or p_invitation_id is null
    or p_correlation_id is null
    or p_operation_id is null
  then
    raise exception 'operation_context_required' using errcode = '22004';
  end if;

  normalized_email := nullif(pg_catalog.btrim(p_invited_email), '');
  if normalized_email is null
    or pg_catalog.length(normalized_email) not between 3 and 320
    or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  then
    raise exception 'invitation_email_invalid' using errcode = '22023';
  end if;
  normalized_email := pg_catalog.lower(normalized_email);

  if p_token_digest is null
    or pg_catalog.lower(p_token_digest) !~ '^[0-9a-f]{64}$'
  then
    raise exception 'invitation_token_digest_invalid' using errcode = '22023';
  end if;

  if p_token_key_version is null or p_token_key_version <= 0 then
    raise exception 'invitation_token_key_version_invalid' using errcode = '22023';
  end if;

  if p_expires_at is null or p_expires_at <= v_now then
    raise exception 'invitation_expiry_invalid' using errcode = '22023';
  end if;

  select membership.group_id
  into actor_group_id
  from public.memberships as membership
  where membership.user_id = p_actor_user_id;

  if not found then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  select actor_group.*
  into locked_group
  from public.groups as actor_group
  where actor_group.id = actor_group_id
  for update;

  perform membership.id
  from public.memberships as membership
  join public.user_profiles as profile on profile.user_id = membership.user_id
  join auth.users as identity on identity.id = membership.user_id
  where membership.user_id = p_actor_user_id
    and membership.group_id = locked_group.id
    and membership.status = 'active'
    and membership.role in ('coordinator', 'administrator')
    and profile.disabled_at is null
    and identity.email_confirmed_at is not null
    and identity.deleted_at is null
    and not identity.is_anonymous
    and (identity.banned_until is null or identity.banned_until <= v_now)
  for update of membership;

  if not found then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  select event.*
  into prior_event
  from public.audit_events as event
  where event.group_id = locked_group.id
    and event.actor_user_id = p_actor_user_id
    and event.action = 'membership.invitation_issued'
    and event.operation_id = p_operation_id;

  if found then
    select invitation.*
    into invitation_record
    from public.membership_invitations as invitation
    where invitation.id = (prior_event.after_state ->> 'invitation_id')::uuid;
    if not found then
      raise exception 'invitation_idempotency_record_missing' using errcode = 'P0002';
    end if;

    if invitation_record.membership_id <> p_membership_id
      or invitation_record.invited_email_normalized <> normalized_email
    then
      raise exception 'operation_id_reused' using errcode = '23505';
    end if;

    select outbox.*
    into outbox_record
    from public.notification_outbox_jobs as outbox
    where outbox.id = (prior_event.after_state ->> 'outbox_job_id')::uuid
      and outbox.group_id = invitation_record.group_id
      and outbox.aggregate_id = invitation_record.id;
    if not found then
      raise exception 'invitation_idempotency_record_missing' using errcode = 'P0002';
    end if;

    select delivery.*
    into delivery_record
    from public.notification_deliveries as delivery
    where delivery.id = (prior_event.after_state ->> 'delivery_id')::uuid
      and delivery.group_id = invitation_record.group_id
      and delivery.outbox_job_id = outbox_record.id;
    if not found then
      raise exception 'invitation_idempotency_record_missing' using errcode = 'P0002';
    end if;

    return query
    select
      invitation_record.id,
      invitation_record.membership_id,
      invitation_record.group_id,
      outbox_record.id,
      delivery_record.id,
      invitation_record.invited_email,
      invitation_record.invited_email_normalized,
      invitation_record.role,
      invitation_record.status,
      invitation_record.expires_at;
    return;
  end if;

  select membership.*
  into target_membership
  from public.memberships as membership
  where membership.id = p_membership_id
    and membership.group_id = locked_group.id
    and membership.status = 'pending'
    and membership.role = 'member'
    and membership.user_id is null
  for update;

  if not found then
    raise exception 'invitation_target_unavailable' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.membership_golfer_profiles as profile
    where profile.membership_id = target_membership.id
      and profile.group_id = locked_group.id
  ) then
    raise exception 'invitation_target_unavailable' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.membership_invitations as invitation
    where invitation.membership_id = target_membership.id
      and invitation.status = 'pending'
  ) then
    raise exception 'invitation_already_pending' using errcode = '23505';
  end if;

  if exists (
    select 1
    from public.membership_invitations as invitation
    where invitation.group_id = locked_group.id
      and invitation.invited_email_normalized = normalized_email
      and invitation.status = 'pending'
  ) then
    raise exception 'invitation_email_in_use' using errcode = '23505';
  end if;

  if exists (
    select 1
    from public.memberships as membership
    join auth.users as identity on identity.id = membership.user_id
    where membership.group_id = locked_group.id
      and membership.user_id is not null
      and pg_catalog.lower(identity.email) = normalized_email
  ) then
    raise exception 'invitation_email_in_use' using errcode = '23505';
  end if;

  insert into public.membership_invitations (
    id,
    group_id,
    membership_id,
    invited_email,
    invited_email_normalized,
    role,
    token_digest_sha256,
    token_key_version,
    status,
    issued_at,
    expires_at,
    inviter_user_id
  )
  values (
    p_invitation_id,
    locked_group.id,
    target_membership.id,
    pg_catalog.btrim(p_invited_email),
    normalized_email,
    target_membership.role,
    pg_catalog.lower(p_token_digest),
    p_token_key_version,
    'pending',
    v_now,
    p_expires_at,
    p_actor_user_id
  )
  returning * into invitation_record;

  update public.memberships as membership
  set invited_at = coalesce(membership.invited_at, v_now)
  where membership.id = target_membership.id
    and membership.group_id = locked_group.id;

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
    locked_group.id,
    'membership.invitation',
    'membership_invitation',
    invitation_record.id,
    invitation_record.version,
    'membership.invitation:' || invitation_record.id::text,
    'queued',
    0,
    v_now
  )
  returning * into outbox_record;

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
    locked_group.id,
    outbox_record.id,
    target_membership.id,
    invitation_record.invited_email,
    invitation_record.invited_email_normalized,
    'email',
    'queued',
    0,
    v_now
  )
  returning * into delivery_record;

  insert into public.audit_events (
    group_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    target_version,
    after_state,
    source,
    correlation_id,
    operation_id
  )
  values (
    locked_group.id,
    p_actor_user_id,
    'membership.invitation_issued',
    'membership_invitation',
    invitation_record.id,
    invitation_record.version,
    pg_catalog.jsonb_build_object(
      'invitation_id', invitation_record.id,
      'membership_id', target_membership.id,
      'group_id', locked_group.id,
      'outbox_job_id', outbox_record.id,
      'delivery_id', delivery_record.id,
      'role', invitation_record.role,
      'status', invitation_record.status,
      'expires_at', invitation_record.expires_at,
      'token_key_version', invitation_record.token_key_version
    ),
    'server',
    p_correlation_id,
    p_operation_id
  );

  return query
  select
    invitation_record.id,
    target_membership.id,
    locked_group.id,
    outbox_record.id,
    delivery_record.id,
    invitation_record.invited_email,
    invitation_record.invited_email_normalized,
    invitation_record.role,
    invitation_record.status,
    invitation_record.expires_at;
end;
$$;

comment on function public.issue_membership_invitation(
  uuid, uuid, uuid, text, text, integer, timestamptz, uuid, uuid
) is
  'Service-only atomic invitation issue. Creates one pending invitation, queued outbox event, queued e-mail delivery, membership invited timestamp, and safe audit record.';

revoke all on function public.issue_membership_invitation(
  uuid, uuid, uuid, text, text, integer, timestamptz, uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.issue_membership_invitation(
  uuid, uuid, uuid, text, text, integer, timestamptz, uuid, uuid
) to service_role;
