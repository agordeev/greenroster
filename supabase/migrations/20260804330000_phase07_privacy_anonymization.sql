-- Phase 07: privacy-process account anonymization.
--
-- V1 does not keep an in-product privacy-request tracker. The named privacy
-- owner handles an approved request through the support process and invokes
-- this service-only operation. It removes direct identifiers, disables the
-- identity and membership, retires delivery credentials, and keeps the
-- pseudonymous sporting/audit history needed by the group.

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
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  existing_email text;
  existing_deleted_at timestamptz;
  redacted_email text;
  target_membership_ids uuid[];
  target_group_ids uuid[];
  target_membership_count bigint;
  target_invitation_count bigint;
  target_email_delivery_count bigint;
  target_push_device_count bigint;
  anonymized_at_value timestamptz := pg_catalog.clock_timestamp();
begin
  if p_user_id is null or p_correlation_id is null then
    raise exception 'privacy_anonymization_input_invalid' using errcode = '22023';
  end if;

  if p_reason is null or pg_catalog.length(pg_catalog.btrim(p_reason)) = 0
     or pg_catalog.length(p_reason) > 500 then
    raise exception 'privacy_anonymization_reason_invalid' using errcode = '22023';
  end if;

  select identity.email, identity.deleted_at
  into existing_email, existing_deleted_at
  from auth.users as identity
  where identity.id = p_user_id
  for update;

  if not found then
    raise exception 'privacy_identity_not_found' using errcode = 'P0002';
  end if;

  if existing_deleted_at is not null
     or existing_email like 'deleted+%@invalid.greenroster.local' then
    raise exception 'privacy_identity_already_anonymized' using errcode = 'P0003';
  end if;

  if exists (
    select 1
    from public.memberships as target_membership
    where target_membership.user_id = p_user_id
      and target_membership.status = 'active'::public.membership_status
      and target_membership.role = 'administrator'::public.membership_role
      and not exists (
        select 1
        from public.memberships as replacement_administrator
        where replacement_administrator.group_id = target_membership.group_id
          and replacement_administrator.status = 'active'::public.membership_status
          and replacement_administrator.role = 'administrator'::public.membership_role
          and replacement_administrator.user_id <> p_user_id
      )
  ) then
    raise exception 'privacy_last_active_administrator' using errcode = 'P0003';
  end if;

  select
    coalesce(pg_catalog.array_agg(membership.id order by membership.id), '{}'::uuid[]),
    coalesce(pg_catalog.array_agg(distinct membership.group_id order by membership.group_id), '{}'::uuid[]),
    count(*)
  into target_membership_ids, target_group_ids, target_membership_count
  from public.memberships as membership
  where membership.user_id = p_user_id;

  redacted_email := 'deleted+' || replace(p_user_id::text, '-', '') || '@invalid.greenroster.local';

  select count(*)
  into target_email_delivery_count
  from public.notification_deliveries as delivery
  where (
    delivery.recipient_membership_id = any(target_membership_ids)
    or delivery.recipient_user_id = p_user_id
    or delivery.recipient_address_normalized = lower(btrim(existing_email))
  );

  -- Redact queued work before membership deactivation so the inactive-member
  -- guard cannot allow any further sendable state.
  update public.notification_deliveries as delivery
  set state = 'cancelled'::public.notification_delivery_state,
      claim_token = null,
      claimed_at = null,
      failure_reason = 'account_anonymized'
  where (
    delivery.recipient_membership_id = any(target_membership_ids)
    or delivery.recipient_user_id = p_user_id
    or delivery.recipient_address_normalized = lower(btrim(existing_email))
  )
  and delivery.state in (
    'queued'::public.notification_delivery_state,
    'retryable'::public.notification_delivery_state,
    'sending'::public.notification_delivery_state
  );

  update public.notification_deliveries as delivery
  set recipient_address = 'deleted+' || replace(delivery.id::text, '-', '') || '@invalid.greenroster.local',
      recipient_address_normalized = 'deleted+' || replace(delivery.id::text, '-', '') || '@invalid.greenroster.local'
  where (
    delivery.recipient_membership_id = any(target_membership_ids)
    or delivery.recipient_user_id = p_user_id
    or delivery.recipient_address_normalized = lower(btrim(existing_email))
  );

  update public.notification_push_deliveries as delivery
  set state = 'cancelled'::public.notification_delivery_state,
      claim_token = null,
      claimed_at = null,
      failure_reason = 'account_anonymized'
  where delivery.recipient_user_id = p_user_id
    and delivery.state in (
      'queued'::public.notification_delivery_state,
      'retryable'::public.notification_delivery_state,
      'sending'::public.notification_delivery_state
    );

  update public.membership_invitations as invitation
  set invited_email = 'deleted+' || replace(invitation.id::text, '-', '') || '@invalid.greenroster.local',
      invited_email_normalized = 'deleted+' || replace(invitation.id::text, '-', '') || '@invalid.greenroster.local',
      status = case
        when invitation.status = 'pending'::public.membership_invitation_status
          then 'revoked'::public.membership_invitation_status
        else invitation.status
      end,
      revoked_at = case
        when invitation.status = 'pending'::public.membership_invitation_status
          then anonymized_at_value
        else invitation.revoked_at
      end,
      accepted_at = case
        when invitation.status = 'pending'::public.membership_invitation_status
          then null
        else invitation.accepted_at
      end,
      expired_at = case
        when invitation.status = 'pending'::public.membership_invitation_status
          then null
        else invitation.expired_at
      end,
      version = invitation.version + 1
  where invitation.membership_id = any(target_membership_ids)
     or invitation.inviter_user_id = p_user_id
     or invitation.invited_email_normalized = lower(btrim(existing_email));

  get diagnostics target_invitation_count = row_count;

  update public.member_csv_import_rows as import_row
  set raw_payload = pg_catalog.jsonb_build_object(
        'redacted', true,
        'reason', 'account_anonymized'
      ),
      first_name = null,
      last_name = null,
      invited_email = null,
      invited_email_normalized = null,
      spouse_first_name = null,
      spouse_last_name = null,
      secondary_email = null,
      home_phone = null,
      work_phone = null,
      mobile_phone = null,
      address_line1 = null,
      address_line2 = null,
      city = null,
      state_region = null,
      postal_code = null,
      country = null,
      secondary_email_visible = false,
      home_phone_visible = false,
      work_phone_visible = false,
      mobile_phone_visible = false,
      address_listed = false
  where import_row.membership_id = any(target_membership_ids)
     or import_row.invited_email_normalized = lower(btrim(existing_email));

  update public.email_suppressions as suppression
  set normalized_address = redacted_email
  where suppression.normalized_address = lower(btrim(existing_email));

  update public.memberships as membership
  set status = 'inactive'::public.membership_status,
      inactivated_at = coalesce(membership.inactivated_at, anonymized_at_value),
      version = membership.version + 1
  where membership.user_id = p_user_id
    and membership.status <> 'inactive'::public.membership_status;

  update public.membership_golfer_profiles as golfer
  set first_name = 'Deleted',
      last_name = 'Member',
      spouse_first_name = null,
      spouse_last_name = null,
      version = golfer.version + 1
  where golfer.membership_id = any(target_membership_ids);

  update public.membership_private_contacts as contact
  set secondary_email = null,
      secondary_email_normalized = null,
      home_phone_display = null,
      home_phone_normalized = null,
      work_phone_display = null,
      work_phone_normalized = null,
      mobile_phone_display = null,
      mobile_phone_normalized = null,
      address_line1 = null,
      address_line2 = null,
      city = null,
      state_region = null,
      postal_code = null,
      country = null,
      secondary_email_visible = false,
      home_phone_visible = false,
      work_phone_visible = false,
      mobile_phone_visible = false,
      address_listed = false,
      version = contact.version + 1
  where contact.membership_id = any(target_membership_ids);

  update public.push_devices as device
  set expo_push_token = 'redacted:' || replace(device.device_id::text, '-', ''),
      active = false,
      retired_at = coalesce(device.retired_at, anonymized_at_value),
      retirement_reason = coalesce(device.retirement_reason, 'membership_inactive'),
      retirement_correlation_id = coalesce(device.retirement_correlation_id, p_correlation_id),
      version = device.version + 1
  where device.user_id = p_user_id;

  select count(*)
  into target_push_device_count
  from public.push_devices as device
  where device.user_id = p_user_id;

  update public.user_profiles as profile
  set display_name = null,
      first_name = null,
      last_name = null,
      disabled_at = coalesce(profile.disabled_at, anonymized_at_value)
  where profile.user_id = p_user_id;

  -- The existing Auth e-mail audit trigger only permits a verified e-mail
  -- transition. Commit the non-routable replacement first, then clear the
  -- verification and credential fields in a second update that does not
  -- change email again.
  update auth.users as identity
  set email = redacted_email,
      updated_at = anonymized_at_value
  where identity.id = p_user_id;

  update auth.users as identity
  set encrypted_password = null,
      email_confirmed_at = null,
      confirmation_token = null,
      confirmation_sent_at = null,
      recovery_token = null,
      recovery_sent_at = null,
      email_change_token_new = null,
      email_change = null,
      email_change_sent_at = null,
      last_sign_in_at = null,
      raw_user_meta_data = '{}'::jsonb,
      phone = null,
      phone_confirmed_at = null,
      phone_change = '',
      phone_change_token = '',
      phone_change_sent_at = null,
      reauthentication_token = '',
      reauthentication_sent_at = null,
      banned_until = 'infinity'::timestamptz,
      deleted_at = coalesce(identity.deleted_at, anonymized_at_value),
      updated_at = anonymized_at_value
  where identity.id = p_user_id;

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
    reason,
    occurred_at
  )
  select
    group_id,
    null,
    'privacy.account_anonymized',
    'user',
    p_user_id,
    null,
    pg_catalog.jsonb_build_object(
      'membership_count', target_membership_count,
      'email_delivery_count', target_email_delivery_count,
      'push_device_count', target_push_device_count
    ),
    pg_catalog.jsonb_build_object(
      'account_state', 'anonymized',
      'direct_identifiers_removed', true
    ),
    'privacy_process',
    p_correlation_id,
    pg_catalog.btrim(p_reason),
    anonymized_at_value
  from unnest(target_group_ids) as group_id;

  return query
  select
    p_user_id,
    target_membership_count,
    target_invitation_count,
    target_email_delivery_count,
    target_push_device_count,
    anonymized_at_value::app.utc_instant;
end;
$$;

comment on function public.anonymize_account_for_privacy(uuid, uuid, text) is
  'Service-only approved privacy-process operation: removes direct identifiers, disables access, retires credentials, and preserves pseudonymous sporting and audit history. It does not create an in-product request tracker.';

revoke all on function public.anonymize_account_for_privacy(uuid, uuid, text)
from public, anon, authenticated, service_role;
grant execute on function public.anonymize_account_for_privacy(uuid, uuid, text)
to service_role;
