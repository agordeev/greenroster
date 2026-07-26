begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

select has_type('public', 'membership_invitation_status', 'invitation lifecycle enum exists');
select has_type('public', 'notification_outbox_job_state', 'outbox state enum exists');
select has_type('public', 'notification_delivery_state', 'delivery state enum exists');
select has_type('public', 'notification_channel', 'notification channel enum exists');
select has_type('public', 'email_suppression_reason', 'suppression reason enum exists');
select has_table('public', 'membership_invitations', 'membership invitation table exists');
select has_table('public', 'notification_outbox_jobs', 'notification outbox table exists');
select has_table('public', 'notification_deliveries', 'notification delivery table exists');
select has_table('public', 'email_suppressions', 'email suppression table exists');

select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class
   where oid = 'public.membership_invitations'::regclass),
  'membership invitations force RLS'
);
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class
   where oid = 'public.notification_outbox_jobs'::regclass),
  'notification outbox jobs force RLS'
);
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class
   where oid = 'public.notification_deliveries'::regclass),
  'notification deliveries force RLS'
);
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class
   where oid = 'public.email_suppressions'::regclass),
  'email suppressions force RLS'
);

select ok(
  not has_table_privilege('anon', 'public.membership_invitations', 'select,insert,update,delete'),
  'anonymous clients cannot read or mutate invitations'
);
select ok(
  not has_table_privilege('authenticated', 'public.notification_outbox_jobs', 'select,insert,update,delete'),
  'authenticated clients cannot read or mutate outbox jobs'
);
select ok(
  has_table_privilege('service_role', 'public.notification_deliveries', 'select'),
  'trusted server can read delivery state'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.issue_membership_invitation(uuid,uuid,uuid,text,text,integer,timestamptz,uuid,uuid)',
    'execute'
  ),
  'trusted server can issue invitations'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.issue_membership_invitation(uuid,uuid,uuid,text,text,integer,timestamptz,uuid,uuid)',
    'execute'
  ),
  'authenticated clients cannot issue invitations directly'
);

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at
)
values
  ('88000000-0000-4000-8000-000000000001', 'invitation-admin-a@example.test', now(), false, false, now(), now()),
  ('88000000-0000-4000-8000-000000000002', 'invitation-coordinator-a@example.test', now(), false, false, now(), now()),
  ('88000000-0000-4000-8000-000000000003', 'invitation-member-a@example.test', now(), false, false, now(), now()),
  ('88000000-0000-4000-8000-000000000004', 'attached-member-a@example.test', now(), false, false, now(), now()),
  ('88000000-0000-4000-8000-000000000005', 'invitation-admin-b@example.test', now(), false, false, now(), now());

insert into public.user_profiles (user_id)
values
  ('88000000-0000-4000-8000-000000000001'),
  ('88000000-0000-4000-8000-000000000002'),
  ('88000000-0000-4000-8000-000000000003'),
  ('88000000-0000-4000-8000-000000000004'),
  ('88000000-0000-4000-8000-000000000005');

insert into public.groups (id, name, time_zone)
values
  ('98000000-0000-4000-8000-000000000001', 'Invitation Group A', 'UTC'),
  ('98000000-0000-4000-8000-000000000002', 'Invitation Group B', 'UTC');

insert into public.memberships (
  id, group_id, user_id, role, status, activated_at
)
values
  ('78000000-0000-4000-8000-000000000001', '98000000-0000-4000-8000-000000000001', '88000000-0000-4000-8000-000000000001', 'administrator', 'active', now()),
  ('78000000-0000-4000-8000-000000000002', '98000000-0000-4000-8000-000000000001', '88000000-0000-4000-8000-000000000002', 'coordinator', 'active', now()),
  ('78000000-0000-4000-8000-000000000003', '98000000-0000-4000-8000-000000000001', '88000000-0000-4000-8000-000000000003', 'member', 'active', now()),
  ('78000000-0000-4000-8000-000000000004', '98000000-0000-4000-8000-000000000001', '88000000-0000-4000-8000-000000000004', 'member', 'active', now()),
  ('78000000-0000-4000-8000-000000000005', '98000000-0000-4000-8000-000000000002', '88000000-0000-4000-8000-000000000005', 'administrator', 'active', now()),
  ('78000000-0000-4000-8000-000000000006', '98000000-0000-4000-8000-000000000001', null, 'member', 'pending', null),
  ('78000000-0000-4000-8000-000000000007', '98000000-0000-4000-8000-000000000001', null, 'coordinator', 'pending', null),
  ('78000000-0000-4000-8000-000000000008', '98000000-0000-4000-8000-000000000001', null, 'member', 'pending', null),
  ('78000000-0000-4000-8000-000000000009', '98000000-0000-4000-8000-000000000002', null, 'member', 'pending', null);

