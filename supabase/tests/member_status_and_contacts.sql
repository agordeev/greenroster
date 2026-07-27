begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

select has_column(
  'public',
  'memberships',
  'version',
  'memberships have an optimistic concurrency version'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid = 'public.memberships'::regclass),
  'memberships force RLS'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid = 'public.membership_golfer_profiles'::regclass),
  'golfer profiles force RLS'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid = 'public.membership_private_contacts'::regclass),
  'private contacts force RLS'
);
select ok(
  not has_table_privilege('authenticated', 'public.memberships', 'insert,update,delete'),
  'authenticated clients cannot write memberships directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.membership_golfer_profiles', 'select,insert,update,delete'),
  'authenticated clients cannot read or write golfer profiles directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.membership_private_contacts', 'select,insert,update,delete'),
  'authenticated clients cannot read or write private contacts directly'
);
select ok(
  not has_table_privilege('service_role', 'public.membership_private_contacts', 'select,insert,update,delete'),
  'service role receives no raw private-contact table grant'
);
select ok(
  has_function_privilege('service_role', 'public.list_manageable_members(uuid)', 'execute'),
  'service role can call the management list projection'
);
select ok(
  has_function_privilege('service_role', 'public.edit_member(uuid,uuid,text,text,text,text,text,boolean,text,text,text,text,text,text,text,text,text,text,boolean,boolean,boolean,boolean,boolean,bigint,bigint,bigint,text,uuid,uuid)', 'execute'),
  'service role can call the atomic member edit'
);
select ok(
  has_function_privilege('service_role', 'public.set_member_status(uuid,uuid,public.membership_status,bigint,boolean,text,uuid,uuid)', 'execute'),
  'service role can call the status lifecycle mutation'
);
select ok(
  not has_function_privilege('authenticated', 'public.edit_member(uuid,uuid,text,text,text,text,text,boolean,text,text,text,text,text,text,text,text,text,text,boolean,boolean,boolean,boolean,boolean,bigint,bigint,bigint,text,uuid,uuid)', 'execute'),
  'authenticated clients cannot call member edit directly'
);

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at
)
values
  ('18000000-0000-4000-8000-000000000001', 'status-admin-a@example.test', now(), false, false, now(), now()),
  ('18000000-0000-4000-8000-000000000002', 'status-coordinator-a@example.test', now(), false, false, now(), now()),
  ('18000000-0000-4000-8000-000000000003', 'status-target-a@example.test', now(), false, false, now(), now()),
  ('18000000-0000-4000-8000-000000000004', 'status-target-inactive-a@example.test', now(), false, false, now(), now()),
  ('18000000-0000-4000-8000-000000000005', 'status-admin-b@example.test', now(), false, false, now(), now()),
  ('18000000-0000-4000-8000-000000000006', 'status-admin-c@example.test', now(), false, false, now(), now()),
  ('18000000-0000-4000-8000-000000000007', 'status-target-admin-a@example.test', now(), false, false, now(), now());

insert into public.user_profiles (user_id, first_name, last_name)
values
  ('18000000-0000-4000-8000-000000000001', 'Admin', 'Alpha'),
  ('18000000-0000-4000-8000-000000000002', 'Coordinator', 'Alpha'),
  ('18000000-0000-4000-8000-000000000003', 'Target', 'Alpha'),
  ('18000000-0000-4000-8000-000000000004', 'Inactive', 'Alpha'),
  ('18000000-0000-4000-8000-000000000005', 'Admin', 'Beta'),
  ('18000000-0000-4000-8000-000000000006', 'Admin', 'Charlie'),
  ('18000000-0000-4000-8000-000000000007', 'Target Admin', 'Alpha');

insert into public.groups (id, name, time_zone)
values
  ('58000000-0000-4000-8000-000000000001', 'Status Group A', 'UTC'),
  ('58000000-0000-4000-8000-000000000002', 'Status Group B', 'UTC'),
  ('58000000-0000-4000-8000-000000000003', 'Status Group C', 'UTC');

