begin;

create extension if not exists pgtap with schema extensions;

select plan(28);

select ok(
  not has_function_privilege(
    'anon',
    'public.transfer_group_administrator(uuid,uuid,bigint,boolean,text,uuid,uuid)',
    'execute'
  ),
  'anonymous clients cannot transfer administrator access'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.transfer_group_administrator(uuid,uuid,bigint,boolean,text,uuid,uuid)',
    'execute'
  ),
  'authenticated clients cannot bypass the trusted role-transfer server boundary'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.transfer_group_administrator(uuid,uuid,bigint,boolean,text,uuid,uuid)',
    'execute'
  ),
  'the trusted server can execute administrator transfer'
);

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at
)
values
  ('13000000-0000-4000-8000-000000000001', 'transfer-admin@example.test', now(), false, false, now(), now()),
  ('13000000-0000-4000-8000-000000000002', 'transfer-replacement@example.test', now(), false, false, now(), now()),
  ('13000000-0000-4000-8000-000000000003', 'transfer-other-group@example.test', now(), false, false, now(), now()),
  ('13000000-0000-4000-8000-000000000004', 'transfer-inactive@example.test', now(), false, false, now(), now()),
  ('13000000-0000-4000-8000-000000000005', 'transfer-coordinator@example.test', now(), false, false, now(), now());

insert into public.user_profiles (user_id)
values
  ('13000000-0000-4000-8000-000000000001'),
  ('13000000-0000-4000-8000-000000000002'),
  ('13000000-0000-4000-8000-000000000003'),
  ('13000000-0000-4000-8000-000000000004'),
  ('13000000-0000-4000-8000-000000000005');

insert into public.groups (id, name, time_zone)
values
  ('53000000-0000-4000-8000-000000000001', 'Transfer Group', 'UTC'),
  ('53000000-0000-4000-8000-000000000002', 'Other Transfer Group', 'UTC');

insert into public.memberships (
  id, group_id, user_id, role, status, activated_at, inactivated_at
)
values
  ('63000000-0000-4000-8000-000000000001', '53000000-0000-4000-8000-000000000001', '13000000-0000-4000-8000-000000000001', 'administrator', 'active', now(), null),
  ('63000000-0000-4000-8000-000000000002', '53000000-0000-4000-8000-000000000001', '13000000-0000-4000-8000-000000000002', 'member', 'active', now(), null),
  ('63000000-0000-4000-8000-000000000003', '53000000-0000-4000-8000-000000000002', '13000000-0000-4000-8000-000000000003', 'member', 'active', now(), null),
  ('63000000-0000-4000-8000-000000000004', '53000000-0000-4000-8000-000000000001', '13000000-0000-4000-8000-000000000004', 'member', 'inactive', null, now()),
  ('63000000-0000-4000-8000-000000000005', '53000000-0000-4000-8000-000000000001', '13000000-0000-4000-8000-000000000005', 'coordinator', 'active', now(), null);

select throws_ok(
  $$
    select * from public.transfer_group_administrator(
      '13000000-0000-4000-8000-000000000001',
      '63000000-0000-4000-8000-000000000002',
      1, false, 'Transfer ownership',
      '23000000-0000-4000-8000-000000000001',
      '33000000-0000-4000-8000-000000000001'
    )
  $$,
  '22023',
  'transfer_confirmation_required',
  'administrator transfer requires explicit confirmation'
);
select throws_ok(
  $$
    select * from public.transfer_group_administrator(
      '13000000-0000-4000-8000-000000000001',
      '63000000-0000-4000-8000-000000000002',
      1, true, '   ',
      '23000000-0000-4000-8000-000000000002',
      '33000000-0000-4000-8000-000000000002'
    )
  $$,
  '22023',
  'transfer_confirmation_required',
  'administrator transfer requires a reason'
);
select throws_ok(
  $$
    select * from public.transfer_group_administrator(
      '13000000-0000-4000-8000-000000000001',
      '63000000-0000-4000-8000-000000000003',
      1, true, 'Cross-group guess',
      '23000000-0000-4000-8000-000000000003',
      '33000000-0000-4000-8000-000000000003'
    )
  $$,
  'P0002',
  'replacement_unavailable',
  'a guessed cross-group replacement is neutrally unavailable'
);
select throws_ok(
  $$
    select * from public.transfer_group_administrator(
      '13000000-0000-4000-8000-000000000001',
      '63000000-0000-4000-8000-000000000004',
      1, true, 'Inactive replacement',
      '23000000-0000-4000-8000-000000000004',
      '33000000-0000-4000-8000-000000000004'
    )
  $$,
  'P0002',
  'replacement_unavailable',
  'an inactive replacement cannot receive administrator access'
);
select throws_ok(
  $$
    select * from public.transfer_group_administrator(
      '13000000-0000-4000-8000-000000000001',
      '63000000-0000-4000-8000-000000000002',
      2, true, 'Stale screen',
      '23000000-0000-4000-8000-000000000005',
      '33000000-0000-4000-8000-000000000005'
    )
  $$,
  '40001',
  'group_version_changed',
  'a stale group version is rejected before any role changes'
);
select is(
  (select count(*) from public.audit_events where action = 'membership.administrator_transferred'),
  0::bigint,
  'rejected transfers write no audit event'
);
select is(
  (select role from public.memberships where id = '63000000-0000-4000-8000-000000000001'),
  'administrator'::public.membership_role,
  'rejected transfers leave the actor role unchanged'
);
select is(
  (select role from public.memberships where id = '63000000-0000-4000-8000-000000000002'),
  'member'::public.membership_role,
  'rejected transfers leave the replacement role unchanged'
);

