begin;

create extension if not exists pgtap with schema extensions;

select plan(24);

select has_function(
  'public',
  'anonymize_account_for_privacy',
  array['uuid', 'uuid', 'text'],
  'privacy anonymization operation exists'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.anonymize_account_for_privacy(uuid,uuid,text)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.anonymize_account_for_privacy(uuid,uuid,text)',
    'execute'
  ),
  'privacy anonymization is callable only by the trusted service'
);
select ok(
  (select prosecdef and proconfig = array['search_path=""']
   from pg_catalog.pg_proc
   where oid = 'public.anonymize_account_for_privacy(uuid,uuid,text)'::regprocedure),
  'privacy anonymization pins a security-definer search path'
);

insert into auth.users (
  id, email, encrypted_password, email_confirmed_at, is_sso_user,
  is_anonymous, raw_user_meta_data, created_at, updated_at
)
values
  ('b8000000-0000-4000-8000-000000000001', 'privacy-target@example.test', 'hash', now(), false, false, '{"name":"Private Target"}', now(), now()),
  ('b8000000-0000-4000-8000-000000000002', 'privacy-admin@example.test', 'hash', now(), false, false, '{}', now(), now()),
  ('b8000000-0000-4000-8000-000000000003', 'privacy-last-admin@example.test', 'hash', now(), false, false, '{}', now(), now());

insert into public.user_profiles (user_id, display_name, first_name, last_name)
values
  ('b8000000-0000-4000-8000-000000000001', 'Private Target', 'Private', 'Target'),
  ('b8000000-0000-4000-8000-000000000002', 'Privacy Admin', 'Privacy', 'Admin'),
  ('b8000000-0000-4000-8000-000000000003', 'Last Admin', 'Last', 'Admin');

insert into public.groups (id, name, time_zone)
values
  ('b8100000-0000-4000-8000-000000000001', 'Privacy Group', 'UTC'),
  ('b8100000-0000-4000-8000-000000000002', 'Last Admin Group', 'UTC');

insert into public.memberships (
  id, group_id, user_id, role, status, activated_at
)
values
  ('b8200000-0000-4000-8000-000000000001', 'b8100000-0000-4000-8000-000000000001', 'b8000000-0000-4000-8000-000000000001', 'member', 'active', now()),
  ('b8200000-0000-4000-8000-000000000002', 'b8100000-0000-4000-8000-000000000001', 'b8000000-0000-4000-8000-000000000002', 'administrator', 'active', now()),
  ('b8200000-0000-4000-8000-000000000003', 'b8100000-0000-4000-8000-000000000002', 'b8000000-0000-4000-8000-000000000003', 'administrator', 'active', now());

insert into public.membership_golfer_profiles (
  membership_id, group_id, first_name, last_name, spouse_first_name, spouse_last_name
)
values (
  'b8200000-0000-4000-8000-000000000001',
  'b8100000-0000-4000-8000-000000000001',
  'Private', 'Target', 'Spouse', 'Target'
);

insert into public.membership_private_contacts (
  membership_id, group_id, secondary_email, home_phone_display,
  home_phone_normalized, address_line1, city, state_region, postal_code,
  country, secondary_email_visible, home_phone_visible, address_listed
)
values (
  'b8200000-0000-4000-8000-000000000001',
  'b8100000-0000-4000-8000-000000000001',
  'secondary@example.test', '+1 555 0100', '+15550100', '1 Private Way',
  'Privacy City', 'PR', '00001', 'US', true, true, true
);

insert into public.membership_invitations (
  id, group_id, membership_id, invited_email, invited_email_normalized,
  role, token_digest_sha256, token_key_version, status, issued_at, expires_at,
  inviter_user_id
)
values (
  'b8300000-0000-4000-8000-000000000001',
  'b8100000-0000-4000-8000-000000000001',
  'b8200000-0000-4000-8000-000000000001',
  'privacy-target@example.test', 'privacy-target@example.test', 'member',
  repeat('a', 64), 1, 'pending', now(), now() + interval '1 day',
  'b8000000-0000-4000-8000-000000000002'
);