insert into public.memberships (
  id, group_id, user_id, role, status, dues_paid, activated_at, inactivated_at
)
values
  ('68000000-0000-4000-8000-000000000001', '58000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000001', 'administrator', 'active', true, now(), null),
  ('68000000-0000-4000-8000-000000000002', '58000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000002', 'coordinator', 'active', false, now(), null),
  ('68000000-0000-4000-8000-000000000003', '58000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000003', 'member', 'active', false, now(), null),
  ('68000000-0000-4000-8000-000000000004', '58000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000004', 'member', 'inactive', false, now(), now()),
  ('68000000-0000-4000-8000-000000000005', '58000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000007', 'administrator', 'active', false, now(), null),
  ('68000000-0000-4000-8000-000000000006', '58000000-0000-4000-8000-000000000002', '18000000-0000-4000-8000-000000000005', 'administrator', 'active', false, now(), null),
  ('68000000-0000-4000-8000-000000000007', '58000000-0000-4000-8000-000000000003', '18000000-0000-4000-8000-000000000006', 'administrator', 'active', false, now(), null),
  ('68000000-0000-4000-8000-000000000008', '58000000-0000-4000-8000-000000000003', null, 'member', 'pending', false, null, null),
  ('68000000-0000-4000-8000-000000000009', '58000000-0000-4000-8000-000000000001', null, 'member', 'pending', false, null, null);

insert into public.membership_golfer_profiles (
  membership_id, group_id, first_name, last_name, spouse_first_name, tee_location
)
values
  ('68000000-0000-4000-8000-000000000001', '58000000-0000-4000-8000-000000000001', 'Admin', 'Alpha', null, 'middle'),
  ('68000000-0000-4000-8000-000000000002', '58000000-0000-4000-8000-000000000001', 'Coordinator', 'Alpha', null, 'back'),
  ('68000000-0000-4000-8000-000000000003', '58000000-0000-4000-8000-000000000001', 'Target', 'Alpha', 'Partner', 'middle'),
  ('68000000-0000-4000-8000-000000000004', '58000000-0000-4000-8000-000000000001', 'Inactive', 'Alpha', null, 'front'),
  ('68000000-0000-4000-8000-000000000005', '58000000-0000-4000-8000-000000000001', 'Target Admin', 'Alpha', null, 'pro');

insert into public.membership_private_contacts (
  membership_id, group_id, secondary_email, secondary_email_normalized,
  home_phone_display, home_phone_normalized, mobile_phone_display,
  mobile_phone_normalized, address_line1, city,
  secondary_email_visible, home_phone_visible, mobile_phone_visible, address_listed
)
values
  ('68000000-0000-4000-8000-000000000003', '58000000-0000-4000-8000-000000000001', 'private.target@example.test', 'private.target@example.test', '+1 555 100 1000', '+15551001000', '555-100-1001', '5551001001', '1 Private Way', 'Exampletown', true, false, false, false),
  ('68000000-0000-4000-8000-000000000004', '58000000-0000-4000-8000-000000000001', 'inactive.target@example.test', 'inactive.target@example.test', null, null, null, null, null, null, false, false, false, false),
  ('68000000-0000-4000-8000-000000000005', '58000000-0000-4000-8000-000000000001', 'admin.target@example.test', 'admin.target@example.test', null, null, null, null, null, null, false, false, false, false);

