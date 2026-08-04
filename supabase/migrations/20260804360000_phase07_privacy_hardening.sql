-- Phase 07: harden the approved privacy-process operation.
--
-- The original operation remains available as a private implementation so an
-- already-applied database can be upgraded without replaying application
-- migrations. This wrapper adds an opaque operation receipt, preserves
-- unrelated invitations issued by the subject, removes external handicap
-- identifiers, retires Auth-owned session material, and records a fallback
-- audit row for identities without a tenant membership.

alter function public.anonymize_account_for_privacy(uuid, uuid, text)
rename to anonymize_account_for_privacy_legacy;

revoke all on function public.anonymize_account_for_privacy_legacy(uuid, uuid, text)
from public, anon, authenticated, service_role;

-- Handicap history remains append-only for product actors. Privacy
-- anonymization is the one service-only exception: it may clear only the
-- external identifier while retaining the numeric observation and its date.
create or replace function app.reject_handicap_record_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if pg_catalog.current_setting('greenroster.privacy_anonymization', true) = 'on'
     and tg_op = 'UPDATE'
     and new.handicap_id is null
     and old.handicap_id is not null
     and new.id is not distinct from old.id
     and new.membership_id is not distinct from old.membership_id
     and new.group_id is not distinct from old.group_id
     and new.handicap is not distinct from old.handicap
     and new.source is not distinct from old.source
     and new.as_of is not distinct from old.as_of
     and new.created_at is not distinct from old.created_at
  then
    return new;
  end if;

  raise exception 'handicap_records_append_only' using errcode = 'P0001';
end;
$$;

comment on function app.reject_handicap_record_mutation() is
  'Handicap history is append-only except for the service-only privacy operation clearing an external identifier in place.';