insert into public.membership_golfer_profiles (
  membership_id, group_id, first_name, last_name
)
select membership.id, membership.group_id, 'Pending', membership.id::text
from public.memberships as membership
where membership.id in (
  '78000000-0000-4000-8000-000000000006',
  '78000000-0000-4000-8000-000000000007',
  '78000000-0000-4000-8000-000000000008',
  '78000000-0000-4000-8000-000000000009'
);

select throws_ok(
  $$ select * from public.issue_membership_invitation(
    '88000000-0000-4000-8000-000000000003',
    '78000000-0000-4000-8000-000000000006',
    '89000000-0000-4000-8000-000000000001',
    'member-must-not-invite@example.test',
    repeat('a', 64),
    1,
    now() + interval '1 day',
    '99000000-0000-4000-8000-000000000001',
    '99000000-0000-4000-8000-000000000002'
  ) $$,
  'P0003',
  'actor_not_authorized',
  'ordinary members cannot issue invitations'
);

select throws_ok(
  $$ select * from public.issue_membership_invitation(
    '88000000-0000-4000-8000-000000000002',
    '78000000-0000-4000-8000-000000000009',
    '89000000-0000-4000-8000-000000000002',
    'cross-group@example.test',
    repeat('b', 64),
    1,
    now() + interval '1 day',
    '99000000-0000-4000-8000-000000000003',
    '99000000-0000-4000-8000-000000000004'
  ) $$,
  'P0002',
  'invitation_target_unavailable',
  'an actor cannot target another group'
);

select throws_ok(
  $$ select * from public.issue_membership_invitation(
    '88000000-0000-4000-8000-000000000001',
    '78000000-0000-4000-8000-000000000007',
    '89000000-0000-4000-8000-000000000020',
    'pending-elevated-role@example.test',
    repeat('9', 64),
    1,
    now() + interval '1 day',
    '99000000-0000-4000-8000-000000000022',
    '99000000-0000-4000-8000-000000000023'
  ) $$,
  'P0002',
  'invitation_target_unavailable',
  'member invitation issuance cannot activate a pending elevated role'
);

select throws_ok(
  $$ select * from public.issue_membership_invitation(
    '88000000-0000-4000-8000-000000000002',
    '78000000-0000-4000-8000-000000000006',
    '89000000-0000-4000-8000-000000000003',
    'not-an-email',
    repeat('c', 64),
    1,
    now() + interval '1 day',
    '99000000-0000-4000-8000-000000000005',
    '99000000-0000-4000-8000-000000000006'
  ) $$,
  '22023',
  'invitation_email_invalid',
  'invalid invitation email is rejected before writes'
);

select throws_ok(
  $$ select * from public.issue_membership_invitation(
    '88000000-0000-4000-8000-000000000002',
    '78000000-0000-4000-8000-000000000006',
    '89000000-0000-4000-8000-000000000004',
    'future-invalid@example.test',
    repeat('d', 64),
    1,
    now() - interval '1 second',
    '99000000-0000-4000-8000-000000000007',
    '99000000-0000-4000-8000-000000000008'
  ) $$,
  '22023',
  'invitation_expiry_invalid',
  'non-future expiry is rejected before writes'
);

select throws_ok(
  $$ select * from public.issue_membership_invitation(
    '88000000-0000-4000-8000-000000000002',
    '78000000-0000-4000-8000-000000000006',
    '89000000-0000-4000-8000-000000000005',
    'digest-invalid@example.test',
    repeat('e', 63),
    1,
    now() + interval '1 day',
    '99000000-0000-4000-8000-000000000009',
    '99000000-0000-4000-8000-000000000010'
  ) $$,
  '22023',
  'invitation_token_digest_invalid',
  'invalid token digest is rejected before writes'
);