insert into public.notification_outbox_jobs (
  id, group_id, event_type, aggregate_type, aggregate_id, aggregate_version, idempotency_key
)
values (
  '78000000-0000-4000-8000-000000000001', '58000000-0000-4000-8000-000000000001', 'member.reminder', 'membership', '68000000-0000-4000-8000-000000000003', 1, 'status-test-reminder-1'
), (
  '78000000-0000-4000-8000-000000000002', '58000000-0000-4000-8000-000000000001', 'member.reminder', 'membership', '68000000-0000-4000-8000-000000000003', 1, 'status-test-delayed-bounce-1'
), (
  '78000000-0000-4000-8000-000000000003', '58000000-0000-4000-8000-000000000001', 'member.reminder', 'membership', '68000000-0000-4000-8000-000000000003', 1, 'status-test-processing-shared-1'
);
insert into public.notification_deliveries (
  id, group_id, outbox_job_id, recipient_membership_id, recipient_address,
  recipient_address_normalized, channel
)
values (
  '88000000-0000-4000-8000-000000000001', '58000000-0000-4000-8000-000000000001', '78000000-0000-4000-8000-000000000001', '68000000-0000-4000-8000-000000000003', 'target@example.test', 'target@example.test', 'email'
), (
  '88000000-0000-4000-8000-000000000003', '58000000-0000-4000-8000-000000000001', '78000000-0000-4000-8000-000000000001', '68000000-0000-4000-8000-000000000002', 'coordinator@example.test', 'coordinator@example.test', 'email'
);
insert into public.notification_deliveries (
  id, group_id, outbox_job_id, recipient_membership_id, recipient_address,
  recipient_address_normalized, channel, provider_message_id, state, attempts,
  sent_at, claim_token, claimed_at
)
values (
  '88000000-0000-4000-8000-000000000004', '58000000-0000-4000-8000-000000000001', '78000000-0000-4000-8000-000000000002', '68000000-0000-4000-8000-000000000003', 'target@example.test', 'target@example.test', 'email', 'resend-delayed-bounce-1', 'sent', 1, now(), null, null
), (
  '88000000-0000-4000-8000-000000000005', '58000000-0000-4000-8000-000000000001', '78000000-0000-4000-8000-000000000003', '68000000-0000-4000-8000-000000000003', 'target@example.test', 'target@example.test', 'email', null, 'sending', 1, null, '98000000-0000-4000-8000-000000000001', now()
);
insert into public.notification_deliveries (
  id, group_id, outbox_job_id, recipient_membership_id, recipient_address,
  recipient_address_normalized, channel
)
values (
  '88000000-0000-4000-8000-000000000006', '58000000-0000-4000-8000-000000000001', '78000000-0000-4000-8000-000000000003', '68000000-0000-4000-8000-000000000002', 'coordinator@example.test', 'coordinator@example.test', 'email'
);

update public.notification_outbox_jobs
set state = 'succeeded', finished_at = now()
where id = '78000000-0000-4000-8000-000000000002';
update public.notification_outbox_jobs
set state = 'processing', claimed_at = now()
where id = '78000000-0000-4000-8000-000000000003';

create temporary table managed_members on commit drop as
select * from public.list_manageable_members('18000000-0000-4000-8000-000000000002');
select is(
  (select count(*) from managed_members),
  6::bigint,
  'coordinator sees all same-group operational members'
);
select ok(
  not exists (
    select 1 from managed_members
    where to_jsonb(managed_members)::text like '%private.target@example.test%'
  ),
  'management list omits raw private contact values'
);
select is(
  (select contact_version from managed_members where membership_id = '68000000-0000-4000-8000-000000000003'),
  1::bigint,
  'management list returns private-contact version without contact data'
);
select throws_ok(
  $$ select * from public.list_manageable_members('18000000-0000-4000-8000-000000000003') $$,
  'P0003',
  'actor_not_authorized',
  'ordinary member cannot invoke management list'
);
select throws_ok(
  $$ select * from public.get_manageable_member('18000000-0000-4000-8000-000000000002', '68000000-0000-4000-8000-000000000006') $$,
  'P0002',
  'member_not_found',
  'cross-tenant guessed member id is denied'
);

create temporary table directory_members on commit drop as
select * from public.list_member_directory('18000000-0000-4000-8000-000000000003');
select is(
  (select secondary_email from directory_members where membership_id = '68000000-0000-4000-8000-000000000003'),
  'private.target@example.test',
  'directory exposes only an explicitly visible secondary e-mail'
);
select is(
  (select home_phone_display from directory_members where membership_id = '68000000-0000-4000-8000-000000000003'),
  null::text,
  'directory omits a private home phone'
);
select is(
  (select address_line1 from directory_members where membership_id = '68000000-0000-4000-8000-000000000003'),
  null::text,
  'directory omits a private address'
);

