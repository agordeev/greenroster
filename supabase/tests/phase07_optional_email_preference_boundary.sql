begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at
)
values
  ('d1600000-0000-4000-8000-000000000001', 'preference-a@example.test', now(), false, false, now(), now()),
  ('d1600000-0000-4000-8000-000000000002', 'preference-b@example.test', now(), false, false, now(), now()),
  ('d1600000-0000-4000-8000-000000000003', 'preference-c@example.test', now(), false, false, now(), now());

insert into public.user_profiles (user_id, first_name, last_name)
values
  ('d1600000-0000-4000-8000-000000000001', 'Preference', 'A'),
  ('d1600000-0000-4000-8000-000000000002', 'Preference', 'B'),
  ('d1600000-0000-4000-8000-000000000003', 'Preference', 'C');

insert into public.groups (id, name, time_zone)
values
  ('d5600000-0000-4000-8000-000000000001', 'Preference Group A', 'UTC'),
  ('d5600000-0000-4000-8000-000000000002', 'Preference Group B', 'UTC');

insert into public.memberships (
  id, group_id, user_id, role, status, activated_at, inactivated_at
)
values
  ('d6600000-0000-4000-8000-000000000001', 'd5600000-0000-4000-8000-000000000001', 'd1600000-0000-4000-8000-000000000001', 'member', 'active', now(), null),
  ('d6600000-0000-4000-8000-000000000002', 'd5600000-0000-4000-8000-000000000002', 'd1600000-0000-4000-8000-000000000002', 'member', 'active', now(), null),
  ('d6600000-0000-4000-8000-000000000003', 'd5600000-0000-4000-8000-000000000001', 'd1600000-0000-4000-8000-000000000003', 'member', 'active', now(), null);

insert into public.notification_preferences (
  membership_id, group_id, category, email_enabled, push_enabled, version
)
values (
  'd6600000-0000-4000-8000-000000000001',
  'd5600000-0000-4000-8000-000000000001',
  'round_published',
  false,
  true,
  1
);
insert into public.notification_preferences (
  membership_id, group_id, category, email_enabled, push_enabled, version
)
values (
  'd6600000-0000-4000-8000-000000000001',
  'd5600000-0000-4000-8000-000000000001',
  'results_published',
  true,
  true,
  1
);

insert into public.notification_outbox_jobs (
  id, group_id, event_type, aggregate_type, aggregate_id, aggregate_version,
  idempotency_key
)
values (
  'd7000000-0000-4000-8000-000000000001',
  'd5600000-0000-4000-8000-000000000001',
  'round.published',
  'round',
  'd8000000-0000-4000-8000-000000000001',
  1,
  'preference-disabled'
);

insert into public.notification_deliveries (
  id, group_id, outbox_job_id, recipient_membership_id,
  recipient_address, recipient_address_normalized, channel
)
values (
  'd9000000-0000-4000-8000-000000000001',
  'd5600000-0000-4000-8000-000000000001',
  'd7000000-0000-4000-8000-000000000001',
  'd6600000-0000-4000-8000-000000000001',
  'preference-a@example.test',
  'preference-a@example.test',
  'email'
);

select is(
  (select count(*) from public.notification_deliveries where outbox_job_id = 'd7000000-0000-4000-8000-000000000001'),
  0::bigint,
  'disabled optional e-mail is skipped at the delivery boundary'
);
select is(
  (select state from public.notification_outbox_jobs where id = 'd7000000-0000-4000-8000-000000000001'),
  'cancelled'::public.notification_outbox_job_state,
  'disabled optional e-mail cancels its still-queued parent job'
);
select is(
  (select safe_error from public.notification_outbox_jobs where id = 'd7000000-0000-4000-8000-000000000001'),
  'preference_disabled',
  'disabled optional e-mail records a safe parent reason'
);

insert into public.notification_outbox_jobs (
  id, group_id, event_type, aggregate_type, aggregate_id, aggregate_version,
  idempotency_key
)
values (
  'd7000000-0000-4000-8000-000000000002',
  'd5600000-0000-4000-8000-000000000002',
  'round.published',
  'round',
  'd8000000-0000-4000-8000-000000000002',
  1,
  'preference-default'
);

insert into public.notification_deliveries (
  id, group_id, outbox_job_id, recipient_membership_id,
  recipient_address, recipient_address_normalized, channel
)
values (
  'd9000000-0000-4000-8000-000000000002',
  'd5600000-0000-4000-8000-000000000002',
  'd7000000-0000-4000-8000-000000000002',
  'd6600000-0000-4000-8000-000000000002',
  'preference-b@example.test',
  'preference-b@example.test',
  'email'
);

select is(
  (select count(*) from public.notification_deliveries where outbox_job_id = 'd7000000-0000-4000-8000-000000000002'),
  1::bigint,
  'default-enabled optional e-mail remains queued'
);

