begin;

create extension if not exists pgtap with schema extensions;

select plan(29);

select has_function(
  'public',
  'read_notification_delivery_health',
  array['uuid'],
  'notification health read boundary exists'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.read_notification_delivery_health(uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.read_notification_delivery_health(uuid)',
    'execute'
  ),
  'notification health is callable only by the trusted server'
);
select ok(
  (select prosecdef and proconfig = array['search_path=""']
   from pg_catalog.pg_proc
   where oid = 'public.read_notification_delivery_health(uuid)'::regprocedure),
  'notification health pins a security-definer search path'
);

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at
)
values
  ('b7000000-0000-4000-8000-000000000001', 'health-admin@example.test', now(), false, false, now(), now()),
  ('b7000000-0000-4000-8000-000000000002', 'health-member@example.test', now(), false, false, now(), now());
insert into public.user_profiles (user_id, display_name, first_name, last_name)
values
  ('b7000000-0000-4000-8000-000000000001', 'Health Admin', 'Health', 'Admin'),
  ('b7000000-0000-4000-8000-000000000002', 'Health Member', 'Health', 'Member');
insert into public.groups (id, name, time_zone)
values ('b7100000-0000-4000-8000-000000000001', 'Health Group', 'UTC');
insert into public.memberships (
  id, group_id, user_id, role, status, activated_at
)
values
  ('b7200000-0000-4000-8000-000000000001', 'b7100000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000001', 'administrator', 'active', now()),
  ('b7200000-0000-4000-8000-000000000002', 'b7100000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000002', 'member', 'active', now());

insert into public.notification_outbox_jobs (
  id, group_id, event_type, aggregate_type, aggregate_id, aggregate_version,
  idempotency_key, state, created_at, updated_at
)
values
  ('b7300000-0000-4000-8000-000000000001', 'b7100000-0000-4000-8000-000000000001', 'health', 'test', 'b7400000-0000-4000-8000-000000000001', 1, 'health:one', 'queued', now() - interval '2 hours', now() - interval '2 hours'),
  ('b7300000-0000-4000-8000-000000000002', 'b7100000-0000-4000-8000-000000000001', 'health', 'test', 'b7400000-0000-4000-8000-000000000002', 1, 'health:two', 'retryable', now() - interval '1 hour', now() - interval '1 hour'),
  ('b7300000-0000-4000-8000-000000000003', 'b7100000-0000-4000-8000-000000000001', 'health', 'test', 'b7400000-0000-4000-8000-000000000003', 1, 'health:three', 'succeeded', now(), now()),
  ('b7300000-0000-4000-8000-000000000004', 'b7100000-0000-4000-8000-000000000001', 'health', 'test', 'b7400000-0000-4000-8000-000000000004', 1, 'health:four', 'succeeded', now(), now()),
  ('b7300000-0000-4000-8000-000000000005', 'b7100000-0000-4000-8000-000000000001', 'health', 'test', 'b7400000-0000-4000-8000-000000000005', 1, 'health:five', 'succeeded', now(), now()),
  ('b7300000-0000-4000-8000-000000000006', 'b7100000-0000-4000-8000-000000000001', 'health', 'test', 'b7400000-0000-4000-8000-000000000006', 1, 'health:six', 'succeeded', now(), now()),
  ('b7300000-0000-4000-8000-000000000007', 'b7100000-0000-4000-8000-000000000001', 'health', 'test', 'b7400000-0000-4000-8000-000000000007', 1, 'health:seven', 'succeeded', now(), now()),
  ('b7300000-0000-4000-8000-000000000008', 'b7100000-0000-4000-8000-000000000001', 'health', 'test', 'b7400000-0000-4000-8000-000000000008', 1, 'health:eight', 'succeeded', now(), now());