select is(
  (select count(*) from public.audit_events where action = 'member.private_contact_viewed'),
  0::bigint,
  'private-contact audit starts empty'
);
create temporary table private_read on commit drop as
select * from public.get_member_private_contact_detail(
  '18000000-0000-4000-8000-000000000002',
  '68000000-0000-4000-8000-000000000003',
  '28000000-0000-4000-8000-000000000001'
);
select is((select secondary_email from private_read), 'private.target@example.test', 'authorized private read returns the secondary e-mail');
select is((select home_phone_display from private_read), '+1 555 100 1000', 'authorized private read returns the home phone');
select is((select contact_version from private_read), 1::bigint, 'authorized private read returns the contact version');
select is(
  (select count(*) from public.audit_events where action = 'member.private_contact_viewed'),
  1::bigint,
  'every private-contact read appends an audit event'
);
select ok(
  not exists (
    select 1 from public.audit_events
    where action = 'member.private_contact_viewed'
      and (coalesce(before_state::text, '') || coalesce(after_state::text, '')) like '%private.target@example.test%'
  ),
  'private-contact audit state contains no raw contact value'
);

create temporary table edit_result on commit drop as
select * from public.edit_member(
  '18000000-0000-4000-8000-000000000002',
  '68000000-0000-4000-8000-000000000003',
  'Updated', 'Alpha', 'Partner', null, 'back', true,
  'updated.target@example.test', '+1 555 200 2000', null, null,
  '2 New Way', null, 'Newtown', null, '90210', 'United States',
  false, true, false, false, true,
  1, 1, 1, 'Member details corrected',
  '28000000-0000-4000-8000-000000000002',
  '38000000-0000-4000-8000-000000000001'
);
select is((select membership_version from edit_result), 2::bigint, 'dues edit increments membership version');
select is((select profile_version from edit_result), 2::bigint, 'profile edit increments profile version');
select is((select contact_version from edit_result), 2::bigint, 'contact edit increments contact version');
select is((select dues_paid from public.memberships where id = '68000000-0000-4000-8000-000000000003'), true, 'edit persists dues-paid state');
select is((select first_name from public.membership_golfer_profiles where membership_id = '68000000-0000-4000-8000-000000000003'), 'Updated', 'edit persists profile fields');
select is((select secondary_email from public.membership_private_contacts where membership_id = '68000000-0000-4000-8000-000000000003'), 'updated.target@example.test', 'edit persists contact fields');
select is((select address_listed from public.membership_private_contacts where membership_id = '68000000-0000-4000-8000-000000000003'), true, 'edit persists address visibility');
select ok(
  not exists (
    select 1 from public.audit_events
    where action = 'member.updated'
      and (coalesce(before_state::text, '') || coalesce(after_state::text, '')) like '%updated.target@example.test%'
  ),
  'member edit audit state contains no raw contact value'
);
select is(
  (select count(*) from public.audit_events where action = 'member.updated' and operation_id = '38000000-0000-4000-8000-000000000001'),
  1::bigint,
  'member edit writes one idempotency audit event'
);

create temporary table edit_replay on commit drop as
select * from public.edit_member(
  '18000000-0000-4000-8000-000000000002',
  '68000000-0000-4000-8000-000000000003',
  'Updated', 'Alpha', 'Partner', null, 'back', true,
  'updated.target@example.test', '+1 555 200 2000', null, null,
  '2 New Way', null, 'Newtown', null, '90210', 'United States',
  false, true, false, false, true,
  1, 1, 1, 'Member details corrected',
  '28000000-0000-4000-8000-000000000003',
  '38000000-0000-4000-8000-000000000001'
);
select is((select membership_version from edit_replay), 2::bigint, 'same edit operation replays the authoritative result');
select is(
  (select count(*) from public.audit_events where action = 'member.updated' and operation_id = '38000000-0000-4000-8000-000000000001'),
  1::bigint,
  'same edit operation does not append a second audit event'
);
select throws_ok(
  $$ select * from public.edit_member(
    '18000000-0000-4000-8000-000000000002',
    '68000000-0000-4000-8000-000000000003',
    'Different', 'Alpha', 'Partner', null, 'back', true,
    'updated.target@example.test', '+1 555 200 2000', null, null,
    '2 New Way', null, 'Newtown', null, '90210', 'United States',
    false, true, false, false, true,
    2, 2, 2, 'Changed payload',
    '28000000-0000-4000-8000-000000000004',
    '38000000-0000-4000-8000-000000000001'
  ) $$,
  '23505',
  'operation_id_reused',
  'edit operation id cannot be replayed with a changed payload'
);
select throws_ok(
  $$ select * from public.edit_member(
    '18000000-0000-4000-8000-000000000002',
    '68000000-0000-4000-8000-000000000003',
    'Stale', 'Alpha', 'Partner', null, 'back', true,
    'updated.target@example.test', '+1 555 200 2000', null, null,
    '2 New Way', null, 'Newtown', null, '90210', 'United States',
    false, true, false, false, true,
    1, 1, 2, 'Stale edit',
    '28000000-0000-4000-8000-000000000005',
    '38000000-0000-4000-8000-000000000005'
  ) $$,
  '40001',
  'member_profile_version_changed',
  'stale profile versions are rejected'
);
select throws_ok(
  $$ select * from public.edit_member(
    '18000000-0000-4000-8000-000000000002',
    '68000000-0000-4000-8000-000000000005',
    'Target Admin', 'Alpha', null, null, 'pro', false,
    'admin.target@example.test', null, null, null, null, null, null, null, null, null,
    false, false, false, false, false,
    1, 1, 1, 'Coordinator cannot edit an administrator',
    '28000000-0000-4000-8000-000000000006',
    '38000000-0000-4000-8000-000000000006'
  ) $$,
  'P0003',
  'member_admin_target_forbidden',
  'coordinator cannot edit administrator operational records'
);

