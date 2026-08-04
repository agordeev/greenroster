begin;

create extension if not exists pgtap with schema extensions;

select plan(20);

select has_table(
  'public',
  'notification_push_deliveries',
  'push delivery projection exists'
);
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class
   where oid = 'public.notification_push_deliveries'::regclass),
  'push deliveries are force-RLS'
);
select ok(
  has_table_privilege('service_role', 'public.notification_push_deliveries', 'select')
  and not has_table_privilege('authenticated', 'public.notification_push_deliveries', 'select'),
  'push delivery rows remain service-only through table grants'
);

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at
)
values
  ('f1000000-0000-4000-8000-000000000001', 'fanout-admin@example.test', now(), false, false, now(), now()),
  ('f1000000-0000-4000-8000-000000000002', 'fanout-member@example.test', now(), false, false, now(), now()),
  ('f1000000-0000-4000-8000-000000000003', 'fanout-disabled@example.test', now(), false, false, now(), now()),
  ('f1000000-0000-4000-8000-000000000004', 'fanout-inactive@example.test', now(), false, false, now(), now());

insert into public.user_profiles (user_id, display_name, first_name, last_name)
values
  ('f1000000-0000-4000-8000-000000000001', 'Fanout Admin', 'Fanout', 'Admin'),
  ('f1000000-0000-4000-8000-000000000002', 'Fanout Member', 'Fanout', 'Member'),
  ('f1000000-0000-4000-8000-000000000003', 'Fanout Disabled', 'Fanout', 'Disabled'),
  ('f1000000-0000-4000-8000-000000000004', 'Fanout Inactive', 'Fanout', 'Inactive');

insert into public.groups (id, name, time_zone)
values
  ('f2000000-0000-4000-8000-000000000001', 'Fanout Group', 'UTC'),
  ('f2000000-0000-4000-8000-000000000002', 'Other Fanout Group', 'UTC');