insert into public.notification_deliveries (
  id, group_id, outbox_job_id, recipient_membership_id, recipient_address,
  recipient_address_normalized, channel, state, attempts, provider_message_id,
  claim_token, claimed_at
)
values
  ('b7500000-0000-4000-8000-000000000001', 'b7100000-0000-4000-8000-000000000001', 'b7300000-0000-4000-8000-000000000001', 'b7200000-0000-4000-8000-000000000001', 'health-admin@example.test', 'health-admin@example.test', 'email', 'queued', 0, null, null, null),
  ('b7500000-0000-4000-8000-000000000002', 'b7100000-0000-4000-8000-000000000001', 'b7300000-0000-4000-8000-000000000002', 'b7200000-0000-4000-8000-000000000001', 'health-admin@example.test', 'health-admin@example.test', 'email', 'sending', 1, 'health-email-sending', 'b7800000-0000-4000-8000-000000000002', now()),
  ('b7500000-0000-4000-8000-000000000003', 'b7100000-0000-4000-8000-000000000001', 'b7300000-0000-4000-8000-000000000003', 'b7200000-0000-4000-8000-000000000001', 'health-admin@example.test', 'health-admin@example.test', 'email', 'retryable', 2, 'health-email-retryable', null, null),
  ('b7500000-0000-4000-8000-000000000004', 'b7100000-0000-4000-8000-000000000001', 'b7300000-0000-4000-8000-000000000004', 'b7200000-0000-4000-8000-000000000001', 'health-admin@example.test', 'health-admin@example.test', 'email', 'failed_permanent', 1, 'health-email-bounced', null, null),
  ('b7500000-0000-4000-8000-000000000005', 'b7100000-0000-4000-8000-000000000001', 'b7300000-0000-4000-8000-000000000005', 'b7200000-0000-4000-8000-000000000001', 'health-admin@example.test', 'health-admin@example.test', 'email', 'suppressed', 1, 'health-email-complained', null, null);

insert into public.notification_provider_events (
  event_id, provider, event_type, provider_message_id, group_id,
  delivery_id, occurred_at
)
values
  ('health-event-bounced', 'resend', 'email.bounced', 'health-email-bounced', 'b7100000-0000-4000-8000-000000000001', 'b7500000-0000-4000-8000-000000000004', now() - interval '10 minutes'),
  ('health-event-complained', 'resend', 'email.complained', 'health-email-complained', 'b7100000-0000-4000-8000-000000000001', 'b7500000-0000-4000-8000-000000000005', now() - interval '5 minutes');