create temporary table deactivate_result on commit drop as
select * from public.set_member_status(
  '18000000-0000-4000-8000-000000000002',
  '68000000-0000-4000-8000-000000000003',
  'inactive', 2, true, 'Member left the roster',
  '28000000-0000-4000-8000-000000000007',
  '38000000-0000-4000-8000-000000000007'
);
select is((select status from deactivate_result), 'inactive'::public.membership_status, 'deactivation sets inactive status');
select is((select membership_version from deactivate_result), 3::bigint, 'deactivation increments membership version');
select is((select cancelled_notification_count from deactivate_result), 2::bigint, 'deactivation cancels target queued and sending notification work');
select is((select state from public.notification_deliveries where id = '88000000-0000-4000-8000-000000000001'), 'cancelled'::public.notification_delivery_state, 'queued delivery is cancelled on deactivation');
select is((select state from public.notification_deliveries where id = '88000000-0000-4000-8000-000000000003'), 'queued'::public.notification_delivery_state, 'a shared-job delivery for an active recipient remains queued');
select is((select state from public.notification_outbox_jobs where id = '78000000-0000-4000-8000-000000000001'), 'queued'::public.notification_outbox_job_state, 'a shared outbox job remains sendable for an active recipient');
select is((select state from public.notification_deliveries where id = '88000000-0000-4000-8000-000000000005'), 'cancelled'::public.notification_delivery_state, 'sending target delivery is canceled on deactivation');
select is((select state from public.notification_deliveries where id = '88000000-0000-4000-8000-000000000006'), 'queued'::public.notification_delivery_state, 'processing shared job sibling remains queued');
select is((select state from public.notification_outbox_jobs where id = '78000000-0000-4000-8000-000000000003'), 'queued'::public.notification_outbox_job_state, 'processing shared parent is requeued for active sibling');
select is((select claimed_at from public.notification_outbox_jobs where id = '78000000-0000-4000-8000-000000000003'), null::app.utc_instant, 'requeued shared parent clears stale claim');
select is((select state from public.notification_deliveries where id = '88000000-0000-4000-8000-000000000004'), 'sent'::public.notification_delivery_state, 'delayed terminal delivery remains sent after deactivation');
select lives_ok(
  $$ select public.record_resend_email_feedback(
    'resend-event-delayed-bounce-1', 'email.bounced', 'resend-delayed-bounce-1', now(), 'target@example.test', 'permanent'
  ) $$,
  'delayed hard-bounce feedback is allowed for an inactive member'
);
select is((select state from public.notification_deliveries where id = '88000000-0000-4000-8000-000000000004'), 'failed_permanent'::public.notification_delivery_state, 'delayed hard-bounce transitions sent delivery to permanent failure');
select is((select reason from public.email_suppressions where normalized_address = 'target@example.test'), 'bounce'::public.email_suppression_reason, 'hard-bounce suppression persists for inactive member');
select is((select count(*) from public.audit_events where action = 'member.status_changed' and operation_id = '38000000-0000-4000-8000-000000000007'), 1::bigint, 'status transition writes a status audit event');
select ok(
  not exists (
    select 1 from public.audit_events
    where action = 'member.status_changed'
      and (coalesce(before_state::text, '') || coalesce(after_state::text, '')) like '%Member left the roster%'
  ),
  'status audit summaries do not embed free-form reason in state'
);
select throws_ok(
  $$ insert into public.notification_deliveries (
    id, group_id, outbox_job_id, recipient_membership_id, recipient_address,
    recipient_address_normalized, channel
  ) values (
    '88000000-0000-4000-8000-000000000002',
    '58000000-0000-4000-8000-000000000001',
    '78000000-0000-4000-8000-000000000001',
    '68000000-0000-4000-8000-000000000003',
    'target@example.test', 'target@example.test', 'email'
  ) $$,
  'P0001',
  'inactive_member_notification_suppressed',
  'new notification work cannot target an inactive member'
);
create temporary table deactivate_replay on commit drop as
select * from public.set_member_status(
  '18000000-0000-4000-8000-000000000002',
  '68000000-0000-4000-8000-000000000003',
  'inactive', 2, true, 'Member left the roster',
  '28000000-0000-4000-8000-000000000008',
  '38000000-0000-4000-8000-000000000007'
);
select is((select membership_version from deactivate_replay), 3::bigint, 'same status operation replays the authoritative result');
select throws_ok(
  $$ select * from public.set_member_status(
    '18000000-0000-4000-8000-000000000002',
    '68000000-0000-4000-8000-000000000003',
    'inactive', 3, true, 'Different reason',
    '28000000-0000-4000-8000-000000000009',
    '38000000-0000-4000-8000-000000000007'
  ) $$,
  '23505',
  'operation_id_reused',
  'status operation id cannot be replayed with a changed payload'
);