create temporary table first_invitation as
select * from public.issue_membership_invitation(
  '88000000-0000-4000-8000-000000000002',
  '78000000-0000-4000-8000-000000000006',
  '89000000-0000-4000-8000-000000000006',
  '  Invitee.One@Example.test ',
  repeat('f', 64),
  1,
  now() + interval '1 day',
  '99000000-0000-4000-8000-000000000011',
  '99000000-0000-4000-8000-000000000012'
);

select is(
  (select issued_group_id from first_invitation),
  '98000000-0000-4000-8000-000000000001'::app.entity_id,
  'successful issuance derives the actor group'
);
select is(
  (select invited_email from first_invitation),
  'Invitee.One@Example.test'::text,
  'display email is outer-trimmed and retained'
);
select is(
  (select invited_email_normalized from first_invitation),
  'invitee.one@example.test'::text,
  'matching email is normalized'
);
select is(
  (select role from first_invitation),
  'member'::public.membership_role,
  'proposed role is derived from membership'
);
select is(
  (select status from first_invitation),
  'pending'::public.membership_invitation_status,
  'new invitation is pending'
);
select is(
  (select state from public.notification_outbox_jobs where id = (select queued_outbox_id from first_invitation)),
  'queued'::public.notification_outbox_job_state,
  'business event commits a queued outbox job'
);
select is(
  (select state from public.notification_deliveries where id = (select queued_delivery_id from first_invitation)),
  'queued'::public.notification_delivery_state,
  'business event commits a queued email delivery'
);
select is(
  (select channel from public.notification_deliveries where id = (select queued_delivery_id from first_invitation)),
  'email'::public.notification_channel,
  'invitation delivery is email-only'
);
select ok(
  (select invited_at is not null from public.memberships where id = '78000000-0000-4000-8000-000000000006'),
  'membership records its invitation time'
);
select ok(
  not exists (
    select 1
    from public.audit_events
    where action = 'membership.invitation_issued'
      and (
        after_state ? 'invited_email'
        or after_state ? 'invited_email_normalized'
        or after_state ? 'invited_email_hash'
        or after_state ? 'token_digest_sha256'
      )
  ),
  'audit state excludes private email and token material'
);
select ok(
  (select safe_error is null from public.notification_outbox_jobs where id = (select queued_outbox_id from first_invitation)),
  'new outbox job has no provider error or private payload'
);

select is(
  (select count(*) from public.membership_invitations where membership_id = '78000000-0000-4000-8000-000000000006'),
  1::bigint,
  'one invitation exists for the target membership'
);
select is(
  (select count(*) from public.notification_outbox_jobs where group_id = '98000000-0000-4000-8000-000000000001'),
  1::bigint,
  'one outbox job exists for the issuance'
);
select is(
  (select count(*) from public.notification_deliveries where outbox_job_id = (select queued_outbox_id from first_invitation)),
  1::bigint,
  'one delivery exists for the issuance'
);

select throws_ok(
  $$ select * from public.issue_membership_invitation(
    '88000000-0000-4000-8000-000000000002',
    '78000000-0000-4000-8000-000000000006',
    '89000000-0000-4000-8000-000000000007',
    'other@example.test',
    repeat('1', 64),
    1,
    now() + interval '1 day',
    '99000000-0000-4000-8000-000000000013',
    '99000000-0000-4000-8000-000000000014'
  ) $$,
  '23505',
  'invitation_already_pending',
  'a membership cannot receive two current invitations'
);

select throws_ok(
  $$ select * from public.issue_membership_invitation(
    '88000000-0000-4000-8000-000000000001',
    '78000000-0000-4000-8000-000000000008',
    '89000000-0000-4000-8000-000000000008',
    ' INVITEE.ONE@example.test ',
    repeat('2', 64),
    1,
    now() + interval '1 day',
    '99000000-0000-4000-8000-000000000015',
    '99000000-0000-4000-8000-000000000016'
  ) $$,
  '23505',
  'invitation_email_in_use',
  'a normalized email cannot be invited twice in one group'
);

