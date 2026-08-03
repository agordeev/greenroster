begin;

create extension if not exists pgtap with schema extensions;

select plan(38);

select has_column('public', 'groups', 'allow_member_guests', 'groups store the guest permission');
select ok(
  not has_function_privilege('anon', 'public.read_group_guest_permission(uuid)', 'execute'),
  'anonymous clients cannot read guest permission'
);
select ok(
  not has_function_privilege('authenticated', 'public.read_group_guest_permission(uuid)', 'execute'),
  'authenticated clients cannot bypass the guest permission read boundary'
);
select ok(
  has_function_privilege('service_role', 'public.read_group_guest_permission(uuid)', 'execute'),
  'the trusted server can read guest permission'
);
select ok(
  (select prosecdef from pg_catalog.pg_proc where oid = 'public.read_group_guest_permission(uuid)'::regprocedure),
  'the guest permission read is a security definer'
);
select ok(
  has_function_privilege('service_role', 'public.update_group_guest_permission(uuid,boolean,bigint,text,uuid,uuid)', 'execute'),
  'the trusted server can update guest permission'
);
select ok(
  not has_function_privilege('anon', 'public.update_group_guest_permission(uuid,boolean,bigint,text,uuid,uuid)', 'execute'),
  'anonymous clients cannot update guest permission'
);
select ok(
  not has_function_privilege('authenticated', 'public.update_group_guest_permission(uuid,boolean,bigint,text,uuid,uuid)', 'execute'),
  'authenticated clients cannot bypass the guest permission update boundary'
);
select ok(
  (select prosecdef from pg_catalog.pg_proc where oid = 'public.update_group_guest_permission(uuid,boolean,bigint,text,uuid,uuid)'::regprocedure),
  'the guest permission update is a security definer'
);
select ok(
  not has_table_privilege('authenticated', 'public.groups', 'update'),
  'authenticated clients cannot update groups directly'
);

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at
)
values
  ('16000000-0000-4000-8000-000000000001', 'guest-admin-a@example.test', now(), false, false, now(), now()),
  ('16000000-0000-4000-8000-000000000002', 'guest-coordinator-a@example.test', now(), false, false, now(), now()),
  ('16000000-0000-4000-8000-000000000003', 'guest-member-a@example.test', now(), false, false, now(), now()),
  ('16000000-0000-4000-8000-000000000004', 'guest-admin-b@example.test', now(), false, false, now(), now()),
  ('16000000-0000-4000-8000-000000000005', 'guest-recovery-a@example.test', now(), false, false, now(), now());

insert into public.user_profiles (user_id)
values
  ('16000000-0000-4000-8000-000000000001'),
  ('16000000-0000-4000-8000-000000000002'),
  ('16000000-0000-4000-8000-000000000003'),
  ('16000000-0000-4000-8000-000000000004'),
  ('16000000-0000-4000-8000-000000000005');

insert into public.groups (id, name, time_zone)
values
  ('56000000-0000-4000-8000-000000000001', 'Guest Group A', 'UTC'),
  ('56000000-0000-4000-8000-000000000002', 'Guest Group B', 'UTC');

insert into public.memberships (id, group_id, user_id, role, status, activated_at)
values
  ('66000000-0000-4000-8000-000000000001', '56000000-0000-4000-8000-000000000001', '16000000-0000-4000-8000-000000000001', 'administrator', 'active', now()),
  ('66000000-0000-4000-8000-000000000002', '56000000-0000-4000-8000-000000000001', '16000000-0000-4000-8000-000000000002', 'coordinator', 'active', now()),
  ('66000000-0000-4000-8000-000000000003', '56000000-0000-4000-8000-000000000001', '16000000-0000-4000-8000-000000000003', 'member', 'active', now()),
  ('66000000-0000-4000-8000-000000000004', '56000000-0000-4000-8000-000000000002', '16000000-0000-4000-8000-000000000004', 'administrator', 'active', now()),
  ('66000000-0000-4000-8000-000000000005', '56000000-0000-4000-8000-000000000001', '16000000-0000-4000-8000-000000000005', 'administrator', 'active', now());

select is(
  (select allow_member_guests from public.groups where id = '56000000-0000-4000-8000-000000000001'),
  false,
  'guest permission defaults to disabled'
);

create temporary table guest_permission_read as
select * from public.read_group_guest_permission('16000000-0000-4000-8000-000000000001');
select is((select group_id::uuid from guest_permission_read), '56000000-0000-4000-8000-000000000001'::uuid, 'read resolves the actor group');
select is((select allow_member_guests from guest_permission_read), false, 'read returns the current permission');
select is((select group_version from guest_permission_read), 1::bigint, 'read returns the current group version');

create temporary table coordinator_guest_permission_read as
select * from public.read_group_guest_permission('16000000-0000-4000-8000-000000000002');
select is((select allow_member_guests from coordinator_guest_permission_read), false, 'coordinators can read the group policy');

select throws_ok(
  $$ select * from public.read_group_guest_permission('16000000-0000-4000-8000-000000000003') $$,
  'P0003', 'actor_not_authorized', 'ordinary members cannot read administrative guest settings'
);

