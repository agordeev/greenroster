-- Phase 02: invitation lifecycle mutations.
--
-- Invitation links are single-use, signed server-side, and represented in
-- PostgreSQL only by their SHA-256 digest.  These functions are intentionally
-- service-only: Next.js authenticates the request, derives the actor, and
-- supplies the digest generated from the presented link.  No raw token or
-- account e-mail is written to audit state.

create function public.preview_membership_invitation(
  p_auth_user_id uuid,
  p_invitation_id uuid,
  p_token_digest text
)
returns table (
  invitation_id app.entity_id,
  membership_id app.entity_id,
  group_id app.entity_id,
  group_name text,
  inviter_display_name text,
  member_first_name text,
  invited_email text,
  account_email text,
  email_matches boolean,
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
  auth_identity auth.users%rowtype;
  invitation_record public.membership_invitations%rowtype;
  group_record public.groups%rowtype;
  golfer_profile public.membership_golfer_profiles%rowtype;
  inviter_profile public.user_profiles%rowtype;
  preview_status public.membership_invitation_status;
begin
  if p_auth_user_id is null or p_invitation_id is null then
    raise exception 'invitation_context_required' using errcode = '22004';
  end if;

  if p_token_digest is null
    or pg_catalog.lower(p_token_digest) !~ '^[0-9a-f]{64}$'
  then
    raise exception 'invitation_token_digest_invalid' using errcode = '22023';
  end if;

  select identity.*
  into auth_identity
  from auth.users as identity
  where identity.id = p_auth_user_id
    and identity.email is not null
    and identity.email_confirmed_at is not null
    and identity.deleted_at is null
    and not identity.is_anonymous
    and (identity.banned_until is null or identity.banned_until <= v_now);

  if not found then
    raise exception 'invitation_identity_unavailable' using errcode = 'P0002';
  end if;

  select invitation.*
  into invitation_record
  from public.membership_invitations as invitation
  where invitation.id = p_invitation_id
    and invitation.token_digest_sha256 = pg_catalog.lower(p_token_digest);

  if not found then
    raise exception 'invitation_unavailable' using errcode = 'P0002';
  end if;

  preview_status := case
    when invitation_record.status = 'pending' and invitation_record.expires_at <= v_now
      then 'expired'::public.membership_invitation_status
    else invitation_record.status
  end;

  select group_row.*
  into group_record
  from public.groups as group_row
  where group_row.id = invitation_record.group_id;

  if not found then
    raise exception 'invitation_unavailable' using errcode = 'P0002';
  end if;

  select profile.*
  into golfer_profile
  from public.membership_golfer_profiles as profile
  where profile.membership_id = invitation_record.membership_id
    and profile.group_id = invitation_record.group_id;

  select profile.*
  into inviter_profile
  from public.user_profiles as profile
  where profile.user_id = invitation_record.inviter_user_id;

  return query
  select
    invitation_record.id,
    invitation_record.membership_id,
    invitation_record.group_id,
    group_record.name,
    coalesce(
      nullif(pg_catalog.btrim(inviter_profile.display_name), ''),
      nullif(pg_catalog.btrim(pg_catalog.concat_ws(' ', inviter_profile.first_name, inviter_profile.last_name)), ''),
      'Group administrator'
    ),
    golfer_profile.first_name,
    invitation_record.invited_email,
    auth_identity.email::text,
    pg_catalog.lower(auth_identity.email) = invitation_record.invited_email_normalized,
    invitation_record.role,
    preview_status,
    invitation_record.expires_at;
end;
$$;

comment on function public.preview_membership_invitation(uuid, uuid, text) is
  'Service-only, token-authenticated invitation preview. It returns only the authorized invite summary and never stores or returns a raw token.';

revoke all on function public.preview_membership_invitation(uuid, uuid, text)
from public, anon, authenticated, service_role;
grant execute on function public.preview_membership_invitation(uuid, uuid, text)
to service_role;

create function public.correct_membership_invitation_address(
  p_actor_user_id uuid,
  p_invitation_id uuid,
  p_new_invitation_id uuid,
  p_invited_email text,
  p_token_digest text,
  p_token_key_version integer,
  p_expires_at timestamptz,
  p_reason text,
  p_correlation_id uuid,
  p_operation_id uuid
)
returns table (
  previous_invitation_id app.entity_id,
  fresh_invitation_id app.entity_id,
  membership_id app.entity_id,
  group_id app.entity_id,
  fresh_outbox_job_id app.entity_id,
  fresh_delivery_id app.entity_id,
  invited_email text,
  invited_email_normalized text,
  role public.membership_role,
  status public.membership_invitation_status,
  invitation_expires_at app.utc_instant,
  invitation_version bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  display_email text := nullif(pg_catalog.btrim(p_invited_email), '');
  normalized_email text := nullif(pg_catalog.btrim(p_invited_email), '');
  normalized_reason text := nullif(pg_catalog.btrim(p_reason), '');
  actor_group_id uuid;
  locked_group public.groups%rowtype;
  actor_membership public.memberships%rowtype;
  current_invitation public.membership_invitations%rowtype;
  target_membership public.memberships%rowtype;
  fresh_invitation public.membership_invitations%rowtype;
  fresh_outbox public.notification_outbox_jobs%rowtype;
  fresh_delivery public.notification_deliveries%rowtype;
  prior_event public.audit_events%rowtype;
  lifecycle_action text;
begin
  if p_actor_user_id is null
    or p_invitation_id is null
    or p_new_invitation_id is null
    or p_correlation_id is null
    or p_operation_id is null
  then
    raise exception 'operation_context_required' using errcode = '22004';
  end if;

  if p_invitation_id = p_new_invitation_id then
    raise exception 'invitation_id_invalid' using errcode = '22023';
  end if;

  if display_email is null
    or pg_catalog.length(display_email) not between 3 and 320
    or display_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
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

  if p_expires_at is null then
    raise exception 'invitation_expiry_invalid' using errcode = '22023';
  end if;

  if normalized_reason is null or pg_catalog.length(normalized_reason) > 500 then
    raise exception 'invitation_correction_reason_required' using errcode = '22023';
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

  select membership.*
  into actor_membership
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
    and event.action in (
      'membership.invitation_address_corrected',
      'membership.invitation_regenerated'
    )
    and event.operation_id = p_operation_id;

  if found then
    if (prior_event.after_state ->> 'previous_invitation_id')::uuid <> p_invitation_id
      or (prior_event.after_state ->> 'fresh_invitation_id')::uuid <> p_new_invitation_id
    then
      raise exception 'operation_id_reused' using errcode = '23505';
    end if;

    select invitation.*
    into current_invitation
    from public.membership_invitations as invitation
    where invitation.id = p_invitation_id
      and invitation.group_id = locked_group.id;
    if not found then
      raise exception 'invitation_idempotency_record_missing' using errcode = 'P0002';
    end if;

    select invitation.*
    into fresh_invitation
    from public.membership_invitations as invitation
    where invitation.id = p_new_invitation_id
      and invitation.group_id = locked_group.id;
    if not found then
      raise exception 'invitation_idempotency_record_missing' using errcode = 'P0002';
    end if;

    if fresh_invitation.membership_id <> current_invitation.membership_id
      or fresh_invitation.invited_email <> display_email
      or fresh_invitation.invited_email_normalized <> normalized_email
      or fresh_invitation.token_digest_sha256 <> pg_catalog.lower(p_token_digest)
      or fresh_invitation.token_key_version <> p_token_key_version
      or prior_event.reason is distinct from normalized_reason
      or (
        prior_event.action = 'membership.invitation_regenerated'
        and current_invitation.invited_email_normalized <> normalized_email
      )
      or (
        prior_event.action = 'membership.invitation_address_corrected'
        and current_invitation.invited_email_normalized = normalized_email
      )
    then
      raise exception 'operation_id_reused' using errcode = '23505';
    end if;

    select outbox.*
    into fresh_outbox
    from public.notification_outbox_jobs as outbox
    where outbox.id = (prior_event.after_state ->> 'fresh_outbox_job_id')::uuid
      and outbox.group_id = locked_group.id
      and outbox.aggregate_id = fresh_invitation.id;
    if not found then
      raise exception 'invitation_idempotency_record_missing' using errcode = 'P0002';
    end if;

    select delivery.*
    into fresh_delivery
    from public.notification_deliveries as delivery
    where delivery.id = (prior_event.after_state ->> 'fresh_delivery_id')::uuid
      and delivery.group_id = locked_group.id
      and delivery.outbox_job_id = fresh_outbox.id;
    if not found then
      raise exception 'invitation_idempotency_record_missing' using errcode = 'P0002';
    end if;

    return query
    select
      p_invitation_id::app.entity_id,
      fresh_invitation.id,
      fresh_invitation.membership_id,
      fresh_invitation.group_id,
      fresh_outbox.id,
      fresh_delivery.id,
      fresh_invitation.invited_email,
      fresh_invitation.invited_email_normalized,
      fresh_invitation.role,
      fresh_invitation.status,
      fresh_invitation.expires_at,
      fresh_invitation.version;
    return;
  end if;

  if p_expires_at <= v_now then
    raise exception 'invitation_expiry_invalid' using errcode = '22023';
  end if;

  select invitation.*
  into current_invitation
  from public.membership_invitations as invitation
  where invitation.id = p_invitation_id
    and invitation.group_id = locked_group.id
  for update;

  if not found then
    raise exception 'invitation_unavailable' using errcode = 'P0002';
  end if;

  select membership.*
  into target_membership
  from public.memberships as membership
  where membership.id = current_invitation.membership_id
    and membership.group_id = locked_group.id
  for update;

  if not found
    or current_invitation.status <> 'pending'
    or target_membership.status <> 'pending'
    or target_membership.user_id is not null
  then
    raise exception 'invitation_unavailable' using errcode = 'P0002';
  end if;

  if target_membership.role <> 'member' then
    raise exception 'invitation_target_unavailable' using errcode = 'P0002';
  end if;

  if current_invitation.invited_email_normalized = normalized_email then
    lifecycle_action := 'membership.invitation_regenerated';
  else
    if actor_membership.role <> 'administrator' then
      raise exception 'actor_not_authorized' using errcode = 'P0003';
    end if;
    lifecycle_action := 'membership.invitation_address_corrected';
  end if;

  if exists (
    select 1
    from public.membership_invitations as invitation
    where invitation.id = p_new_invitation_id
  ) then
    raise exception 'invitation_id_in_use' using errcode = '23505';
  end if;

  if exists (
    select 1
    from public.membership_invitations as invitation
    where invitation.group_id = locked_group.id
      and invitation.invited_email_normalized = normalized_email
      and invitation.status = 'pending'
      and invitation.id <> current_invitation.id
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

  update public.membership_invitations as invitation
  set status = 'revoked',
      revoked_at = v_now,
      version = invitation.version + 1
  where invitation.id = current_invitation.id
    and invitation.group_id = locked_group.id;

  update public.notification_deliveries as delivery
  set state = 'cancelled',
      failure_reason = 'invitation_regenerated',
      claim_token = null,
      claimed_at = null,
      next_attempt_at = v_now
  where delivery.group_id = locked_group.id
    and delivery.outbox_job_id = (
      select outbox.id
      from public.notification_outbox_jobs as outbox
      where outbox.group_id = locked_group.id
        and outbox.aggregate_id = current_invitation.id
        and outbox.aggregate_type = 'membership_invitation'
        and outbox.event_type = 'membership.invitation'
    )
    and delivery.state in ('queued', 'retryable', 'sending');

  update public.notification_outbox_jobs as outbox
  set state = 'cancelled',
      safe_error = 'invitation_regenerated',
      claimed_at = null,
      finished_at = v_now,
      next_attempt_at = v_now
  where outbox.group_id = locked_group.id
    and outbox.aggregate_id = current_invitation.id
    and outbox.aggregate_type = 'membership_invitation'
    and outbox.event_type = 'membership.invitation'
    and outbox.state in ('queued', 'retryable', 'processing');

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
    p_new_invitation_id,
    locked_group.id,
    target_membership.id,
    display_email,
    normalized_email,
    target_membership.role,
    pg_catalog.lower(p_token_digest),
    p_token_key_version,
    'pending',
    v_now,
    p_expires_at,
    p_actor_user_id
  )
  returning * into fresh_invitation;

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
    fresh_invitation.id,
    fresh_invitation.version,
    'membership.invitation:' || fresh_invitation.id::text,
    'queued',
    0,
    v_now
  )
  returning * into fresh_outbox;

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
    fresh_outbox.id,
    target_membership.id,
    fresh_invitation.invited_email,
    fresh_invitation.invited_email_normalized,
    'email',
    'queued',
    0,
    v_now
  )
  returning * into fresh_delivery;

  insert into public.audit_events (
    group_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    target_version,
    before_state,
    after_state,
    source,
    correlation_id,
    operation_id,
    reason
  )
  values (
    locked_group.id,
    p_actor_user_id,
    lifecycle_action,
    'membership_invitation',
    fresh_invitation.id,
    fresh_invitation.version,
    pg_catalog.jsonb_build_object(
      'invitation_id', current_invitation.id,
      'membership_id', target_membership.id,
      'status', current_invitation.status,
      'version', current_invitation.version
    ),
    pg_catalog.jsonb_build_object(
      'previous_invitation_id', current_invitation.id,
      'fresh_invitation_id', fresh_invitation.id,
      'fresh_outbox_job_id', fresh_outbox.id,
      'fresh_delivery_id', fresh_delivery.id,
      'membership_id', target_membership.id,
      'group_id', locked_group.id,
      'status', fresh_invitation.status,
      'role', fresh_invitation.role,
      'expires_at', fresh_invitation.expires_at,
      'token_key_version', fresh_invitation.token_key_version
    ),
    'server',
    p_correlation_id,
    p_operation_id,
    normalized_reason
  );

  return query
  select
    current_invitation.id,
    fresh_invitation.id,
    fresh_invitation.membership_id,
    fresh_invitation.group_id,
    fresh_outbox.id,
    fresh_delivery.id,
    fresh_invitation.invited_email,
    fresh_invitation.invited_email_normalized,
    fresh_invitation.role,
    fresh_invitation.status,
    fresh_invitation.expires_at,
    fresh_invitation.version;