select throws_ok(
  $$ select * from public.issue_membership_invitation(
    '88000000-0000-4000-8000-000000000001',
    '78000000-0000-4000-8000-000000000008',
    '89000000-0000-4000-8000-000000000009',
    ' attached-member-a@example.test ',
    repeat('3', 64),
    1,
    now() + interval '1 day',
    '99000000-0000-4000-8000-000000000017',
    '99000000-0000-4000-8000-000000000018'
  ) $$,
  '23505',
  'invitation_email_in_use',
  'an attached member email cannot be invited again in the group'
);

create temporary table retried_invitation as
select * from public.issue_membership_invitation(
  '88000000-0000-4000-8000-000000000002',
  '78000000-0000-4000-8000-000000000006',
  '89000000-0000-4000-8000-000000000010',
  ' INVITEE.ONE@EXAMPLE.TEST ',
  repeat('4', 64),
  1,
  now() + interval '2 days',
  '99000000-0000-4000-8000-000000000011',
  '99000000-0000-4000-8000-000000000012'
);

select is(
  (select issued_invitation_id from retried_invitation),
  (select issued_invitation_id from first_invitation),
  'retrying an operation with a fresh invitation UUID returns the original issuance'
);
select is(
  (select count(*) from public.membership_invitations where membership_id = '78000000-0000-4000-8000-000000000006'),
  1::bigint,
  'idempotent retry does not create a second invitation'
);
select is(
  (select count(*) from public.notification_outbox_jobs where group_id = '98000000-0000-4000-8000-000000000001'),
  1::bigint,
  'idempotent retry does not create another outbox job'
);

select throws_ok(
  $$ select * from public.issue_membership_invitation(
    '88000000-0000-4000-8000-000000000002',
    '78000000-0000-4000-8000-000000000006',
    '89000000-0000-4000-8000-000000000011',
    'operation-reuse@example.test',
    repeat('5', 64),
    1,
    now() + interval '1 day',
    '99000000-0000-4000-8000-000000000019',
    '99000000-0000-4000-8000-000000000012'
  ) $$,
  '23505',
  'operation_id_reused',
  'one operation id cannot change the normalized invited email'
);

update public.memberships
set role = 'member'
where id = '78000000-0000-4000-8000-000000000002';

select throws_ok(
  $$ select * from public.issue_membership_invitation(
    '88000000-0000-4000-8000-000000000002',
    '78000000-0000-4000-8000-000000000007',
    '89000000-0000-4000-8000-000000000012',
    'revoked-actor@example.test',
    repeat('6', 64),
    1,
    now() + interval '1 day',
    '99000000-0000-4000-8000-000000000020',
    '99000000-0000-4000-8000-000000000021'
  ) $$,
  'P0003',
  'actor_not_authorized',
  'a role-revoked actor cannot issue invitations'
);

select is(
  (select count(*) from public.membership_invitations),
  1::bigint,
  'all invalid, duplicate, and unauthorized calls leave state unchanged'
);
select is(
  (select count(*) from public.notification_deliveries),
  1::bigint,
  'failed issuance attempts leave no delivery rows'
);

select throws_ok(
  $$ insert into public.notification_outbox_jobs (
    group_id, event_type, aggregate_type, aggregate_id, aggregate_version,
    idempotency_key
  ) values (
    '98000000-0000-4000-8000-000000000001', 'membership.invitation',
    'membership_invitation', '89000000-0000-4000-8000-000000000006', 1,
    'membership.invitation:' || (select issued_invitation_id::text from first_invitation)
  ) $$,
  '23505',
  null,
  'outbox idempotency key is unique'
);

select throws_ok(
  $$ insert into public.notification_deliveries (
    group_id, outbox_job_id, recipient_membership_id, recipient_address,
    recipient_address_normalized, channel
  ) values (
    '98000000-0000-4000-8000-000000000001',
    (select queued_outbox_id from first_invitation),
    '78000000-0000-4000-8000-000000000006',
    'different@example.test', 'different@example.test', 'email'
  ) $$,
  '23505',
  null,
  'delivery is unique per event, recipient, and channel'
);

select * from finish();

rollback;