insert into public.push_devices (
  device_id, user_id, expo_push_token, platform, last_seen_at
)
select
  ('b7600000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid,
  'b7000000-0000-4000-8000-000000000001',
  'ExponentPushToken[health-' || value::text || ']',
  'ios',
  now()
from generate_series(1, 6) as value;

insert into public.notification_push_deliveries (
  id, group_id, outbox_job_id, recipient_membership_id, recipient_user_id,
  device_id, state, attempts, failure_reason, provider_message_id
)
values
  ('b7700000-0000-4000-8000-000000000001', 'b7100000-0000-4000-8000-000000000001', 'b7300000-0000-4000-8000-000000000001', 'b7200000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000001', 'b7600000-0000-4000-8000-000000000001', 'queued', 0, null, null),
  ('b7700000-0000-4000-8000-000000000002', 'b7100000-0000-4000-8000-000000000001', 'b7300000-0000-4000-8000-000000000002', 'b7200000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000001', 'b7600000-0000-4000-8000-000000000002', 'retryable', 1, null, null),
  ('b7700000-0000-4000-8000-000000000003', 'b7100000-0000-4000-8000-000000000001', 'b7300000-0000-4000-8000-000000000003', 'b7200000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000001', 'b7600000-0000-4000-8000-000000000003', 'failed_permanent', 1, 'provider_invalid', null),
  ('b7700000-0000-4000-8000-000000000004', 'b7100000-0000-4000-8000-000000000001', 'b7300000-0000-4000-8000-000000000004', 'b7200000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000001', 'b7600000-0000-4000-8000-000000000004', 'cancelled', 1, 'round_reopened', null),
  ('b7700000-0000-4000-8000-000000000005', 'b7100000-0000-4000-8000-000000000001', 'b7300000-0000-4000-8000-000000000005', 'b7200000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000001', 'b7600000-0000-4000-8000-000000000005', 'sent', 1, null, 'health-ticket-one'),
  ('b7700000-0000-4000-8000-000000000006', 'b7100000-0000-4000-8000-000000000001', 'b7300000-0000-4000-8000-000000000006', 'b7200000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000001', 'b7600000-0000-4000-8000-000000000006', 'sent', 1, null, 'health-ticket-two');

insert into public.notification_push_receipts (
  id, group_id, delivery_id, device_id, provider_message_id,
  state, attempts, failure_reason, resolved_at
)
values (
  'b7900000-0000-4000-8000-000000000001',
  'b7100000-0000-4000-8000-000000000001',
  'b7700000-0000-4000-8000-000000000003',
  'b7600000-0000-4000-8000-000000000003',
  'health-ticket-three',
  'failed_permanent',
  1,
  'provider_invalid',
  now()
);

update public.notification_push_receipts
set state = 'failed_permanent',
    failure_reason = 'provider_invalid',
    resolved_at = now()
where provider_message_id = 'health-ticket-two';

set local role service_role;
create temporary table health as
select * from public.read_notification_delivery_health(
  'b7000000-0000-4000-8000-000000000001'
);
reset role;

select is((select group_id::uuid from health), 'b7100000-0000-4000-8000-000000000001'::uuid, 'health is scoped to the actor tenant');
select is((select outbox_queued from health), 1::bigint, 'health counts queued outbox jobs');
select is((select outbox_processing from health), 0::bigint, 'health counts processing outbox jobs');
select is((select outbox_retryable from health), 1::bigint, 'health counts retryable outbox jobs');
select ok((select outbox_oldest_at is not null from health), 'health exposes the oldest pending outbox timestamp');
select is((select email_queued from health), 1::bigint, 'health counts queued e-mail deliveries');
select is((select email_sending from health), 1::bigint, 'health counts sending e-mail deliveries');
select is((select email_retryable from health), 1::bigint, 'health counts retryable e-mail deliveries');
select is((select email_failed_permanent from health), 1::bigint, 'health counts failed e-mail deliveries');
select is((select email_suppressed from health), 1::bigint, 'health counts suppressed e-mail deliveries');
select is((select email_attempted from health), 4::bigint, 'health counts attempted e-mail deliveries');
select is((select email_bounced from health), 1::bigint, 'health counts distinct bounced e-mail deliveries');
select is((select email_complained from health), 1::bigint, 'health counts distinct complained e-mail deliveries');
select is((select email_bounce_rate from health), 0.25::numeric, 'health calculates the e-mail bounce rate');
select is((select email_complaint_rate from health), 0.25::numeric, 'health calculates the e-mail complaint rate');
select is((select push_queued from health), 1::bigint, 'health counts queued push deliveries');
select is((select push_retryable from health), 1::bigint, 'health counts retryable push deliveries');
select is((select push_failed_permanent from health), 1::bigint, 'health counts failed push deliveries');
select is((select push_cancelled from health), 1::bigint, 'health counts cancelled push deliveries');
select is((select push_invalid_token from health), 2::bigint, 'health counts immediate and receipt-invalid push tokens');
select is((select push_invalid_token_rate from health), 0.4::numeric, 'health calculates the invalid push-token rate');
select is((select push_receipt_pending from health), 1::bigint, 'health counts pending push receipts');
select is((select push_receipt_failed from health), 2::bigint, 'health counts failed push receipts');
select ok((select last_activity_at is not null and sampled_at is not null from health), 'health includes privacy-safe freshness timestamps');
select ok(
  not (row_to_json((select health from health))::text like '%@example.test%')
  and not (row_to_json((select health from health))::text like '%ExponentPushToken%'),
  'health output never includes recipient addresses or push tokens'
);

select throws_ok(
  $$ select * from public.read_notification_delivery_health('b7000000-0000-4000-8000-000000000002') $$,
  'P0002',
  'notification_health_not_available',
  'members cannot read coordinator notification health'
);

select * from finish();

rollback;
