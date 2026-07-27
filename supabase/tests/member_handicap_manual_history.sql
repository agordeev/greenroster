begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

select has_table(
  'public',
  'membership_handicap_records',
  'membership handicap history remains the source table'
);
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class
   where oid = 'public.membership_handicap_records'::regclass),
  'handicap history uses force RLS'
);
select ok(
  not has_table_privilege(
    'authenticated',
    'public.membership_handicap_records',
    'select,insert,update,delete'
  ),
  'authenticated clients cannot access raw handicap history'
);
select ok(
  not has_table_privilege(
    'service_role',
    'public.membership_handicap_records',
    'select,insert,update,delete'
  ),
  'the trusted server uses only the narrow mutation boundary'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.set_member_handicap(uuid,uuid,text,app.handicap_value,date,bigint,boolean,text,uuid,uuid)',
    'execute'
  ),
  'the trusted server can append a manual handicap'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.set_member_handicap(uuid,uuid,text,app.handicap_value,date,bigint,boolean,text,uuid,uuid)',
    'execute'
  ),
  'authenticated clients cannot call the manual handicap boundary'
);

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous,
  created_at, updated_at
)
values
  ('18000000-0000-4000-8000-000000000001', 'handicap-admin-a@example.test', now(), false, false, now(), now()),
  ('18000000-0000-4000-8000-000000000002', 'handicap-coordinator-a@example.test', now(), false, false, now(), now()),
  ('18000000-0000-4000-8000-000000000003', 'handicap-member-a@example.test', now(), false, false, now(), now()),
  ('18000000-0000-4000-8000-000000000004', 'handicap-admin-b@example.test', now(), false, false, now(), now()),
  ('18000000-0000-4000-8000-000000000005', 'handicap-inactive@example.test', now(), false, false, now(), now()),
  ('18000000-0000-4000-8000-000000000006', 'handicap-disabled@example.test', now(), false, false, now(), now()),
  ('18000000-0000-4000-8000-000000000007', 'handicap-banned@example.test', now(), false, false, now(), now()),
  ('18000000-0000-4000-8000-000000000008', 'handicap-unverified@example.test', null, false, false, now(), now()),
  ('18000000-0000-4000-8000-000000000009', 'handicap-anonymous@example.test', now(), false, true, now(), now()),
  ('18000000-0000-4000-8000-000000000010', 'handicap-target-admin@example.test', now(), false, false, now(), now());

insert into public.user_profiles (user_id)
values
  ('18000000-0000-4000-8000-000000000001'),
  ('18000000-0000-4000-8000-000000000002'),
  ('18000000-0000-4000-8000-000000000003'),
  ('18000000-0000-4000-8000-000000000004'),
  ('18000000-0000-4000-8000-000000000005'),
  ('18000000-0000-4000-8000-000000000006'),
  ('18000000-0000-4000-8000-000000000007'),
  ('18000000-0000-4000-8000-000000000008'),
  ('18000000-0000-4000-8000-000000000009'),
  ('18000000-0000-4000-8000-000000000010');

update public.user_profiles
set disabled_at = now()
where user_id = '18000000-0000-4000-8000-000000000006';

update auth.users
set banned_until = now() + interval '1 day'
where id = '18000000-0000-4000-8000-000000000007';

insert into public.groups (id, name, time_zone)
values
  ('28000000-0000-4000-8000-000000000001', 'Handicap Group A', 'UTC'),
  ('28000000-0000-4000-8000-000000000002', 'Handicap Group B', 'UTC');

insert into public.memberships (
  id, group_id, user_id, role, status, activated_at, inactivated_at
)
values
  ('38000000-0000-4000-8000-000000000001', '28000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000001', 'administrator', 'active', now(), null),
  ('38000000-0000-4000-8000-000000000002', '28000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000002', 'coordinator', 'active', now(), null),
  ('38000000-0000-4000-8000-000000000003', '28000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000003', 'member', 'active', now(), null),
  ('38000000-0000-4000-8000-000000000004', '28000000-0000-4000-8000-000000000002', '18000000-0000-4000-8000-000000000004', 'administrator', 'active', now(), null),
  ('38000000-0000-4000-8000-000000000005', '28000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000005', 'coordinator', 'inactive', now(), now()),
  ('38000000-0000-4000-8000-000000000006', '28000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000006', 'coordinator', 'active', now(), null),
  ('38000000-0000-4000-8000-000000000007', '28000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000007', 'coordinator', 'active', now(), null),
  ('38000000-0000-4000-8000-000000000008', '28000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000008', 'coordinator', 'active', now(), null),
  ('38000000-0000-4000-8000-000000000009', '28000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000009', 'coordinator', 'active', now(), null),
  ('38000000-0000-4000-8000-000000000010', '28000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000010', 'administrator', 'active', now(), null);