end;
$$;

comment on function public.correct_membership_invitation_address(uuid, uuid, uuid, text, text, integer, timestamptz, text, uuid, uuid) is
  'Service-only atomic invitation correction/regeneration. Revokes the prior link, queues exactly one fresh delivery, and writes no raw token or private address to audit state.';

revoke all on function public.correct_membership_invitation_address(uuid, uuid, uuid, text, text, integer, timestamptz, text, uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.correct_membership_invitation_address(uuid, uuid, uuid, text, text, integer, timestamptz, text, uuid, uuid)
to service_role;

create function public.regenerate_membership_invitation(
  p_actor_user_id uuid,
  p_invitation_id uuid,
  p_new_invitation_id uuid,
  p_token_digest text,
  p_token_key_version integer,
  p_expires_at timestamptz,
  p_reason text,
  p_correlation_id uuid,
  p_operation_id uuid
)
returns table (
  previous_invitation_id app.entity_id,
  fresh_invitation_id app.entity_id,
  membership_id app.entity_id,
  group_id app.entity_id,
  fresh_outbox_job_id app.entity_id,
  fresh_delivery_id app.entity_id,
  invited_email text,
  invited_email_normalized text,
  role public.membership_role,
  status public.membership_invitation_status,
  invitation_expires_at app.utc_instant,
  invitation_version bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  current_invited_email text;
begin
  select invitation.invited_email
  into current_invited_email
  from public.membership_invitations as invitation
  join public.memberships as actor
    on actor.user_id = p_actor_user_id
    and actor.group_id = invitation.group_id
  join public.user_profiles as profile on profile.user_id = actor.user_id
  join auth.users as identity on identity.id = actor.user_id
  where invitation.id = p_invitation_id
    and actor.status = 'active'
    and actor.role in ('coordinator', 'administrator')
    and profile.disabled_at is null
    and identity.email_confirmed_at is not null
    and identity.deleted_at is null
    and not identity.is_anonymous
    and (identity.banned_until is null or identity.banned_until <= v_now);

  if not found then
    raise exception 'invitation_unavailable' using errcode = 'P0002';
  end if;

  return query
  select *
  from public.correct_membership_invitation_address(
    p_actor_user_id,
    p_invitation_id,
    p_new_invitation_id,
    current_invited_email,
    p_token_digest,
    p_token_key_version,
    p_expires_at,
    p_reason,
    p_correlation_id,
    p_operation_id
  );
end;
$$;

comment on function public.regenerate_membership_invitation(uuid, uuid, uuid, text, integer, timestamptz, text, uuid, uuid) is
  'Service-only invitation regeneration that derives the current invited address inside the trusted database boundary and preserves correction idempotency.';

revoke all on function public.regenerate_membership_invitation(uuid, uuid, uuid, text, integer, timestamptz, text, uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.regenerate_membership_invitation(uuid, uuid, uuid, text, integer, timestamptz, text, uuid, uuid)
to service_role;

create function public.revoke_membership_invitation(
  p_actor_user_id uuid,
  p_invitation_id uuid,
  p_reason text,
  p_correlation_id uuid,
  p_operation_id uuid
)
returns table (
  revoked_invitation_id app.entity_id,
  membership_id app.entity_id,
  group_id app.entity_id,
  status public.membership_invitation_status,
  invitation_version bigint,
  revoked_at app.utc_instant
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  normalized_reason text := nullif(pg_catalog.btrim(p_reason), '');
  actor_group_id uuid;
  locked_group public.groups%rowtype;
  invitation_record public.membership_invitations%rowtype;
  target_membership public.memberships%rowtype;
  prior_event public.audit_events%rowtype;
begin
  if p_actor_user_id is null
    or p_invitation_id is null
    or p_correlation_id is null
    or p_operation_id is null
  then
    raise exception 'operation_context_required' using errcode = '22004';
  end if;

  if normalized_reason is null or pg_catalog.length(normalized_reason) > 500 then
    raise exception 'invitation_revoke_reason_required' using errcode = '22023';
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

  select membership.group_id
  into actor_group_id
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
    and event.action = 'membership.invitation_revoked'
    and event.operation_id = p_operation_id;

  if found then
    if (prior_event.after_state ->> 'invitation_id')::uuid <> p_invitation_id
      or prior_event.reason is distinct from normalized_reason
    then
      raise exception 'operation_id_reused' using errcode = '23505';
    end if;

    select invitation.*
    into invitation_record
    from public.membership_invitations as invitation
    where invitation.id = p_invitation_id
      and invitation.group_id = locked_group.id;
    if not found then
      raise exception 'invitation_idempotency_record_missing' using errcode = 'P0002';
    end if;

    return query
    select
      invitation_record.id,
      invitation_record.membership_id,
      invitation_record.group_id,
      invitation_record.status,
      invitation_record.version,
      invitation_record.revoked_at;
    return;
  end if;

  select invitation.*
  into invitation_record
  from public.membership_invitations as invitation
  where invitation.id = p_invitation_id
    and invitation.group_id = locked_group.id
  for update;

  if not found then
    raise exception 'invitation_unavailable' using errcode = 'P0002';
  end if;

  select membership.*
  into target_membership
  from public.memberships as membership
  where membership.id = invitation_record.membership_id
    and membership.group_id = locked_group.id
  for update;

  if not found
    or invitation_record.status <> 'pending'
    or target_membership.status <> 'pending'
    or target_membership.user_id is not null
  then
    raise exception 'invitation_unavailable' using errcode = 'P0002';
  end if;

  update public.membership_invitations as invitation
  set status = 'revoked',
      revoked_at = v_now,
      version = invitation.version + 1
  where invitation.id = invitation_record.id
    and invitation.group_id = locked_group.id
  returning * into invitation_record;

  update public.notification_deliveries as delivery
  set state = 'cancelled',
      failure_reason = 'invitation_revoked',
      claim_token = null,
      claimed_at = null,
      next_attempt_at = v_now
  where delivery.group_id = locked_group.id
    and delivery.outbox_job_id = (
      select outbox.id
      from public.notification_outbox_jobs as outbox
      where outbox.group_id = locked_group.id
        and outbox.aggregate_id = invitation_record.id
        and outbox.aggregate_type = 'membership_invitation'
        and outbox.event_type = 'membership.invitation'
    )
    and delivery.state in ('queued', 'retryable', 'sending');

  update public.notification_outbox_jobs as outbox
  set state = 'cancelled',
      safe_error = 'invitation_revoked',
      claimed_at = null,
      finished_at = v_now,
      next_attempt_at = v_now
  where outbox.group_id = locked_group.id
    and outbox.aggregate_id = invitation_record.id
    and outbox.aggregate_type = 'membership_invitation'
    and outbox.event_type = 'membership.invitation'
    and outbox.state in ('queued', 'retryable', 'processing');

  insert into public.audit_events (
    group_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    target_version,
    before_state,
    after_state,
    source,
    correlation_id,
    operation_id,
    reason
  )
  values (
    locked_group.id,
    p_actor_user_id,
    'membership.invitation_revoked',
    'membership_invitation',
    invitation_record.id,
    invitation_record.version,
    pg_catalog.jsonb_build_object(
      'invitation_id', invitation_record.id,
      'membership_id', target_membership.id,
      'status', 'pending',
      'version', invitation_record.version - 1
    ),
    pg_catalog.jsonb_build_object(
      'invitation_id', invitation_record.id,
      'membership_id', target_membership.id,
      'group_id', locked_group.id,
      'status', invitation_record.status,
      'version', invitation_record.version
    ),
    'server',
    p_correlation_id,
    p_operation_id,
    normalized_reason
  );

  return query
  select
    invitation_record.id,
    invitation_record.membership_id,
    invitation_record.group_id,
    invitation_record.status,
    invitation_record.version,
    invitation_record.revoked_at;
end;
$$;

comment on function public.revoke_membership_invitation(uuid, uuid, text, uuid, uuid) is
  'Service-only atomic invitation revocation. Pending queue work is cancelled while previously sent provider state remains immutable.';

revoke all on function public.revoke_membership_invitation(uuid, uuid, text, uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.revoke_membership_invitation(uuid, uuid, text, uuid, uuid)
to service_role;

create function public.accept_membership_invitation(
  p_auth_user_id uuid,
  p_invitation_id uuid,
  p_token_digest text,
  p_correlation_id uuid,
  p_operation_id uuid
)
returns table (
  accepted_invitation_id app.entity_id,
  membership_id app.entity_id,
  group_id app.entity_id,
  group_name text,
  invited_email text,
  account_email text,
  email_matches boolean,
  role public.membership_role,
  status public.membership_invitation_status,
  accepted_at app.utc_instant,
  membership_status public.membership_status
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  auth_identity auth.users%rowtype;
  invitation_group_id uuid;
  locked_group public.groups%rowtype;
  invitation_record public.membership_invitations%rowtype;
  target_membership public.memberships%rowtype;
  profile_record public.user_profiles%rowtype;
  prior_event public.audit_events%rowtype;
begin
  if p_auth_user_id is null
    or p_invitation_id is null
    or p_correlation_id is null
    or p_operation_id is null
  then
    raise exception 'operation_context_required' using errcode = '22004';
  end if;

  if p_token_digest is null
    or pg_catalog.lower(p_token_digest) !~ '^[0-9a-f]{64}$'
  then
    raise exception 'invitation_token_digest_invalid' using errcode = '22023';
  end if;

  select identity.*
  into auth_identity
  from auth.users as identity
  where identity.id = p_auth_user_id
  for update;

  if not found
    or auth_identity.email is null
    or auth_identity.email_confirmed_at is null
    or auth_identity.deleted_at is not null
    or auth_identity.is_anonymous
    or (auth_identity.banned_until is not null and auth_identity.banned_until > v_now)
  then
    raise exception 'invitation_identity_unavailable' using errcode = 'P0002';
  end if;

  -- Serialize all lifetime membership attachments for one Auth identity even
  -- when two valid invitations belong to different tenant rows.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_auth_user_id::text, 0)
  );

  select invitation.group_id
  into invitation_group_id
  from public.membership_invitations as invitation
  where invitation.id = p_invitation_id;

  if not found then
    raise exception 'invitation_unavailable' using errcode = 'P0002';
  end if;

  select group_record.*
  into locked_group
  from public.groups as group_record
  where group_record.id = invitation_group_id
  for update;

  if not found then
    raise exception 'invitation_unavailable' using errcode = 'P0002';
  end if;

  select event.*
  into prior_event
  from public.audit_events as event
  where event.group_id = locked_group.id
    and event.actor_user_id = p_auth_user_id
    and event.action = 'membership.invitation_accepted'
    and event.operation_id = p_operation_id;

  if found then
    if (prior_event.after_state ->> 'invitation_id')::uuid <> p_invitation_id then
      raise exception 'operation_id_reused' using errcode = '23505';
    end if;

    select invitation.*
    into invitation_record
    from public.membership_invitations as invitation
    where invitation.id = p_invitation_id
      and invitation.group_id = locked_group.id;
    if not found then
      raise exception 'invitation_idempotency_record_missing' using errcode = 'P0002';
    end if;

    if invitation_record.token_digest_sha256 <> pg_catalog.lower(p_token_digest) then
      raise exception 'operation_id_reused' using errcode = '23505';
    end if;

    select membership.*
    into target_membership
    from public.memberships as membership
    where membership.id = invitation_record.membership_id
      and membership.group_id = locked_group.id;
    if not found or target_membership.user_id <> p_auth_user_id then
      raise exception 'invitation_idempotency_record_missing' using errcode = 'P0002';
    end if;

    return query
    select
      invitation_record.id,
      target_membership.id,
      invitation_record.group_id,
      locked_group.name,
      invitation_record.invited_email,
      auth_identity.email::text,
      pg_catalog.lower(auth_identity.email) = invitation_record.invited_email_normalized,
      invitation_record.role,
      invitation_record.status,
      invitation_record.accepted_at,
      target_membership.status;
    return;
  end if;

  select invitation.*
  into invitation_record
  from public.membership_invitations as invitation
  where invitation.id = p_invitation_id
    and invitation.group_id = locked_group.id
  for update;

  if not found then
    raise exception 'invitation_unavailable' using errcode = 'P0002';
  end if;

  if invitation_record.token_digest_sha256 <> pg_catalog.lower(p_token_digest) then
    raise exception 'invitation_token_invalid' using errcode = 'P0002';
  end if;

  select membership.*
  into target_membership
  from public.memberships as membership
  where membership.id = invitation_record.membership_id
    and membership.group_id = locked_group.id
  for update;

  if not found
    or invitation_record.status <> 'pending'
    or invitation_record.expires_at <= v_now
    or target_membership.status <> 'pending'
    or target_membership.user_id is not null
  then
    raise exception 'invitation_unavailable' using errcode = 'P0002';
  end if;

  if invitation_record.role <> 'member' or target_membership.role <> 'member' then
    raise exception 'invitation_target_unavailable' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.memberships as membership
    where membership.user_id = p_auth_user_id
  ) then
    raise exception 'identity_already_attached' using errcode = '23505';
  end if;

  insert into public.user_profiles (user_id)
  values (p_auth_user_id)
  on conflict (user_id) do nothing;

  select profile.*
  into profile_record
  from public.user_profiles as profile
  where profile.user_id = p_auth_user_id
  for update;

  if not found or profile_record.disabled_at is not null then
    raise exception 'invitation_identity_unavailable' using errcode = 'P0002';
  end if;

  update public.membership_invitations as invitation
  set status = 'accepted',
      accepted_at = v_now,
      version = invitation.version + 1
  where invitation.id = invitation_record.id
    and invitation.group_id = locked_group.id
  returning * into invitation_record;

  update public.memberships as membership
  set user_id = p_auth_user_id,
      status = 'active',
      activated_at = v_now
  where membership.id = target_membership.id
    and membership.group_id = locked_group.id
  returning * into target_membership;

  if not found then
    raise exception 'invitation_target_unavailable' using errcode = 'P0002';
  end if;

  update public.notification_deliveries as delivery
  set state = 'cancelled',
      failure_reason = 'invitation_accepted',
      claim_token = null,
      claimed_at = null,
      next_attempt_at = v_now
  where delivery.group_id = locked_group.id
    and delivery.outbox_job_id = (
      select outbox.id
      from public.notification_outbox_jobs as outbox
      where outbox.group_id = locked_group.id
        and outbox.aggregate_id = invitation_record.id
        and outbox.aggregate_type = 'membership_invitation'
        and outbox.event_type = 'membership.invitation'
    )
    and delivery.state in ('queued', 'retryable', 'sending');

  update public.notification_outbox_jobs as outbox
  set state = 'cancelled',
      safe_error = 'invitation_accepted',
      claimed_at = null,
      finished_at = v_now,
      next_attempt_at = v_now
  where outbox.group_id = locked_group.id
    and outbox.aggregate_id = invitation_record.id
    and outbox.aggregate_type = 'membership_invitation'
    and outbox.event_type = 'membership.invitation'
    and outbox.state in ('queued', 'retryable', 'processing');

  insert into public.audit_events (
    group_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    target_version,
    before_state,
    after_state,
    source,
    correlation_id,
    operation_id
  )
  values (
    locked_group.id,
    p_auth_user_id,
    'membership.invitation_accepted',
    'membership_invitation',
    invitation_record.id,
    invitation_record.version,
    pg_catalog.jsonb_build_object(
      'invitation_id', invitation_record.id,
      'membership_id', target_membership.id,
      'status', 'pending',
      'membership_status', 'pending',
      'version', invitation_record.version - 1
    ),
    pg_catalog.jsonb_build_object(
      'invitation_id', invitation_record.id,
      'membership_id', target_membership.id,
      'group_id', locked_group.id,
      'status', invitation_record.status,
      'membership_status', target_membership.status,
      'role', target_membership.role,
      'email_matches', pg_catalog.lower(auth_identity.email) = invitation_record.invited_email_normalized,
      'accepted_at', invitation_record.accepted_at
    ),
    'server',
    p_correlation_id,
    p_operation_id
  );

  return query
  select
    invitation_record.id,
    target_membership.id,
    invitation_record.group_id,
    locked_group.name,
    invitation_record.invited_email,
    auth_identity.email::text,
    pg_catalog.lower(auth_identity.email) = invitation_record.invited_email_normalized,
    invitation_record.role,
    invitation_record.status,
    invitation_record.accepted_at,
    target_membership.status;
end;
$$;

comment on function public.accept_membership_invitation(uuid, uuid, text, uuid, uuid) is
  'Service-only atomic single-use invitation acceptance for a verified Auth identity. It permits an account e-mail mismatch, creates a blank profile when needed, and refuses any lifetime-attached identity.';

revoke all on function public.accept_membership_invitation(uuid, uuid, text, uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.accept_membership_invitation(uuid, uuid, text, uuid, uuid)
to service_role;

create function public.list_manageable_membership_invitations(p_actor_user_id uuid)
returns table (
  invitation_id app.entity_id,
  membership_id app.entity_id,
  member_first_name text,
  member_last_name text,
  invited_email text,
  status public.membership_invitation_status,
  expires_at app.utc_instant,
  invitation_version bigint,
  delivery_state public.notification_delivery_state,
  delivery_failure_reason text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.statement_timestamp();
  actor_group_id uuid;
begin
  if p_actor_user_id is null then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  select actor.group_id
  into actor_group_id
  from public.memberships as actor
  join public.user_profiles as profile on profile.user_id = actor.user_id
  join auth.users as identity on identity.id = actor.user_id
  where actor.user_id = p_actor_user_id
    and actor.status = 'active'
    and actor.role in ('coordinator', 'administrator')
    and profile.disabled_at is null
    and identity.email_confirmed_at is not null
    and identity.deleted_at is null
    and not identity.is_anonymous
    and (identity.banned_until is null or identity.banned_until <= v_now);

  if not found then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  return query
  select
    invitation.id,
    invitation.membership_id,
    golfer.first_name,
    golfer.last_name,
    invitation.invited_email,
    case
      when invitation.expires_at <= v_now
        then 'expired'::public.membership_invitation_status
      else invitation.status
    end,
    invitation.expires_at,
    invitation.version,
    delivery.state,
    delivery.failure_reason
  from public.membership_invitations as invitation
  join public.membership_golfer_profiles as golfer
    on golfer.membership_id = invitation.membership_id
    and golfer.group_id = invitation.group_id
  left join lateral (
    select candidate.state, candidate.failure_reason
    from public.notification_outbox_jobs as outbox
    join public.notification_deliveries as candidate
      on candidate.outbox_job_id = outbox.id
      and candidate.group_id = outbox.group_id
    where outbox.group_id = invitation.group_id
      and outbox.aggregate_type = 'membership_invitation'
      and outbox.aggregate_id = invitation.id
      and candidate.recipient_membership_id = invitation.membership_id
      and candidate.channel = 'email'
    order by candidate.created_at desc, candidate.id desc
    limit 1
  ) as delivery on true
  where invitation.group_id = actor_group_id
    and invitation.status = 'pending'
  order by golfer.last_name, golfer.first_name, invitation.id;
end;
$$;

comment on function public.list_manageable_membership_invitations(uuid) is
  'Service-only coordinator/administrator projection of current pending invitations and their latest delivery state for the actor tenant.';

revoke all on function public.list_manageable_membership_invitations(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.list_manageable_membership_invitations(uuid)
to service_role;