create temporary table reactivate_result on commit drop as
select * from public.set_member_status(
  '18000000-0000-4000-8000-000000000002',
  '68000000-0000-4000-8000-000000000003',
  'active', 3, true, 'Member returned to the roster',
  '28000000-0000-4000-8000-000000000010',
  '38000000-0000-4000-8000-000000000010'
);
select is((select status from reactivate_result), 'active'::public.membership_status, 'reactivation restores active status');
select is((select membership_version from reactivate_result), 4::bigint, 'reactivation increments membership version');
select is((select inactivated_at from reactivate_result), null::app.utc_instant, 'reactivation clears inactivated timestamp');
select throws_ok(
  $$ select * from public.set_member_status(
    '18000000-0000-4000-8000-000000000002',
    '68000000-0000-4000-8000-000000000005',
    'inactive', 1, true, 'Coordinator cannot target administrator',
    '28000000-0000-4000-8000-000000000011',
    '38000000-0000-4000-8000-000000000011'
  ) $$,
  'P0003',
  'member_admin_target_forbidden',
  'coordinator cannot deactivate an administrator'
);
select throws_ok(
  $$ select * from public.set_member_status(
    '18000000-0000-4000-8000-000000000002',
    '68000000-0000-4000-8000-000000000002',
    'inactive', 1, true, 'Self change is forbidden',
    '28000000-0000-4000-8000-000000000012',
    '38000000-0000-4000-8000-000000000012'
  ) $$,
  'P0003',
  'member_self_status_change_forbidden',
  'coordinator cannot deactivate self'
);
select throws_ok(
  $$ select * from public.set_member_status(
    '18000000-0000-4000-8000-000000000002',
    '68000000-0000-4000-8000-000000000009',
    'inactive', 1, true, 'Pending is invitation-scoped',
    '28000000-0000-4000-8000-000000000013',
    '38000000-0000-4000-8000-000000000013'
  ) $$,
  '22023',
  'member_status_transition_forbidden',
  'pending membership cannot be deactivated through status lifecycle'
);
select throws_ok(
  $$ select * from public.set_member_status(
    '18000000-0000-4000-8000-000000000003',
    '68000000-0000-4000-8000-000000000004',
    'active', 1, true, 'Member actor is not privileged',
    '28000000-0000-4000-8000-000000000014',
    '38000000-0000-4000-8000-000000000014'
  ) $$,
  'P0003',
  'actor_not_authorized',
  'ordinary member cannot reactivate another member'
);

select * from finish();
rollback;