insert into public.membership_handicap_records (
  id, membership_id, group_id, handicap_id, handicap, source, as_of, created_at
)
values (
  '48000000-0000-4000-8000-000000000001',
  '38000000-0000-4000-8000-000000000003',
  '28000000-0000-4000-8000-000000000001',
  'IMPORT-OLD',
  11.8,
  'import',
  '2026-07-20',
  '2026-07-20T12:00:00Z'
);

select throws_ok(
  $$ select * from public.set_member_handicap(
    '18000000-0000-4000-8000-000000000003',
    '38000000-0000-4000-8000-000000000003',
    'H-DENIED', 12.3, '2026-07-21', 1, true, 'Member attempt',
    '58000000-0000-4000-8000-000000000001',
    '68000000-0000-4000-8000-000000000001'
  ) $$,
  'P0003',
  'actor_not_authorized',
  'a member cannot author a manual handicap'
);
select throws_ok(
  $$ select * from public.set_member_handicap(
    '18000000-0000-4000-8000-000000000004',
    '38000000-0000-4000-8000-000000000003',
    'H-CROSS', 12.3, '2026-07-21', 1, true, 'Cross group attempt',
    '58000000-0000-4000-8000-000000000002',
    '68000000-0000-4000-8000-000000000002'
  ) $$,
  'P0002',
  'member_not_found',
  'an administrator cannot target another tenant'
);
select throws_ok(
  $$ select * from public.set_member_handicap(
    '18000000-0000-4000-8000-000000000002',
    '38000000-0000-4000-8000-000000000010',
    'H-ADMIN', 12.3, '2026-07-21', 1, true, 'Coordinator attempt',
    '58000000-0000-4000-8000-000000000003',
    '68000000-0000-4000-8000-000000000003'
  ) $$,
  'P0003',
  'member_admin_target_forbidden',
  'a coordinator cannot target an administrator'
);

select throws_ok(
  $$ select * from public.set_member_handicap(
    '18000000-0000-4000-8000-000000000005',
    '38000000-0000-4000-8000-000000000003',
    'H-INACTIVE', 12.3, '2026-07-21', 1, true, 'Inactive attempt',
    '58000000-0000-4000-8000-000000000004',
    '68000000-0000-4000-8000-000000000004'
  ) $$,
  'P0003', 'actor_not_authorized', 'inactive actors are denied'
);
select throws_ok(
  $$ select * from public.set_member_handicap(
    '18000000-0000-4000-8000-000000000006',
    '38000000-0000-4000-8000-000000000003',
    'H-DISABLED', 12.3, '2026-07-21', 1, true, 'Disabled attempt',
    '58000000-0000-4000-8000-000000000005',
    '68000000-0000-4000-8000-000000000005'
  ) $$,
  'P0003', 'actor_not_authorized', 'disabled actors are denied'
);
select throws_ok(
  $$ select * from public.set_member_handicap(
    '18000000-0000-4000-8000-000000000007',
    '38000000-0000-4000-8000-000000000003',
    'H-BANNED', 12.3, '2026-07-21', 1, true, 'Banned attempt',
    '58000000-0000-4000-8000-000000000006',
    '68000000-0000-4000-8000-000000000006'
  ) $$,
  'P0003', 'actor_not_authorized', 'banned actors are denied'
);
select throws_ok(
  $$ select * from public.set_member_handicap(
    '18000000-0000-4000-8000-000000000008',
    '38000000-0000-4000-8000-000000000003',
    'H-UNVERIFIED', 12.3, '2026-07-21', 1, true, 'Unverified attempt',
    '58000000-0000-4000-8000-000000000007',
    '68000000-0000-4000-8000-000000000007'
  ) $$,
  'P0003', 'actor_not_authorized', 'unverified actors are denied'
);
select throws_ok(
  $$ select * from public.set_member_handicap(
    '18000000-0000-4000-8000-000000000009',
    '38000000-0000-4000-8000-000000000003',
    'H-ANONYMOUS', 12.3, '2026-07-21', 1, true, 'Anonymous attempt',
    '58000000-0000-4000-8000-000000000008',
    '68000000-0000-4000-8000-000000000008'
  ) $$,
  'P0003', 'actor_not_authorized', 'anonymous actors are denied'
);