insert into public.notification_outbox_jobs (
  id, group_id, event_type, aggregate_type, aggregate_id,
  aggregate_version, idempotency_key
)
values
  ('b8400000-0000-4000-8000-000000000001', 'b8100000-0000-4000-8000-000000000001', 'privacy', 'membership', 'b8200000-0000-4000-8000-000000000001', 1, 'privacy:email:one'),
  ('b8400000-0000-4000-8000-000000000002', 'b8100000-0000-4000-8000-000000000001', 'privacy', 'membership', 'b8200000-0000-4000-8000-000000000001', 1, 'privacy:email:two'),
  ('b8400000-0000-4000-8000-000000000003', 'b8100000-0000-4000-8000-000000000001', 'privacy', 'membership', 'b8200000-0000-4000-8000-000000000001', 1, 'privacy:push');

insert into public.notification_deliveries (
  id, group_id, outbox_job_id, recipient_membership_id, recipient_address,
  recipient_address_normalized, channel, state, sent_at
)
values
  ('b8500000-0000-4000-8000-000000000001', 'b8100000-0000-4000-8000-000000000001', 'b8400000-0000-4000-8000-000000000001', 'b8200000-0000-4000-8000-000000000001', 'privacy-target@example.test', 'privacy-target@example.test', 'email', 'queued', null),
  ('b8500000-0000-4000-8000-000000000002', 'b8100000-0000-4000-8000-000000000001', 'b8400000-0000-4000-8000-000000000002', 'b8200000-0000-4000-8000-000000000001', 'privacy-target@example.test', 'privacy-target@example.test', 'email', 'sent', now());

insert into public.email_suppressions (normalized_address, reason)
values ('privacy-target@example.test', 'bounce');

insert into public.push_devices (
  device_id, user_id, expo_push_token, platform, last_seen_at
)
values (
  'b8600000-0000-4000-8000-000000000001',
  'b8000000-0000-4000-8000-000000000001',
  'ExponentPushToken[privacy-target]', 'ios', now()
);

insert into public.notification_push_deliveries (
  id, group_id, outbox_job_id, recipient_membership_id, recipient_user_id,
  device_id, state
)
values (
  'b8700000-0000-4000-8000-000000000001',
  'b8100000-0000-4000-8000-000000000001',
  'b8400000-0000-4000-8000-000000000003',
  'b8200000-0000-4000-8000-000000000001',
  'b8000000-0000-4000-8000-000000000001',
  'b8600000-0000-4000-8000-000000000001',
  'queued'
);

set local role service_role;
select *
into temporary table anonymized
from public.anonymize_account_for_privacy(
  'b8000000-0000-4000-8000-000000000001',
  'b8800000-0000-4000-8000-000000000001',
  'Approved request PRIV-001'
);
reset role;