insert into public.notification_outbox_jobs (
  id, group_id, event_type, aggregate_type, aggregate_id, aggregate_version,
  idempotency_key
)
values (
  'd7000000-0000-4000-8000-000000000005',
  'd5600000-0000-4000-8000-000000000002',
  'round.published',
  'round',
  'd8000000-0000-4000-8000-000000000005',
  1,
  'preference-change'
);
insert into public.notification_deliveries (
  id, group_id, outbox_job_id, recipient_membership_id,
  recipient_address, recipient_address_normalized, channel
)
values (
  'd9000000-0000-4000-8000-000000000006',
  'd5600000-0000-4000-8000-000000000002',
  'd7000000-0000-4000-8000-000000000005',
  'd6600000-0000-4000-8000-000000000002',
  'preference-b@example.test',
  'preference-b@example.test',
  'email'
);
insert into public.notification_preferences (
  membership_id, group_id, category, email_enabled, push_enabled, version
)
values (
  'd6600000-0000-4000-8000-000000000002',
  'd5600000-0000-4000-8000-000000000002',
  'round_published',
  false,
  true,
  1
);
select is(
  (select state from public.notification_deliveries where id = 'd9000000-0000-4000-8000-000000000006'),
  'cancelled'::public.notification_delivery_state,
  'disabling an optional e-mail cancels a queued delivery already in the outbox'
);
select is(
  (select state from public.notification_outbox_jobs where id = 'd7000000-0000-4000-8000-000000000005'),
  'cancelled'::public.notification_outbox_job_state,
  'disabling an optional e-mail cancels its recipient-scoped parent job'
);

insert into public.notification_outbox_jobs (
  id, group_id, event_type, aggregate_type, aggregate_id, aggregate_version,
  idempotency_key
)
values (
  'd7000000-0000-4000-8000-000000000003',
  'd5600000-0000-4000-8000-000000000001',
  'round.cancelled',
  'round',
  'd8000000-0000-4000-8000-000000000003',
  1,
  'mandatory-cancellation'
);

insert into public.notification_deliveries (
  id, group_id, outbox_job_id, recipient_membership_id,
  recipient_address, recipient_address_normalized, channel
)
values (
  'd9000000-0000-4000-8000-000000000003',
  'd5600000-0000-4000-8000-000000000001',
  'd7000000-0000-4000-8000-000000000003',
  'd6600000-0000-4000-8000-000000000001',
  'preference-a@example.test',
  'preference-a@example.test',
  'email'
);

select is(
  (select count(*) from public.notification_deliveries where outbox_job_id = 'd7000000-0000-4000-8000-000000000003'),
  1::bigint,
  'mandatory cancellation e-mail bypasses optional preference filtering'
);

insert into public.notification_outbox_jobs (
  id, group_id, event_type, aggregate_type, aggregate_id, aggregate_version,
  idempotency_key
)
values (
  'd7000000-0000-4000-8000-000000000004',
  'd5600000-0000-4000-8000-000000000001',
  'results_published_fixture',
  'round_completion',
  'd8000000-0000-4000-8000-000000000004',
  1,
  'shared-results-parent'
);
update public.notification_outbox_jobs
set event_type = 'results_published'
where id = 'd7000000-0000-4000-8000-000000000004';

insert into public.notification_deliveries (
  id, group_id, outbox_job_id, recipient_membership_id,
  recipient_address, recipient_address_normalized, channel
)
values (
  'd9000000-0000-4000-8000-000000000004',
  'd5600000-0000-4000-8000-000000000001',
  'd7000000-0000-4000-8000-000000000004',
  'd6600000-0000-4000-8000-000000000001',
  'preference-a@example.test',
  'preference-a@example.test',
  'email'
);
insert into public.notification_deliveries (
  id, group_id, outbox_job_id, recipient_membership_id,
  recipient_address, recipient_address_normalized, channel
)
values (
  'd9000000-0000-4000-8000-000000000005',
  'd5600000-0000-4000-8000-000000000001',
  'd7000000-0000-4000-8000-000000000004',
  'd6600000-0000-4000-8000-000000000003',
  'preference-c@example.test',
  'preference-c@example.test',
  'email'
);

select is(
  (select count(*) from public.notification_deliveries where outbox_job_id = 'd7000000-0000-4000-8000-000000000004'),
  2::bigint,
  'enabled results recipients remain queued under the shared parent'
);
select is(
  (select state from public.notification_outbox_jobs where id = 'd7000000-0000-4000-8000-000000000004'),
  'queued'::public.notification_outbox_job_state,
  'shared results parent remains claimable while recipients are queued'
);

update public.notification_preferences
set email_enabled = false,
    version = version + 1
where membership_id = 'd6600000-0000-4000-8000-000000000001'
  and group_id = 'd5600000-0000-4000-8000-000000000001'
  and category = 'results_published';

select is(
  (select state from public.notification_deliveries where id = 'd9000000-0000-4000-8000-000000000004'),
  'cancelled'::public.notification_delivery_state,
  'disabling results e-mail cancels the matching queued child'
);
select is(
  (select state from public.notification_deliveries where id = 'd9000000-0000-4000-8000-000000000005'),
  'queued'::public.notification_delivery_state,
  'disabling one results recipient preserves another queued child'
);
select is(
  (select state from public.notification_outbox_jobs where id = 'd7000000-0000-4000-8000-000000000004'),
  'queued'::public.notification_outbox_job_state,
  'shared results parent remains claimable after one preference change'
);

insert into public.notification_preferences (
  membership_id, group_id, category, email_enabled, push_enabled, version
)
values (
  'd6600000-0000-4000-8000-000000000003',
  'd5600000-0000-4000-8000-000000000001',
  'results_published',
  false,
  true,
  1
);

select is(
  (select state from public.notification_deliveries where id = 'd9000000-0000-4000-8000-000000000005'),
  'cancelled'::public.notification_delivery_state,
  'disabling the final results recipient cancels the last queued child'
);
select is(
  (select state from public.notification_outbox_jobs where id = 'd7000000-0000-4000-8000-000000000004'),
  'succeeded'::public.notification_outbox_job_state,
  'shared results parent terminalizes after all children are cancelled'
);

select * from finish();
rollback;