create function public.anonymize_account_for_privacy(
  p_user_id uuid,
  p_correlation_id uuid,
  p_reason text,
  p_operation_id uuid
)
returns table (
  anonymized_user_id uuid,
  membership_count bigint,
  invitation_count bigint,
  email_delivery_count bigint,
  push_device_count bigint,
  anonymized_at app.utc_instant
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  prior_state jsonb;
  existing_email text;
  target_membership_ids uuid[];
  legacy_result record;
  restored_invitation_count bigint := 0;
  adjusted_invitation_count bigint := 0;
  anonymized_at_value timestamptz;
begin
  if p_user_id is null or p_correlation_id is null or p_operation_id is null then
    raise exception 'privacy_anonymization_input_invalid' using errcode = '22023';
  end if;

  if p_reason is null
     or pg_catalog.length(pg_catalog.btrim(p_reason)) = 0
     or pg_catalog.length(p_reason) > 500
  then
    raise exception 'privacy_anonymization_reason_invalid' using errcode = '22023';
  end if;

  -- The receipt is the idempotency boundary. Its after_state contains only
  -- counts and timestamps, never operator prose or contact data.
  select event.after_state
  into prior_state
  from public.identity_security_audit_events as event
  where event.user_id = p_user_id
    and event.action = 'privacy.account_anonymized'
    and event.operation_id = p_operation_id
  order by event.occurred_at desc, event.id desc
  limit 1;

  if prior_state is not null then
    return query
    select
      p_user_id,
      coalesce((prior_state ->> 'membership_count')::bigint, 0),
      coalesce((prior_state ->> 'invitation_count')::bigint, 0),
      coalesce((prior_state ->> 'email_delivery_count')::bigint, 0),
      coalesce((prior_state ->> 'push_device_count')::bigint, 0),
      (prior_state ->> 'anonymized_at')::timestamptz::app.utc_instant;
    return;
  end if;

  select identity.email
  into existing_email
  from auth.users as identity
  where identity.id = p_user_id
  for update;

  if not found then
    raise exception 'privacy_identity_not_found' using errcode = 'P0002';
  end if;

  select coalesce(
    pg_catalog.array_agg(membership.id order by membership.id),
    '{}'::uuid[]
  )
  into target_membership_ids
  from public.memberships as membership
  where membership.user_id = p_user_id;

  -- The legacy operation also redacted invitations where this user was the
  -- inviter. Preserve those belonging to other memberships and recipients;
  -- an inviter UUID is already a pseudonymous historical actor reference.
  drop table if exists pg_temp.privacy_invitation_restore;
  create temporary table privacy_invitation_restore
  on commit drop
  as
  select invitation.*
  from public.membership_invitations as invitation
  where invitation.inviter_user_id = p_user_id
    and not exists (
      select 1
      from public.memberships as target_membership
      where target_membership.id = invitation.membership_id
        and target_membership.group_id = invitation.group_id
        and target_membership.user_id = p_user_id
    )
    and invitation.invited_email_normalized <> pg_catalog.lower(pg_catalog.btrim(existing_email));

  select count(*) into restored_invitation_count
  from pg_temp.privacy_invitation_restore;

  -- Retire the push-device trigger with the same operation correlation as the
  -- privacy audit. The setting is transaction-local and cannot be supplied by
  -- an application caller.
  perform pg_catalog.set_config(
    'greenroster.correlation_id',
    p_correlation_id::text,
    true
  );

  -- The legacy body validates the last administrator, locks the identity, and
  -- performs all tenant-scoped redaction. Its free-form reason is replaced by
  -- a fixed label so operator prose cannot enter long-term audit state.
  select *
  into legacy_result
  from public.anonymize_account_for_privacy_legacy(
    p_user_id,
    p_correlation_id,
    'privacy_process'
  );

  update public.membership_invitations as invitation
  set invited_email = restored.invited_email,
      invited_email_normalized = restored.invited_email_normalized,
      role = restored.role,
      token_digest_sha256 = restored.token_digest_sha256,
      token_key_version = restored.token_key_version,
      status = restored.status,
      issued_at = restored.issued_at,
      expires_at = restored.expires_at,
      accepted_at = restored.accepted_at,
      revoked_at = restored.revoked_at,
      expired_at = restored.expired_at,
      version = restored.version
  from pg_temp.privacy_invitation_restore as restored
  where invitation.id = restored.id
    and invitation.group_id = restored.group_id;

  -- Handicap IDs are external identifiers, unlike the numeric sporting value
  -- and immutable round snapshots that remain useful for history.
  perform pg_catalog.set_config(
    'greenroster.privacy_anonymization',
    'on',
    true
  );

  update public.member_csv_import_rows as import_row
  set raw_payload = import_row.raw_payload - 'handicap_id',
      handicap_id = null
  where import_row.membership_id = any(target_membership_ids)
     or exists (
       select 1
       from public.membership_invitations as invitation
       where invitation.id = import_row.invitation_id
         and invitation.membership_id = any(target_membership_ids)
     );

  update public.membership_handicap_records as handicap
  set handicap_id = null
  where handicap.membership_id = any(target_membership_ids);

  -- Invalidate Auth-owned credentials and provider identities while retaining
  -- the stable user UUID required by application audit/history foreign keys.
  delete from auth.refresh_tokens
  where user_id = p_user_id::text;

  delete from auth.sessions
  where user_id = p_user_id;

  delete from auth.mfa_factors
  where user_id = p_user_id;

  delete from auth.oauth_authorizations
  where user_id = p_user_id;

  delete from auth.oauth_consents
  where user_id = p_user_id;

  delete from auth.one_time_tokens
  where user_id = p_user_id;

  delete from auth.webauthn_challenges
  where user_id = p_user_id;

  delete from auth.webauthn_credentials
  where user_id = p_user_id;

  delete from auth.identities
  where user_id = p_user_id;

  adjusted_invitation_count := greatest(
    legacy_result.invitation_count - restored_invitation_count,
    0
  );
  anonymized_at_value := legacy_result.anonymized_at;

  insert into public.identity_security_audit_events (
    user_id,
    action,
    target_type,
    target_id,
    after_state,
    source,
    correlation_id,
    operation_id,
    occurred_at
  )
  values (
    p_user_id,
    'privacy.account_anonymized',
    'user',
    p_user_id,
    pg_catalog.jsonb_build_object(
      'account_state', 'anonymized',
      'direct_identifiers_removed', true,
      'membership_count', legacy_result.membership_count,
      'invitation_count', adjusted_invitation_count,
      'email_delivery_count', legacy_result.email_delivery_count,
      'push_device_count', legacy_result.push_device_count,
      'anonymized_at', anonymized_at_value
    ),
    'privacy_process',
    p_correlation_id,
    p_operation_id,
    anonymized_at_value
  )
  on conflict (user_id, action, operation_id)
    where operation_id is not null
    do nothing;

  return query
  select
    p_user_id,
    legacy_result.membership_count,
    adjusted_invitation_count,
    legacy_result.email_delivery_count,
    legacy_result.push_device_count,
    anonymized_at_value::app.utc_instant;
end;
$$;

create function public.anonymize_account_for_privacy(
  p_user_id uuid,
  p_correlation_id uuid,
  p_reason text
)
returns table (
  anonymized_user_id uuid,
  membership_count bigint,
  invitation_count bigint,
  email_delivery_count bigint,
  push_device_count bigint,
  anonymized_at app.utc_instant
)
language sql
volatile
security definer
set search_path = ''
as $$
  select *
  from public.anonymize_account_for_privacy(
    p_user_id,
    p_correlation_id,
    p_reason,
    p_correlation_id
  );
$$;

comment on function public.anonymize_account_for_privacy(uuid, uuid, text) is
  'Service-only privacy operation with an opaque operation receipt; direct identifiers and Auth provider credentials are removed while pseudonymous history remains.';

comment on function public.anonymize_account_for_privacy(uuid, uuid, text, uuid) is
  'Service-only idempotent privacy operation. The fourth argument is an opaque operation id; audit state contains counts only.';

revoke all on function public.anonymize_account_for_privacy(uuid, uuid, text)
from public, anon, authenticated, service_role;
revoke all on function public.anonymize_account_for_privacy(uuid, uuid, text, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.anonymize_account_for_privacy(uuid, uuid, text)
to service_role;
grant execute on function public.anonymize_account_for_privacy(uuid, uuid, text, uuid)
to service_role;

create function public.read_privacy_session_started_at(
  p_user_id uuid,
  p_session_id uuid
)
returns app.utc_instant
language sql
stable
security definer
set search_path = ''
as $$
  select session.created_at::app.utc_instant
  from auth.sessions as session
  where session.id = p_session_id
    and session.user_id = p_user_id;
$$;

comment on function public.read_privacy_session_started_at(uuid, uuid) is
  'Service-only lookup of the current Auth session start time for the recent-auth privacy gate; the client never selects a session.';

revoke all on function public.read_privacy_session_started_at(uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.read_privacy_session_started_at(uuid, uuid)
to service_role;