create temporary table transfer_result as
select * from public.transfer_group_administrator(
  '13000000-0000-4000-8000-000000000001',
  '63000000-0000-4000-8000-000000000002',
  1, true, '  Planned ownership handoff  ',
  '23000000-0000-4000-8000-000000000006',
  '33000000-0000-4000-8000-000000000006'
);

select is((select transferred_group_id::uuid from transfer_result), '53000000-0000-4000-8000-000000000001'::uuid, 'the result identifies the actor-derived group');
select is((select group_version from transfer_result), 2::bigint, 'the result confirms the new group version');
select is((select previous_administrator_role from transfer_result), 'coordinator'::public.membership_role, 'the prior administrator becomes a coordinator');
select is((select replacement_role from transfer_result), 'administrator'::public.membership_role, 'the accepted replacement becomes administrator');
select is((select version from public.groups where id = '53000000-0000-4000-8000-000000000001'), 2::bigint, 'the authoritative group version advances once');
select is((select role from public.memberships where id = '63000000-0000-4000-8000-000000000001'), 'coordinator'::public.membership_role, 'the actor role commits');
select is((select role from public.memberships where id = '63000000-0000-4000-8000-000000000002'), 'administrator'::public.membership_role, 'the replacement role commits');
select is((select count(*) from public.audit_events where action = 'membership.administrator_transferred'), 1::bigint, 'the transfer writes exactly one audit event');
select is((select reason from public.audit_events where action = 'membership.administrator_transferred'), 'Planned ownership handoff'::text, 'the audit stores the normalized required reason');
select is((select correlation_id from public.audit_events where action = 'membership.administrator_transferred'), '23000000-0000-4000-8000-000000000006'::uuid, 'the request correlation reaches the audit event');
select is((select source from public.audit_events where action = 'membership.administrator_transferred'), 'portal'::text, 'the database records the authoritative mutation source');
select is((select before_state -> 'replacement' ->> 'role' from public.audit_events where action = 'membership.administrator_transferred'), 'member'::text, 'the audit retains the replacement prior role');
select is((select after_state -> 'previous_administrator' ->> 'role' from public.audit_events where action = 'membership.administrator_transferred'), 'coordinator'::text, 'the audit retains the actor resulting role');

select lives_ok(
  $$
    select * from public.transfer_group_administrator(
      '13000000-0000-4000-8000-000000000001',
      '63000000-0000-4000-8000-000000000003',
      1, true, 'Changed retry payload',
      '23000000-0000-4000-8000-000000000099',
      '33000000-0000-4000-8000-000000000006'
    )
  $$,
  'a retry reconciles the original success after the actor role changed'
);
select is((select count(*) from public.audit_events where action = 'membership.administrator_transferred'), 1::bigint, 'an idempotent retry writes no duplicate audit event');
select is((select version from public.groups where id = '53000000-0000-4000-8000-000000000001'), 2::bigint, 'an idempotent retry does not advance the group version');

select throws_ok(
  $$
    select * from public.transfer_group_administrator(
      '13000000-0000-4000-8000-000000000001',
      '63000000-0000-4000-8000-000000000005',
      2, true, 'No longer authorized',
      '23000000-0000-4000-8000-000000000007',
      '33000000-0000-4000-8000-000000000007'
    )
  $$,
  'P0003',
  'actor_not_authorized',
  'the actor role change takes effect on the next distinct mutation'
);

select * from finish();

rollback;