insert into public.memberships (
  id, group_id, user_id, role, status, activated_at, inactivated_at
)
values
  ('f3000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'administrator', 'active', now(), null),
  ('f3000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000002', 'member', 'active', now(), null),
  ('f3000000-0000-4000-8000-000000000003', 'f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000003', 'member', 'active', now(), null),
  ('f3000000-0000-4000-8000-000000000004', 'f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000004', 'member', 'inactive', now(), now());

insert into public.notification_preferences (
  membership_id, group_id, category, email_enabled, push_enabled
)
values (
  'f3000000-0000-4000-8000-000000000003',
  'f2000000-0000-4000-8000-000000000001',
  'results_published', false, false
);

insert into public.push_devices (
  device_id, user_id, expo_push_token, platform, last_seen_at
)
values
  ('f3100000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000002', 'ExponentPushToken[fanout-member-one]', 'ios', now()),
  ('f3100000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000002', 'ExponentPushToken[fanout-member-two]', 'android', now()),
  ('f3100000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000003', 'ExponentPushToken[fanout-disabled]', 'ios', now()),
  ('f3100000-0000-4000-8000-000000000004', 'f1000000-0000-4000-8000-000000000004', 'ExponentPushToken[fanout-inactive]', 'ios', now());

insert into public.rounds (
  id, group_id, description, scheduled_at, group_time_zone, format, state,
  published_at, created_by, version
)
values
  ('f4000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'Fanout round', now(), 'UTC', 'individual_net', 'completed', now(), 'f1000000-0000-4000-8000-000000000001', 3),
  ('f4000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000002', 'Other tenant round', now(), 'UTC', 'individual_net', 'completed', now(), 'f1000000-0000-4000-8000-000000000001', 2);

insert into public.round_completion_runs (
  id, round_id, group_id, completion_number, state, completed_at,
  completed_by, round_version, correlation_id, operation_id
)
values
  ('f4100000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 1, 'official', now(), 'f1000000-0000-4000-8000-000000000001', 3, 'f4200000-0000-4000-8000-000000000001', 'f4300000-0000-4000-8000-000000000001');

insert into public.round_participants (
  id, round_id, group_id, membership_id, participant_kind, sponsor_membership_id,
  guest_first_name, guest_last_name, rsvp_status
)
values
  ('f5000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000002', 'member', null, null, null, 'playing'),
  ('f5000000-0000-4000-8000-000000000002', 'f4000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000003', 'member', null, null, null, 'playing'),
  ('f5000000-0000-4000-8000-000000000003', 'f4000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', null, 'guest', 'f3000000-0000-4000-8000-000000000001', 'Round', 'Guest', 'playing'),
  ('f5000000-0000-4000-8000-000000000004', 'f4000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000004', 'member', null, null, null, 'playing');

insert into public.notification_outbox_jobs (
  id, group_id, event_type, aggregate_type, aggregate_id, aggregate_version,
  idempotency_key
)
values (
  'f6000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000001',
  'results_published', 'round_completion', 'f4100000-0000-4000-8000-000000000001', 3,
  'results_published:f4100000-0000-4000-8000-000000000001'
);

select is((select count(*) from public.notification_deliveries where outbox_job_id = 'f6000000-0000-4000-8000-000000000001'), 1::bigint, 'default-enabled member receives one result e-mail');
select is((select state from public.notification_deliveries where outbox_job_id = 'f6000000-0000-4000-8000-000000000001'), 'queued'::public.notification_delivery_state, 'result e-mail starts queued');
select is((select count(*) from public.notification_push_deliveries where outbox_job_id = 'f6000000-0000-4000-8000-000000000001'), 2::bigint, 'each active member device receives one result push row');
select is((select count(*) from public.notification_push_deliveries where recipient_membership_id = 'f3000000-0000-4000-8000-000000000002'), 2::bigint, 'push rows retain membership scope without copying tokens');
select is((select count(*) from public.notification_deliveries where recipient_membership_id = 'f3000000-0000-4000-8000-000000000003'), 0::bigint, 'disabled e-mail preference suppresses queueing');
select is((select count(*) from public.notification_push_deliveries where recipient_membership_id = 'f3000000-0000-4000-8000-000000000003'), 0::bigint, 'disabled push preference suppresses queueing');
select is((select count(*) from public.notification_deliveries where recipient_membership_id = 'f3000000-0000-4000-8000-000000000004'), 0::bigint, 'inactive participants are excluded from e-mail');
select is((select count(*) from public.notification_push_deliveries where recipient_membership_id = 'f3000000-0000-4000-8000-000000000004'), 0::bigint, 'inactive participants are excluded from push');
select is((select count(*) from public.notification_deliveries where recipient_membership_id is null), 0::bigint, 'guests are excluded from e-mail');
select is((select count(*) from public.notification_push_deliveries where recipient_membership_id is null), 0::bigint, 'guests are excluded from push');
select is((select state from public.notification_outbox_jobs where id = 'f6000000-0000-4000-8000-000000000001'), 'queued'::public.notification_outbox_job_state, 'parent remains queued while child work is sendable');
select ok(
  not exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = 'public.notification_push_deliveries'::regclass
      and attribute.attname = 'expo_push_token'
      and not attribute.attisdropped
  ),
  'push delivery rows never persist raw Expo tokens'
);

insert into public.notification_outbox_jobs (
  id, group_id, event_type, aggregate_type, aggregate_id, aggregate_version,
  idempotency_key
)
values (
  'f6000000-0000-4000-8000-000000000002',
  'f2000000-0000-4000-8000-000000000002',
  'results_published', 'round_completion', 'f4100000-0000-4000-8000-000000000001', 2,
  'results_published:other-tenant'
);
select is((select state from public.notification_outbox_jobs where id = 'f6000000-0000-4000-8000-000000000002'), 'succeeded'::public.notification_outbox_job_state, 'a tenant with no eligible participants closes its parent job');
select is((select safe_error from public.notification_outbox_jobs where id = 'f6000000-0000-4000-8000-000000000002'), 'no_sendable_recipients', 'no-recipient completion is retained with a safe reason');

insert into public.notification_outbox_jobs (
  group_id, event_type, aggregate_type, aggregate_id, aggregate_version,
  idempotency_key
)
values (
  'f2000000-0000-4000-8000-000000000001',
  'results_published', 'round_completion', 'f4100000-0000-4000-8000-000000000001', 3,
  'results_published:f4100000-0000-4000-8000-000000000001'
)
on conflict (idempotency_key) do nothing;
select is((select count(*) from public.notification_deliveries where outbox_job_id = 'f6000000-0000-4000-8000-000000000001'), 1::bigint, 'replayed outbox insertion does not duplicate e-mail');
select is((select count(*) from public.notification_push_deliveries where outbox_job_id = 'f6000000-0000-4000-8000-000000000001'), 2::bigint, 'replayed outbox insertion does not duplicate push devices');

select throws_ok(
  $$ insert into public.notification_push_deliveries (
       group_id, outbox_job_id, recipient_membership_id, recipient_user_id,
       device_id
     ) values (
       'f2000000-0000-4000-8000-000000000001',
       'f6000000-0000-4000-8000-000000000001',
       'f3000000-0000-4000-8000-000000000002',
       'f1000000-0000-4000-8000-000000000003',
       'f3100000-0000-4000-8000-000000000001'
     ) $$,
  '23514',
  'push_delivery_recipient_mismatch',
  'push delivery cannot cross an identity boundary'
);

select * from finish();

rollback;