select throws_ok(
  $$ select * from public.set_member_handicap(
    '18000000-0000-4000-8000-000000000002',
    '38000000-0000-4000-8000-000000000003',
    repeat('x', 101), 12.3, '2026-07-21', 1, true, 'Invalid identifier',
    '58000000-0000-4000-8000-000000000009',
    '68000000-0000-4000-8000-000000000009'
  ) $$,
  '22023', 'member_handicap_id_invalid', 'handicap identifiers are bounded'
);
select throws_ok(
  $$ select * from public.set_member_handicap(
    '18000000-0000-4000-8000-000000000002',
    '38000000-0000-4000-8000-000000000003',
    'H-NULL', null, '2026-07-21', 1, true, 'Null value',
    '58000000-0000-4000-8000-000000000010',
    '68000000-0000-4000-8000-000000000010'
  ) $$,
  '22004', 'member_handicap_value_required', 'handicap value is required'
);
select throws_ok(
  $$ select * from public.set_member_handicap(
    '18000000-0000-4000-8000-000000000002',
    '38000000-0000-4000-8000-000000000003',
    'H-NODATE', 12.3, null, 1, true, 'Missing date',
    '58000000-0000-4000-8000-000000000011',
    '68000000-0000-4000-8000-000000000011'
  ) $$,
  '22004', 'member_handicap_value_required', 'handicap as-of date is required'
);
select throws_ok(
  $$ select * from public.set_member_handicap(
    '18000000-0000-4000-8000-000000000002',
    '38000000-0000-4000-8000-000000000003',
    'H-UNCONFIRMED', 12.3, '2026-07-21', 1, false, 'Not confirmed',
    '58000000-0000-4000-8000-000000000012',
    '68000000-0000-4000-8000-000000000012'
  ) $$,
  '22023', 'member_handicap_confirmation_required', 'confirmation is required'
);
select throws_ok(
  $$ select * from public.set_member_handicap(
    '18000000-0000-4000-8000-000000000002',
    '38000000-0000-4000-8000-000000000003',
    'H-NOREASON', 12.3, '2026-07-21', 1, true, ' ',
    '58000000-0000-4000-8000-000000000013',
    '68000000-0000-4000-8000-000000000013'
  ) $$,
  '22023', 'member_handicap_confirmation_required', 'a reason is required'
);
select throws_ok(
  $$ select * from public.set_member_handicap(
    '18000000-0000-4000-8000-000000000002',
    '38000000-0000-4000-8000-000000000003',
    'H-STALE', 12.3, '2026-07-21', 0, true, 'Stale version',
    '58000000-0000-4000-8000-000000000014',
    '68000000-0000-4000-8000-000000000014'
  ) $$,
  '22023', 'member_membership_version_invalid', 'non-positive versions are rejected'
);
select throws_ok(
  $$ select * from public.set_member_handicap(
    '18000000-0000-4000-8000-000000000002',
    '38000000-0000-4000-8000-000000000003',
    'H-RANGE', 54.1, '2026-07-21', 1, true, 'Out of range',
    '58000000-0000-4000-8000-000000000015',
    '68000000-0000-4000-8000-000000000015'
  ) $$,
  '23514', null, 'the handicap domain rejects values above 54'
);

create temporary table first_change on commit drop as
select * from public.set_member_handicap(
  '18000000-0000-4000-8000-000000000002',
  '38000000-0000-4000-8000-000000000003',
  'H-MANUAL-1', 12.3, '2026-07-21', 1, true, 'Corrected club record',
  '58000000-0000-4000-8000-000000000016',
  '68000000-0000-4000-8000-000000000016'
);

select is((select membership_version from first_change), 2::bigint, 'manual change advances the membership version');
select is((select handicap::numeric from first_change), 12.3::numeric, 'manual value is returned exactly');
select is((select source::text from first_change), 'manual', 'manual source is server-authored');
select is((select handicap_id from first_change), 'H-MANUAL-1', 'handicap identifier is returned');
select is((select as_of from first_change), '2026-07-21'::date, 'as-of date is preserved');
select ok((select created_at is not null from first_change), 'server receipt timestamp is populated');
select is(
  (select count(*) from public.membership_handicap_records where membership_id = '38000000-0000-4000-8000-000000000003'),
  2::bigint,
  'manual change appends without rewriting imported history'
);
select is(
  (select handicap::numeric from public.membership_handicap_records
   where membership_id = '38000000-0000-4000-8000-000000000003'
   order by as_of desc, created_at desc, id desc limit 1),
  12.3::numeric,
  'latest projection ordering selects the newest as-of observation'
);
select is(
  (select count(*) from public.audit_events where action = 'member.handicap_changed'),
  1::bigint,
  'manual change writes one audit event'
);
select is(
  (select reason from public.audit_events where action = 'member.handicap_changed'),
  'Corrected club record',
  'manual change reason is audited'
);
select ok(
  (select after_state ->> 'request_fingerprint' is not null
   and after_state ->> 'handicap' = '12.3'
   and after_state ->> 'source' = 'manual'
   from public.audit_events where action = 'member.handicap_changed'),
  'audit stores a safe result and replay fingerprint'
);

