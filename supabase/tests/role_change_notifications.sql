begin;

create extension if not exists pgtap with schema extensions;

select plan(59);

select ok(not has_function_privilege('anon', 'public.change_member_role(uuid,uuid,public.membership_role,bigint,boolean,text,uuid,uuid)', 'execute'), 'anonymous cannot change roles');
select ok(not has_function_privilege('authenticated', 'public.change_member_role(uuid,uuid,public.membership_role,bigint,boolean,text,uuid,uuid)', 'execute'), 'authenticated clients cannot bypass the role boundary');
select ok(has_function_privilege('service_role', 'public.change_member_role(uuid,uuid,public.membership_role,bigint,boolean,text,uuid,uuid)', 'execute'), 'service role can execute role changes');
select ok(not has_table_privilege('authenticated', 'public.membership_role_change_notifications', 'select'), 'role notification payloads are not client-readable');
select ok(not has_table_privilege('service_role', 'public.membership_role_change_notifications', 'insert,update,delete,truncate,references,trigger'), 'service role can inspect but cannot mutate or truncate role payloads');
select ok(
  not has_table_privilege('service_role', 'public.membership_invitations', 'insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('service_role', 'public.notification_outbox_jobs', 'insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('service_role', 'public.notification_deliveries', 'insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('service_role', 'public.email_suppressions', 'insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('service_role', 'public.notification_provider_events', 'insert,update,delete,truncate,references,trigger'),
  'service role can inspect but cannot directly mutate the email delivery foundation'
);

insert into auth.users (id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at)
values
  ('15000000-0000-4000-8000-000000000001', 'role-admin-a@example.test', now(), false, false, now(), now()),
  ('15000000-0000-4000-8000-000000000002', 'role-admin-b@example.test', now(), false, false, now(), now()),
  ('15000000-0000-4000-8000-000000000003', 'role-coordinator@example.test', now(), false, false, now(), now()),
  ('15000000-0000-4000-8000-000000000004', 'role-member@example.test', now(), false, false, now(), now()),
  ('15000000-0000-4000-8000-000000000005', 'role-inactive@example.test', now(), false, false, now(), now()),
  ('15000000-0000-4000-8000-000000000006', 'other-admin@example.test', now(), false, false, now(), now()),
  ('15000000-0000-4000-8000-000000000007', 'transfer-admin@example.test', now(), false, false, now(), now()),
  ('15000000-0000-4000-8000-000000000008', 'transfer-replacement@example.test', now(), false, false, now(), now()),
  ('15000000-0000-4000-8000-000000000009', 'role-unverified@example.test', null, false, false, now(), now()),
  ('15000000-0000-4000-8000-000000000010', 'role-ordered@example.test', now(), false, false, now(), now());

insert into public.user_profiles (user_id)
select id from auth.users where id::text like '15000000-0000-4000-8000-%';

insert into public.groups (id, name, time_zone)
values
  ('55000000-0000-4000-8000-000000000001', 'Role Group', 'UTC'),
  ('55000000-0000-4000-8000-000000000002', 'Other Group', 'UTC'),
  ('55000000-0000-4000-8000-000000000003', 'Transfer Group', 'UTC');

insert into public.memberships (id, group_id, user_id, role, status, activated_at, inactivated_at)
values
  ('65000000-0000-4000-8000-000000000001', '55000000-0000-4000-8000-000000000001', '15000000-0000-4000-8000-000000000001', 'administrator', 'active', now(), null),
  ('65000000-0000-4000-8000-000000000002', '55000000-0000-4000-8000-000000000001', '15000000-0000-4000-8000-000000000002', 'administrator', 'active', now(), null),
  ('65000000-0000-4000-8000-000000000003', '55000000-0000-4000-8000-000000000001', '15000000-0000-4000-8000-000000000003', 'coordinator', 'active', now(), null),
  ('65000000-0000-4000-8000-000000000004', '55000000-0000-4000-8000-000000000001', '15000000-0000-4000-8000-000000000004', 'member', 'active', now(), null),
  ('65000000-0000-4000-8000-000000000005', '55000000-0000-4000-8000-000000000001', '15000000-0000-4000-8000-000000000005', 'member', 'inactive', now(), now()),
  ('65000000-0000-4000-8000-000000000006', '55000000-0000-4000-8000-000000000002', '15000000-0000-4000-8000-000000000006', 'administrator', 'active', now(), null),
  ('65000000-0000-4000-8000-000000000007', '55000000-0000-4000-8000-000000000003', '15000000-0000-4000-8000-000000000007', 'administrator', 'active', now(), null),
  ('65000000-0000-4000-8000-000000000008', '55000000-0000-4000-8000-000000000003', '15000000-0000-4000-8000-000000000008', 'coordinator', 'active', now(), null),
  ('65000000-0000-4000-8000-000000000009', '55000000-0000-4000-8000-000000000001', '15000000-0000-4000-8000-000000000009', 'member', 'active', now(), null),
  ('65000000-0000-4000-8000-000000000010', '55000000-0000-4000-8000-000000000001', null, 'member', 'pending', null, null),
  ('65000000-0000-4000-8000-000000000011', '55000000-0000-4000-8000-000000000001', '15000000-0000-4000-8000-000000000010', 'member', 'active', now(), null);

select throws_ok(
  $$ select * from public.change_member_role('15000000-0000-4000-8000-000000000003','65000000-0000-4000-8000-000000000004','coordinator',1,true,'Coordinator attempt','25000000-0000-4000-8000-000000000001','35000000-0000-4000-8000-000000000001') $$,
  'P0003', 'actor_not_authorized', 'coordinators cannot grant roles'
);
select throws_ok(
  $$ select * from public.change_member_role('15000000-0000-4000-8000-000000000001','65000000-0000-4000-8000-000000000006','coordinator',1,true,'Guessed target','25000000-0000-4000-8000-000000000002','35000000-0000-4000-8000-000000000002') $$,
  'P0002', 'member_not_found', 'cross-group targets remain unavailable'
);
select throws_ok(
  $$ select * from public.change_member_role('15000000-0000-4000-8000-000000000001','65000000-0000-4000-8000-000000000004','coordinator',1,false,'Not confirmed','25000000-0000-4000-8000-000000000003','35000000-0000-4000-8000-000000000003') $$,
  '22023', 'member_role_confirmation_required', 'role changes require explicit confirmation'
);
select throws_ok(
  $$ select * from public.change_member_role('15000000-0000-4000-8000-000000000001','65000000-0000-4000-8000-000000000005','coordinator',1,true,'Inactive target','25000000-0000-4000-8000-000000000004','35000000-0000-4000-8000-000000000004') $$,
  'P0002', 'member_not_found', 'inactive targets cannot receive roles'
);
select throws_ok(
  $$ select * from public.change_member_role('15000000-0000-4000-8000-000000000001','65000000-0000-4000-8000-000000000009','coordinator',1,true,'Unverified target','25000000-0000-4000-8000-000000000011','35000000-0000-4000-8000-000000000011') $$,
  'P0002', 'member_not_found', 'unverified identities cannot receive roles'
);
select throws_ok(
  $$ select * from public.change_member_role('15000000-0000-4000-8000-000000000001','65000000-0000-4000-8000-000000000010','coordinator',1,true,'Pending target','25000000-0000-4000-8000-000000000012','35000000-0000-4000-8000-000000000012') $$,
  'P0002', 'member_not_found', 'pending memberships cannot receive roles'
);

select lives_ok(
  $$ select * from public.change_member_role('15000000-0000-4000-8000-000000000001','65000000-0000-4000-8000-000000000004','coordinator',1,true,'Grant coordinator','25000000-0000-4000-8000-000000000005','35000000-0000-4000-8000-000000000005') $$,
  'an administrator can grant coordinator access'
);
select is((select role from public.memberships where id = '65000000-0000-4000-8000-000000000004'), 'coordinator'::public.membership_role, 'the new role is authoritative immediately');
select is((select version from public.memberships where id = '65000000-0000-4000-8000-000000000004'), 2::bigint, 'the membership version advances once');
select is((select count(*) from public.audit_events where operation_id = '35000000-0000-4000-8000-000000000005'), 1::bigint, 'one role audit event is written');
select is((select reason from public.audit_events where operation_id = '35000000-0000-4000-8000-000000000005'), 'Grant coordinator', 'the required reason is retained');
select ok(pg_catalog.strpos((select before_state::text || after_state::text from public.audit_events where operation_id = '35000000-0000-4000-8000-000000000005'), '@') = 0, 'audit state contains no notification address');
select is((select count(*) from public.notification_outbox_jobs where group_id = '55000000-0000-4000-8000-000000000001' and event_type = 'membership.role_changed'), 1::bigint, 'one role outbox job is queued');
select is((select count(*) from public.notification_deliveries where group_id = '55000000-0000-4000-8000-000000000001'), 1::bigint, 'one role e-mail delivery is queued');
select is((select recipient_address from public.notification_deliveries where group_id = '55000000-0000-4000-8000-000000000001'), 'role-member@example.test', 'the verified account e-mail is used');
select is((select old_role::text || '>' || new_role::text from public.membership_role_change_notifications where group_id = '55000000-0000-4000-8000-000000000001'), 'member>coordinator', 'the durable payload records only the role transition');

select set_config('request.jwt.claim.sub', '15000000-0000-4000-8000-000000000004', true);
set local role authenticated;
select is((select role from public.resolve_identity_context()), 'coordinator'::public.membership_role, 'the next authenticated authorization read sees the granted role');
reset role;

select lives_ok(
  $$ select * from public.change_member_role('15000000-0000-4000-8000-000000000001','65000000-0000-4000-8000-000000000004','coordinator',1,true,'Grant coordinator','25000000-0000-4000-8000-000000000005','35000000-0000-4000-8000-000000000005') $$,
  'an identical operation retry reconciles the original success'
);
select is((select count(*) from public.audit_events where operation_id = '35000000-0000-4000-8000-000000000005'), 1::bigint, 'a retry does not duplicate audit');
select is((select count(*) from public.notification_deliveries where group_id = '55000000-0000-4000-8000-000000000001'), 1::bigint, 'a retry does not duplicate delivery');
select throws_ok(
  $$ select * from public.change_member_role('15000000-0000-4000-8000-000000000001','65000000-0000-4000-8000-000000000004','coordinator',1,true,'Changed retry','25000000-0000-4000-8000-000000000005','35000000-0000-4000-8000-000000000005') $$,
  '23505', 'operation_id_reused', 'an operation id cannot be reused with another payload'
);
select throws_ok(
  $$ select * from public.change_member_role('15000000-0000-4000-8000-000000000001','65000000-0000-4000-8000-000000000004','coordinator',2,true,'No change','25000000-0000-4000-8000-000000000006','35000000-0000-4000-8000-000000000006') $$,
  '22023', 'member_role_transition_forbidden', 'same-role operations are rejected'
);
select throws_ok(
  $$ select * from public.change_member_role('15000000-0000-4000-8000-000000000001','65000000-0000-4000-8000-000000000004','member',1,true,'Stale revoke','25000000-0000-4000-8000-000000000007','35000000-0000-4000-8000-000000000007') $$,
  '40001', 'member_membership_version_changed', 'stale role writes are rejected'
);
select throws_ok(
  $$ select * from public.change_member_role('15000000-0000-4000-8000-000000000006','65000000-0000-4000-8000-000000000006','coordinator',1,true,'Remove last admin','25000000-0000-4000-8000-000000000008','35000000-0000-4000-8000-000000000008') $$,
  'P0001', 'last_active_administrator', 'the last active administrator cannot be demoted'
);

update auth.users set email = 'role-member-current@example.test' where id = '15000000-0000-4000-8000-000000000004';
create temporary table claimed_role_email as
select * from public.claim_membership_role_change_email('45000000-0000-4000-8000-000000000001', now() - interval '90 seconds');
select is((select count(*) from claimed_role_email), 1::bigint, 'one due role e-mail is claimed');
select is((select recipient_address from claimed_role_email), 'role-member-current@example.test', 'claiming re-resolves the current account e-mail');
select is((select state from public.notification_deliveries where id = (select delivery_id from claimed_role_email)), 'sending'::public.notification_delivery_state, 'claiming records the sending state atomically');
update public.notification_deliveries
set claimed_at = now() - interval '2 minutes'
where id = (select delivery_id from claimed_role_email);
update public.notification_outbox_jobs
set claimed_at = now() - interval '2 minutes'
where id = (select outbox_job_id from claimed_role_email);
create temporary table reclaimed_role_email as
select * from public.claim_membership_role_change_email('45000000-0000-4000-8000-000000000003', now() - interval '90 seconds');
select is((select count(*) from reclaimed_role_email), 1::bigint, 'an expired worker claim becomes eligible again');
select is((select delivery_id from reclaimed_role_email), (select delivery_id from claimed_role_email), 'claim recovery preserves delivery idempotency');
select is((select attempt_number from reclaimed_role_email), 2, 'claim recovery advances the durable attempt count');
do $$
begin
  perform * from public.record_email_send_success(
    (select delivery_id from reclaimed_role_email),
    '45000000-0000-4000-8000-000000000003',
    'role-test-provider-message'
  );
end;
$$;

select lives_ok(
  $$ select * from public.change_member_role('15000000-0000-4000-8000-000000000001','65000000-0000-4000-8000-000000000003','member',1,true,'Revoke coordinator','25000000-0000-4000-8000-000000000009','35000000-0000-4000-8000-000000000009') $$,
  'a coordinator role can be revoked'
);
update public.user_profiles set disabled_at = now() where user_id = '15000000-0000-4000-8000-000000000003';
select is((select count(*) from public.claim_membership_role_change_email('45000000-0000-4000-8000-000000000002', now() - interval '90 seconds')), 0::bigint, 'unavailable identities are excluded at send time');
select is((select count(*) from public.notification_deliveries where recipient_membership_id = '65000000-0000-4000-8000-000000000003' and state = 'cancelled'), 1::bigint, 'unavailable recipient work is cancelled explicitly');

select lives_ok(
  $$ select * from public.change_member_role('15000000-0000-4000-8000-000000000001','65000000-0000-4000-8000-000000000011','coordinator',1,true,'Ordered grant','25000000-0000-4000-8000-000000000014','35000000-0000-4000-8000-000000000014') $$,
  'an ordered test member can receive a role grant'
);
select lives_ok(
  $$ select * from public.change_member_role('15000000-0000-4000-8000-000000000002','65000000-0000-4000-8000-000000000011','member',2,true,'Ordered revoke','25000000-0000-4000-8000-000000000015','35000000-0000-4000-8000-000000000014') $$,
  'a second administrator can reuse an operation UUID without suppressing a later role event'
);
select is((select count(*) from public.notification_deliveries where recipient_membership_id = '65000000-0000-4000-8000-000000000011'), 2::bigint, 'actor-scoped role event keys preserve both mandatory deliveries');
update public.notification_deliveries as delivery
set next_attempt_at = now() + interval '1 hour'
from public.notification_outbox_jobs as outbox
where delivery.outbox_job_id = outbox.id
  and outbox.aggregate_id = '65000000-0000-4000-8000-000000000011'
  and outbox.aggregate_version = 2;
update public.notification_outbox_jobs
set next_attempt_at = now() + interval '1 hour'
where aggregate_id = '65000000-0000-4000-8000-000000000011'
  and aggregate_version = 2;
select is((select count(*) from public.claim_membership_role_change_email('45000000-0000-4000-8000-000000000004', now() - interval '90 seconds')), 0::bigint, 'a newer reversal cannot overtake an older delayed role e-mail');
update public.notification_deliveries as delivery
set next_attempt_at = now()
from public.notification_outbox_jobs as outbox
where delivery.outbox_job_id = outbox.id
  and outbox.aggregate_id = '65000000-0000-4000-8000-000000000011'
  and outbox.aggregate_version = 2;
update public.notification_outbox_jobs
set next_attempt_at = now()
where aggregate_id = '65000000-0000-4000-8000-000000000011'
  and aggregate_version = 2;
select is((select old_role::text || '>' || new_role::text from public.claim_membership_role_change_email('45000000-0000-4000-8000-000000000005', now() - interval '90 seconds')), 'member>coordinator', 'the oldest nonterminal role event is claimed first');

select lives_ok(
  $$ select * from public.change_member_role('15000000-0000-4000-8000-000000000001','65000000-0000-4000-8000-000000000001','coordinator',1,true,'Step down','25000000-0000-4000-8000-000000000013','35000000-0000-4000-8000-000000000013') $$,
  'an administrator can step down when another active administrator remains'
);
select is((select role from public.memberships where id = '65000000-0000-4000-8000-000000000001'), 'coordinator'::public.membership_role, 'self-demotion changes authorization immediately');
select lives_ok(
  $$ select * from public.change_member_role('15000000-0000-4000-8000-000000000001','65000000-0000-4000-8000-000000000001','coordinator',1,true,'Step down','25000000-0000-4000-8000-000000000013','35000000-0000-4000-8000-000000000013') $$,
  'a self-demoted actor can reconcile the accepted operation'
);
select is((select count(*) from public.audit_events where operation_id = '35000000-0000-4000-8000-000000000013'), 1::bigint, 'self-demotion retry has one audit event');

select lives_ok(
  $$ select * from public.change_member_role('15000000-0000-4000-8000-000000000007','65000000-0000-4000-8000-000000000008','member',1,true,'Prepare transfer','25000000-0000-4000-8000-000000000016','35000000-0000-4000-8000-000000000016') $$,
  'a direct role change can precede an administrator transfer'
);
update public.notification_deliveries as delivery
set next_attempt_at = now() + interval '1 hour'
from public.notification_outbox_jobs as outbox
where delivery.outbox_job_id = outbox.id
  and outbox.aggregate_id = '65000000-0000-4000-8000-000000000008'
  and outbox.aggregate_version = 2;
update public.notification_outbox_jobs
set next_attempt_at = now() + interval '1 hour'
where aggregate_id = '65000000-0000-4000-8000-000000000008'
  and aggregate_version = 2;

select lives_ok(
  $$ select * from public.transfer_group_administrator('15000000-0000-4000-8000-000000000007','65000000-0000-4000-8000-000000000008',1,true,'Transfer ownership','25000000-0000-4000-8000-000000000010','35000000-0000-4000-8000-000000000010') $$,
  'administrator transfer queues its role notifications atomically'
);
select is((select role::text from public.memberships where id = '65000000-0000-4000-8000-000000000007') || '>' || (select role::text from public.memberships where id = '65000000-0000-4000-8000-000000000008'), 'coordinator>administrator', 'transfer commits both role changes');
select is((select version from public.memberships where id = '65000000-0000-4000-8000-000000000008'), 3::bigint, 'the membership version trigger advances transfer role changes for ordering and optimistic concurrency');
select is((select count(*) from public.audit_events where operation_id = '35000000-0000-4000-8000-000000000010'), 1::bigint, 'transfer retains one atomic audit event');
select is((select count(*) from public.notification_outbox_jobs where group_id = '55000000-0000-4000-8000-000000000003'), 3::bigint, 'transfer adds one job for each changed membership');
select is((select count(*) from public.notification_deliveries where group_id = '55000000-0000-4000-8000-000000000003'), 3::bigint, 'transfer adds two affected-member deliveries');
select is((select count(*) from public.membership_role_change_notifications where group_id = '55000000-0000-4000-8000-000000000003'), 3::bigint, 'transfer stores both safe transition payloads after the prior event');
update public.notification_deliveries as delivery
set next_attempt_at = now() + interval '2 hours'
from public.notification_outbox_jobs as outbox
where delivery.outbox_job_id = outbox.id
  and outbox.aggregate_id = '65000000-0000-4000-8000-000000000007';
update public.notification_outbox_jobs
set next_attempt_at = now() + interval '2 hours'
where aggregate_id = '65000000-0000-4000-8000-000000000007';
create temporary table transfer_order_claim as
select * from public.claim_membership_role_change_email('45000000-0000-4000-8000-000000000006', now() - interval '90 seconds');
select is((select count(*) from transfer_order_claim where membership_id = '65000000-0000-4000-8000-000000000008'), 0::bigint, 'a transfer role e-mail cannot overtake an older delayed direct-change e-mail');
select lives_ok(
  $$ select * from public.transfer_group_administrator('15000000-0000-4000-8000-000000000007','65000000-0000-4000-8000-000000000008',1,true,'Transfer ownership','25000000-0000-4000-8000-000000000010','35000000-0000-4000-8000-000000000010') $$,
  'a transfer retry reconciles after the actor demotion'
);
select is((select count(*) from public.notification_outbox_jobs where group_id = '55000000-0000-4000-8000-000000000003'), 3::bigint, 'a transfer retry does not duplicate role jobs');

select * from finish();
rollback;