select is((select anonymized_user_id from anonymized), 'b8000000-0000-4000-8000-000000000001'::uuid, 'result identifies only the pseudonymous user id');
select is((select membership_count from anonymized), 1::bigint, 'result counts target memberships');
select is((select invitation_count from anonymized), 1::bigint, 'result counts target invitations');
select is((select email_delivery_count from anonymized), 2::bigint, 'result counts target e-mail history');
select is((select push_device_count from anonymized), 1::bigint, 'result counts target push devices');
select ok((select anonymized_at is not null from anonymized), 'result includes server anonymization time');
select is((select email::text from auth.users where id = 'b8000000-0000-4000-8000-000000000001'), 'deleted+b8000000000040008000000000000001@invalid.greenroster.local', 'Auth e-mail is replaced with a non-routable identifier');
select ok(
  (select deleted_at is not null and encrypted_password is null and raw_user_meta_data = '{}'::jsonb and banned_until = 'infinity'::timestamptz
   from auth.users where id = 'b8000000-0000-4000-8000-000000000001'),
  'Auth credentials and metadata are disabled and cleared'
);
select ok(
  (select status = 'inactive'::public.membership_status and user_id = 'b8000000-0000-4000-8000-000000000001'::uuid and inactivated_at is not null
   from public.memberships where id = 'b8200000-0000-4000-8000-000000000001'),
  'membership is disabled while its pseudonymous identity link remains for history'
);
select is((select first_name || ' ' || last_name from public.membership_golfer_profiles where membership_id = 'b8200000-0000-4000-8000-000000000001'), 'Deleted Member', 'golfer history uses a generic pseudonym');
select ok(
  (select secondary_email is null and home_phone_display is null and address_line1 is null and not secondary_email_visible and not home_phone_visible and not address_listed
   from public.membership_private_contacts where membership_id = 'b8200000-0000-4000-8000-000000000001'),
  'private contact fields and visibility are cleared'
);
select ok(
  (select status = 'revoked'::public.membership_invitation_status and invited_email like 'deleted+%@invalid.greenroster.local'
   from public.membership_invitations where id = 'b8300000-0000-4000-8000-000000000001'),
  'invitation address is redacted and pending work is revoked'
);
select ok(
  (select state = 'cancelled'::public.notification_delivery_state and recipient_address like 'deleted+%@invalid.greenroster.local'
   from public.notification_deliveries where id = 'b8500000-0000-4000-8000-000000000001'),
  'queued e-mail is cancelled and redacted'
);
select ok(
  (select state = 'sent'::public.notification_delivery_state and recipient_address like 'deleted+%@invalid.greenroster.local'
   from public.notification_deliveries where id = 'b8500000-0000-4000-8000-000000000002'),
  'sent e-mail history is retained with a redacted address'
);
select ok(
  (select state = 'cancelled'::public.notification_delivery_state from public.notification_push_deliveries where id = 'b8700000-0000-4000-8000-000000000001'),
  'queued push work is cancelled'
);
select ok(
  (select not active and expo_push_token like 'redacted:%' and retirement_reason = 'membership_inactive'
   from public.push_devices where device_id = 'b8600000-0000-4000-8000-000000000001'),
  'push credentials are retired and replaced'
);
select is((select normalized_address from public.email_suppressions where normalized_address like 'deleted+%@invalid.greenroster.local'), 'deleted+b8000000000040008000000000000001@invalid.greenroster.local', 'e-mail suppression is redacted');
select ok(
  exists (
    select 1 from public.audit_events
    where action = 'privacy.account_anonymized'
      and target_id = 'b8000000-0000-4000-8000-000000000001'
      and correlation_id = 'b8800000-0000-4000-8000-000000000001'
      and after_state = '{"account_state":"anonymized","direct_identifiers_removed":true}'::jsonb
  ),
  'anonymization writes a redacted audit event'
);
select ok(
  not exists (
    select 1 from public.audit_events
    where action = 'privacy.account_anonymized'
      and (before_state::text like '%@example.test%' or after_state::text like '%@example.test%')
  ),
  'privacy audit state never copies direct contact data'
);

set local role service_role;
select throws_ok(
  $$ select * from public.anonymize_account_for_privacy('b8000000-0000-4000-8000-000000000001', 'b8800000-0000-4000-8000-000000000002', 'repeat') $$,
  'P0003',
  'privacy_identity_already_anonymized',
  'anonymization is not replayed'
);
select throws_ok(
  $$ select * from public.anonymize_account_for_privacy('b8000000-0000-4000-8000-000000000003', 'b8800000-0000-4000-8000-000000000003', 'last admin') $$,
  'P0003',
  'privacy_last_active_administrator',
  'the last active administrator cannot be anonymized'
);
reset role;

select * from finish();

rollback;