select * from public.set_member_handicap(
  '18000000-0000-4000-8000-000000000002',
  '38000000-0000-4000-8000-000000000003',
  'H-MANUAL-1', 12.3, '2026-07-21', 1, true, 'Corrected club record',
  '58000000-0000-4000-8000-000000000099',
  '68000000-0000-4000-8000-000000000016'
);
select is(
  (select count(*) from public.membership_handicap_records where membership_id = '38000000-0000-4000-8000-000000000003'),
  2::bigint,
  'an exact retry does not append a second observation'
);
select is(
  (select count(*) from public.audit_events where action = 'member.handicap_changed'),
  1::bigint,
  'an exact retry does not duplicate audit'
);
select throws_ok(
  $$ select * from public.set_member_handicap(
    '18000000-0000-4000-8000-000000000002',
    '38000000-0000-4000-8000-000000000003',
    'H-MANUAL-CHANGED', 13.3, '2026-07-21', 1, true, 'Changed payload',
    '58000000-0000-4000-8000-000000000099',
    '68000000-0000-4000-8000-000000000016'
  ) $$,
  '23505', 'operation_id_reused', 'a reused operation id cannot change payload'
);

select throws_ok(
  $$ select * from public.set_member_handicap(
    '18000000-0000-4000-8000-000000000001',
    '38000000-0000-4000-8000-000000000003',
    'H-STALE', 13.4, '2026-07-22', 1, true, 'Stale admin edit',
    '58000000-0000-4000-8000-000000000017',
    '68000000-0000-4000-8000-000000000017'
  ) $$,
  '40001', 'member_membership_version_changed', 'a stale membership version is rejected'
);

create temporary table second_change on commit drop as
select * from public.set_member_handicap(
  '18000000-0000-4000-8000-000000000001',
  '38000000-0000-4000-8000-000000000003',
  'H-MANUAL-2', 13.4, '2026-07-22', 2, true, 'Updated club record',
  '58000000-0000-4000-8000-000000000018',
  '68000000-0000-4000-8000-000000000018'
);
select is((select membership_version from second_change), 3::bigint, 'administrator can append in the same tenant');
select is((select count(*) from public.audit_events where action = 'member.handicap_changed'), 2::bigint, 'each successful operation is audited once');

select * from public.set_member_handicap(
  '18000000-0000-4000-8000-000000000001',
  '38000000-0000-4000-8000-000000000003',
  'H-MANUAL-OLD', 9.9, '2026-07-19', 3, true, 'Backfill older as-of',
  '58000000-0000-4000-8000-000000000019',
  '68000000-0000-4000-8000-000000000019'
);
select is(
  (select handicap::numeric from public.membership_handicap_records
   where membership_id = '38000000-0000-4000-8000-000000000003'
   order by as_of desc, created_at desc, id desc limit 1),
  13.4::numeric,
  'an older as-of correction remains history and does not become current'
);
select is(
  (select count(*) from public.membership_handicap_records where membership_id = '38000000-0000-4000-8000-000000000003'),
  4::bigint,
  'all observations remain append-only history'
);

select throws_ok(
  $$ update public.membership_handicap_records
     set handicap_id = 'MUTATED'
   where id = '48000000-0000-4000-8000-000000000001' $$,
  'P0001', 'handicap_records_append_only', 'history rows cannot be updated'
);
select throws_ok(
  $$ delete from public.membership_handicap_records
   where id = '48000000-0000-4000-8000-000000000001' $$,
  'P0001', 'handicap_records_append_only', 'history rows cannot be deleted'
);

create function public.test_member_handicap_audit_failure()
returns trigger
language plpgsql
as $$
begin
  raise exception 'test_member_handicap_audit_failure' using errcode = 'P0001';
end;
$$;
create trigger test_member_handicap_audit_failure
after insert on public.audit_events
for each row
when (new.action = 'member.handicap_changed')
execute function public.test_member_handicap_audit_failure();

select throws_ok(
  $$ select * from public.set_member_handicap(
    '18000000-0000-4000-8000-000000000001',
    '38000000-0000-4000-8000-000000000003',
    'H-ROLLBACK', 14.4, '2026-07-23', 4, true, 'Audit rollback check',
    '58000000-0000-4000-8000-000000000020',
    '68000000-0000-4000-8000-000000000020'
  ) $$,
  'P0001', 'test_member_handicap_audit_failure', 'audit failure aborts the mutation'
);
drop trigger test_member_handicap_audit_failure on public.audit_events;
drop function public.test_member_handicap_audit_failure();
select is(
  (select count(*) from public.membership_handicap_records where membership_id = '38000000-0000-4000-8000-000000000003'),
  4::bigint,
  'audit failure rolls back the appended row'
);
select is(
  (select version from public.memberships where id = '38000000-0000-4000-8000-000000000003'),
  4::bigint,
  'audit failure rolls back the membership version'
);
select is(
  (select count(*) from public.audit_events where action = 'member.handicap_changed'),
  3::bigint,
  'audit failure leaves no partial audit row'
);

select * from finish();

rollback;