update auth.users
set raw_app_meta_data = jsonb_build_object(
  'greenroster_password_recovery', jsonb_build_object('session_id', '46000000-0000-4000-8000-000000000001')
)
where id = '16000000-0000-4000-8000-000000000005';
select throws_ok(
  $$ select * from public.read_group_guest_permission('16000000-0000-4000-8000-000000000005') $$,
  'P0003', 'recovery_session_forbidden', 'recovery sessions cannot read guest settings'
);

select throws_ok(
  $$ select * from public.update_group_guest_permission(
    '16000000-0000-4000-8000-000000000001', null::boolean, 1, 'Invalid',
    '26000000-0000-4000-8000-000000000001', '36000000-0000-4000-8000-000000000001'
  ) $$,
  '22023', 'guest_permission_input_invalid', 'null permission input is rejected'
);
select throws_ok(
  $$ select * from public.update_group_guest_permission(
    '16000000-0000-4000-8000-000000000001', true, 1, ' ',
    '26000000-0000-4000-8000-000000000002', '36000000-0000-4000-8000-000000000002'
  ) $$,
  '22023', 'guest_permission_reason_required', 'guest permission changes require a reason'
);
select throws_ok(
  $$ select * from public.update_group_guest_permission(
    '16000000-0000-4000-8000-000000000002', true, 1, 'Coordinator attempt',
    '26000000-0000-4000-8000-000000000003', '36000000-0000-4000-8000-000000000003'
  ) $$,
  'P0003', 'actor_not_authorized', 'coordinators cannot change guest permission'
);
select throws_ok(
  $$ select * from public.update_group_guest_permission(
    '16000000-0000-4000-8000-000000000003', true, 1, 'Member attempt',
    '26000000-0000-4000-8000-000000000004', '36000000-0000-4000-8000-000000000004'
  ) $$,
  'P0003', 'actor_not_authorized', 'members cannot change guest permission'
);

create temporary table guest_permission_update as
select * from public.update_group_guest_permission(
  '16000000-0000-4000-8000-000000000001', true, 1, 'Allow member-sponsored guests',
  '26000000-0000-4000-8000-000000000005', '36000000-0000-4000-8000-000000000005'
);
select is((select updated_group_id::uuid from guest_permission_update), '56000000-0000-4000-8000-000000000001'::uuid, 'update stays on the actor group');
select is((select updated_allow_member_guests from guest_permission_update), true, 'update returns the enabled permission');
select is((select updated_group_version from guest_permission_update), 2::bigint, 'update returns the incremented group version');
select is((select allow_member_guests from public.groups where id = '56000000-0000-4000-8000-000000000001'), true, 'update persists the guest permission');
select is((select version from public.groups where id = '56000000-0000-4000-8000-000000000001'), 2::bigint, 'update advances the group version once');
select is((select count(*) from public.audit_events where action = 'group.guest_permission_updated'), 1::bigint, 'update writes one audit event');
select is((select reason from public.audit_events where action = 'group.guest_permission_updated'), 'Allow member-sponsored guests'::text, 'audit stores the normalized reason');
select is((select before_state ->> 'allow_member_guests' from public.audit_events where action = 'group.guest_permission_updated'), 'false'::text, 'audit records the prior permission');
select is((select after_state ->> 'updated_allow_member_guests' from public.audit_events where action = 'group.guest_permission_updated'), 'true'::text, 'audit records the committed permission');

create temporary table guest_permission_retry as
select * from public.update_group_guest_permission(
  '16000000-0000-4000-8000-000000000001', true, 1, 'Allow member-sponsored guests',
  '26000000-0000-4000-8000-000000000099', '36000000-0000-4000-8000-000000000005'
);
select is((select updated_allow_member_guests from guest_permission_retry), true, 'an exact retry returns the original permission');
select is((select updated_group_version from guest_permission_retry), 2::bigint, 'an exact retry returns the original version');
select is((select count(*) from public.audit_events where action = 'group.guest_permission_updated'), 1::bigint, 'an exact retry does not duplicate audit');

select throws_ok(
  $$ select * from public.update_group_guest_permission(
    '16000000-0000-4000-8000-000000000001', false, 1, 'Reuse operation',
    '26000000-0000-4000-8000-000000000099', '36000000-0000-4000-8000-000000000005'
  ) $$,
  '23505', 'operation_id_reused', 'an operation id cannot be reused with another permission'
);
select throws_ok(
  $$ select * from public.update_group_guest_permission(
    '16000000-0000-4000-8000-000000000001', false, 1, 'Stale settings',
    '26000000-0000-4000-8000-000000000100', '36000000-0000-4000-8000-000000000100'
  ) $$,
  '40001', 'group_version_changed', 'a stale group version is rejected'
);
select is((select allow_member_guests from public.groups where id = '56000000-0000-4000-8000-000000000002'), false, 'another tenant remains unchanged');

create temporary table coordinator_after_update as
select * from public.read_group_guest_permission('16000000-0000-4000-8000-000000000002');
select is((select allow_member_guests from coordinator_after_update), true, 'coordinators see the committed policy');
select ok(
  (select (app.safe_group_activity_state('group.guest_permission_updated', after_state) ? 'request_fingerprint') is false
   from public.audit_events where action = 'group.guest_permission_updated'),
  'safe activity never exposes the idempotency fingerprint'
);

select * from finish();

rollback;
