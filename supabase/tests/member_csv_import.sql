begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

select has_table('public', 'member_csv_import_jobs', 'CSV import jobs exist');
select has_table('public', 'member_csv_import_rows', 'CSV import rows exist');
select has_table('public', 'membership_handicap_records', 'imported handicap records exist');
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid = 'public.member_csv_import_jobs'::regclass),
  'import jobs use force RLS'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid = 'public.member_csv_import_rows'::regclass),
  'import rows use force RLS'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid = 'public.membership_handicap_records'::regclass),
  'handicap records use force RLS'
);
select ok(not has_table_privilege('anon', 'public.member_csv_import_jobs', 'select,insert,update,delete'), 'anon cannot read or mutate import jobs');
select ok(not has_table_privilege('authenticated', 'public.member_csv_import_jobs', 'select,insert,update,delete'), 'authenticated cannot read or mutate import jobs');
select ok(not has_table_privilege('authenticated', 'public.member_csv_import_rows', 'select,insert,update,delete'), 'authenticated cannot read or mutate import rows');
select ok(not has_table_privilege('authenticated', 'public.membership_handicap_records', 'select,insert,update,delete'), 'authenticated cannot read or mutate handicap records');
select ok(has_function_privilege('service_role', 'public.apply_member_csv_import(uuid,uuid,uuid,jsonb,uuid,uuid)', 'execute'), 'service role can apply imports');
select ok(not has_function_privilege('authenticated', 'public.apply_member_csv_import(uuid,uuid,uuid,jsonb,uuid,uuid)', 'execute'), 'authenticated cannot apply imports');

insert into auth.users (id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at)
values
  ('a1000000-0000-4000-8000-000000000001', 'csv-admin-a@example.test', now(), false, false, now(), now()),
  ('a1000000-0000-4000-8000-000000000002', 'csv-coordinator-a@example.test', now(), false, false, now(), now()),
  ('a1000000-0000-4000-8000-000000000003', 'csv-member-a@example.test', now(), false, false, now(), now()),
  ('a1000000-0000-4000-8000-000000000004', 'csv-admin-b@example.test', now(), false, false, now(), now());
insert into public.user_profiles (user_id) values
  ('a1000000-0000-4000-8000-000000000001'), ('a1000000-0000-4000-8000-000000000002'),
  ('a1000000-0000-4000-8000-000000000003'), ('a1000000-0000-4000-8000-000000000004');
insert into public.groups (id, name, time_zone) values
  ('b1000000-0000-4000-8000-000000000001', 'CSV Group A', 'UTC'),
  ('b1000000-0000-4000-8000-000000000002', 'CSV Group B', 'UTC');
insert into public.memberships (id, group_id, user_id, role, status, activated_at) values
  ('c1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'administrator', 'active', now()),
  ('c1000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002', 'coordinator', 'active', now()),
  ('c1000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000003', 'member', 'active', now()),
  ('c1000000-0000-4000-8000-000000000004', 'b1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000004', 'administrator', 'active', now());
insert into public.group_quota_settings (
  group_id, method, moving_average_history_length, precision, rounding_rule, version, updated_by
) values (
  'b1000000-0000-4000-8000-000000000001', 'moving_average', 4, 2, 'half_away_from_zero', 1,
  'a1000000-0000-4000-8000-000000000001'
);

-- Existing pending invitation is a skip candidate independent of account e-mail.
insert into public.memberships (id, group_id, role, status) values
  ('c1000000-0000-4000-8000-000000000005', 'b1000000-0000-4000-8000-000000000001', 'member', 'pending');
insert into public.membership_golfer_profiles (membership_id, group_id, first_name, last_name)
values ('c1000000-0000-4000-8000-000000000005', 'b1000000-0000-4000-8000-000000000001', 'Pending', 'Existing');
insert into public.membership_invitations (
  id, group_id, membership_id, invited_email, invited_email_normalized, role,
  token_digest_sha256, token_key_version, status, issued_at, expires_at, inviter_user_id
) values (
  'd1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000005',
  'pending-existing@example.test', 'pending-existing@example.test', 'member', repeat('a', 64), 1, 'pending', now(), now() + interval '1 day',
  'a1000000-0000-4000-8000-000000000002'
);

-- These addresses belong to Group B only. Group A validation must not
-- enumerate or skip them by looking outside the import tenant.
insert into auth.users (id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at)
values ('a1000000-0000-4000-8000-000000000005', 'cross-account-b@example.test', now(), false, false, now(), now());
insert into public.user_profiles (user_id) values ('a1000000-0000-4000-8000-000000000005');
insert into public.memberships (id, group_id, user_id, role, status, activated_at)
values ('c1000000-0000-4000-8000-000000000006', 'b1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000005', 'member', 'active', now());
insert into public.memberships (id, group_id, role, status)
values ('c1000000-0000-4000-8000-000000000007', 'b1000000-0000-4000-8000-000000000002', 'member', 'pending');
insert into public.membership_golfer_profiles (membership_id, group_id, first_name, last_name)
values ('c1000000-0000-4000-8000-000000000007', 'b1000000-0000-4000-8000-000000000002', 'Cross', 'Pending');
insert into public.membership_invitations (
  id, group_id, membership_id, invited_email, invited_email_normalized, role,
  token_digest_sha256, token_key_version, status, issued_at, expires_at, inviter_user_id
) values (
  'd1000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000007',
  'cross-pending-b@example.test', 'cross-pending-b@example.test', 'member', repeat('c', 64), 1, 'pending', now(), now() + interval '1 day',
  'a1000000-0000-4000-8000-000000000004'
);

select throws_ok(
  $$ select * from public.create_member_csv_import(
    'a1000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000001', repeat('1',64),
    '[{"first_name":"Denied","last_name":"Member","invited_email":"denied@example.test"}]'::jsonb,
    'f1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000002'
  ) $$,
  'P0003', 'actor_not_authorized', 'members cannot upload imports'
);
select throws_ok(
  $$ select * from public.create_member_csv_import(
    'a1000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000006', repeat('6',64),
    '[{"first_name":"Quota","last_name":"Denied","invited_email":"quota-denied@example.test","initial_quota":"10.00"}]'::jsonb,
    'f1000000-0000-4000-8000-000000000024', 'f1000000-0000-4000-8000-000000000025'
  ) $$,
  'P0003', 'actor_not_authorized', 'coordinators cannot upload quota-bearing rows'
);

-- Quota-bearing imports are administrator-owned.  Coordinators may still
-- upload ordinary member rows, covered by the lease job below.
create temporary table uploaded_csv as
select * from public.create_member_csv_import(
  'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002', repeat('2',64),
  pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('first_name','Alice','last_name','New','invited_email','alice-new@example.test','role','administrator','status','active','initial_quota','12.50','use_initial_quota',true,'seed_total_1','10.00','seed_total_2','11.25','handicap_id','H-22','handicap','8.5','handicap_as_of','2026-07-01','mobile_phone','+1 (555) 100-1000'),
    pg_catalog.jsonb_build_object('first_name','Already','last_name','Account','invited_email','csv-member-a@example.test'),
    pg_catalog.jsonb_build_object('first_name','Already','last_name','Pending','invited_email','pending-existing@example.test')
  ),
  'f1000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000004'
);
select is((select state from uploaded_csv), 'uploaded'::public.member_csv_import_state, 'upload starts Uploaded');
select is((select total_rows from uploaded_csv), 3, 'upload stores all rows');
select ok((select not (raw_payload ? 'role') and not (raw_payload ? 'status') from public.member_csv_import_rows where import_job_id = 'e1000000-0000-4000-8000-000000000002' and row_number = 2), 'status/role and unknown token-like keys are not persisted');

select is((select state from public.claim_member_csv_import('e1000000-0000-4000-8000-000000000002','f1000000-0000-4000-8000-000000000010',300)), 'validating'::public.member_csv_import_state, 'worker claim enters Validating');
select is((select state from public.validate_member_csv_import('e1000000-0000-4000-8000-000000000002','f1000000-0000-4000-8000-000000000010')), 'validating'::public.member_csv_import_state, 'worker validates while lease is held');
create temporary table finalized_csv as
select * from public.finalize_member_csv_import_validation('e1000000-0000-4000-8000-000000000002','f1000000-0000-4000-8000-000000000010','f1000000-0000-4000-8000-000000000005');
select is((select state from finalized_csv), 'ready'::public.member_csv_import_state, 'valid/skipped file reaches Ready');
select is((select valid_rows from finalized_csv), 1, 'one row is valid');
select is((select skipped_rows from finalized_csv), 2, 'account and pending-invitation addresses are skips');
select is((select state from public.request_member_csv_import_apply(
  'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002',
  (select revision from finalized_csv), true, 'Initial member onboarding import',
  'f1000000-0000-4000-8000-000000000020', 'f1000000-0000-4000-8000-000000000021'
)), 'applying'::public.member_csv_import_state, 'explicit confirmation enters Applying');
select is((select state from public.claim_member_csv_import_apply('e1000000-0000-4000-8000-000000000002','f1000000-0000-4000-8000-000000000011',1800)), 'applying'::public.member_csv_import_state, 'worker claims confirmed Applying job');
select is((select count(*) from public.get_member_csv_import_apply_material('e1000000-0000-4000-8000-000000000002','f1000000-0000-4000-8000-000000000011')), 1::bigint, 'apply material exposes one valid row');

create temporary table applied_csv as
select * from public.apply_member_csv_import(
  'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000011',
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('row_number',2,'invited_email','alice-new@example.test','invitation_id','d1000000-0000-4000-8000-000000000010','token_digest',repeat('b',64),'token_key_version',1,'expires_at',(now()+interval '1 day')::text)),
  'f1000000-0000-4000-8000-000000000006', 'f1000000-0000-4000-8000-000000000021'
);
select is((select state from applied_csv), 'completed'::public.member_csv_import_state, 'apply reaches Completed');
select is((select applied_rows from applied_csv), 1, 'one non-skipped row applies');
select is((select skipped_rows from applied_csv), 2, 'skips remain counted after apply');
select is((select role from public.memberships where id = (select membership_id from public.member_csv_import_rows where import_job_id = 'e1000000-0000-4000-8000-000000000002' and row_number = 2)), 'member'::public.membership_role, 'CSV cannot elevate role');
select is((select status from public.memberships where id = (select membership_id from public.member_csv_import_rows where import_job_id = 'e1000000-0000-4000-8000-000000000002' and row_number = 2)), 'pending'::public.membership_status, 'CSV cannot activate membership');
select is((select count(*) from public.membership_quota_seed_totals where group_id = 'b1000000-0000-4000-8000-000000000001' and source = 'member_csv_import'), 2::bigint, 'seed totals persist');
select is(((select projected_quota from public.membership_quota_projections where membership_id = (select membership_id from public.member_csv_import_rows where import_job_id = 'e1000000-0000-4000-8000-000000000002' and row_number = 2))::numeric), 12.50::numeric, 'initial quota projection persists exactly');
select is((select count(*) from public.membership_handicap_records where source = 'import' and handicap = 8.5), 1::bigint, 'imported handicap persists');
select is((select count(*) from public.notification_outbox_jobs where aggregate_id = 'd1000000-0000-4000-8000-000000000010'), 1::bigint, 'invitation outbox is queued');
select is((select count(*) from public.notification_deliveries where outbox_job_id = (select id from public.notification_outbox_jobs where aggregate_id = 'd1000000-0000-4000-8000-000000000010')), 1::bigint, 'invitation delivery is queued');
select ok(
  not exists (select 1 from public.audit_events where target_id = 'e1000000-0000-4000-8000-000000000002' and (after_state ? 'raw_payload' or after_state ? 'token_digest' or after_state ? 'invited_email')),
  'import audits contain counts/revisions but no raw row or token values'
);

select * from public.create_member_csv_import(
  'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000007', repeat('7',64),
  '[{"first_name":"Cross","last_name":"Account","invited_email":"cross-account-b@example.test"},{"first_name":"Cross","last_name":"Pending","invited_email":"cross-pending-b@example.test"}]'::jsonb,
  'f1000000-0000-4000-8000-000000000026', 'f1000000-0000-4000-8000-000000000027'
);
select * from public.claim_member_csv_import('e1000000-0000-4000-8000-000000000007','f1000000-0000-4000-8000-000000000028',300);
select * from public.validate_member_csv_import('e1000000-0000-4000-8000-000000000007','f1000000-0000-4000-8000-000000000028');
create temporary table cross_group_finalized as
select * from public.finalize_member_csv_import_validation(
  'e1000000-0000-4000-8000-000000000007','f1000000-0000-4000-8000-000000000028','f1000000-0000-4000-8000-000000000029'
);
select is((select state from cross_group_finalized), 'ready'::public.member_csv_import_state, 'cross-group addresses remain eligible in the import tenant');
select is((select valid_rows from cross_group_finalized), 2, 'cross-group account and invitation are not false skips');
select is((select skipped_rows from cross_group_finalized), 0, 'cross-group matching never enumerates another tenant');

-- Blank use_initial_quota defaults to true, but a complete Method A history
-- deactivates that freeze and retains the original source positions.
select * from public.create_member_csv_import(
  'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000008', repeat('8',64),
  '[{"first_name":"Seed","last_name":"History","invited_email":"seed-history@example.test","initial_quota":"99.99","seed_total_1":"1.00","seed_total_2":"2.00","seed_total_3":"3.00","seed_total_4":"4.00"}]'::jsonb,
  'f1000000-0000-4000-8000-000000000030', 'f1000000-0000-4000-8000-000000000031'
);
select * from public.claim_member_csv_import('e1000000-0000-4000-8000-000000000008','f1000000-0000-4000-8000-000000000032',300);
select * from public.validate_member_csv_import('e1000000-0000-4000-8000-000000000008','f1000000-0000-4000-8000-000000000032');
create temporary table seed_history_finalized as
select * from public.finalize_member_csv_import_validation(
  'e1000000-0000-4000-8000-000000000008','f1000000-0000-4000-8000-000000000032','f1000000-0000-4000-8000-000000000033'
);
select * from public.request_member_csv_import_apply(
  'a1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000008',
  (select revision from seed_history_finalized), true, 'Seed history import',
  'f1000000-0000-4000-8000-000000000034','f1000000-0000-4000-8000-000000000035'
);
select * from public.claim_member_csv_import_apply('e1000000-0000-4000-8000-000000000008','f1000000-0000-4000-8000-000000000036',1800);
select * from public.apply_member_csv_import(
  'a1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000008','f1000000-0000-4000-8000-000000000036',
  '[{"row_number":2,"invited_email":"seed-history@example.test","invitation_id":"d1000000-0000-4000-8000-000000000012","token_digest":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","token_key_version":1,"expires_at":"2099-01-01T00:00:00Z"}]'::jsonb,
  'f1000000-0000-4000-8000-000000000037','f1000000-0000-4000-8000-000000000035'
);
select is((select uses_initial_quota from public.memberships where id = (select membership_id from public.member_csv_import_rows where import_job_id = 'e1000000-0000-4000-8000-000000000008')), false, 'complete seed history deactivates the initial freeze');
select is((select projected_quota::numeric from public.membership_quota_projections where membership_id = (select membership_id from public.member_csv_import_rows where import_job_id = 'e1000000-0000-4000-8000-000000000008')), 2.50::numeric, 'moving-average projection uses the configured history');
select is((select projection_source ->> 'kind' from public.membership_quota_projections where membership_id = (select membership_id from public.member_csv_import_rows where import_job_id = 'e1000000-0000-4000-8000-000000000008')), 'seed_history', 'seed projection provenance is canonical');
select is((select projection_source -> 'seed_positions' from public.membership_quota_projections where membership_id = (select membership_id from public.member_csv_import_rows where import_job_id = 'e1000000-0000-4000-8000-000000000008')), '[1, 2, 3, 4]'::jsonb, 'seed source positions remain oldest-first');

-- Explicitly disabling the initial freeze calculates from all available
-- history, even before the method's normal readiness threshold.
select * from public.create_member_csv_import(
  'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000011', repeat('d',64),
  '[{"first_name":"Partial","last_name":"Average","invited_email":"partial-average@example.test","use_initial_quota":false,"seed_total_1":"6.00","seed_total_2":"10.00"}]'::jsonb,
  'f1000000-0000-4000-8000-000000000060', 'f1000000-0000-4000-8000-000000000061'
);
select * from public.claim_member_csv_import('e1000000-0000-4000-8000-000000000011','f1000000-0000-4000-8000-000000000062',300);
select * from public.validate_member_csv_import('e1000000-0000-4000-8000-000000000011','f1000000-0000-4000-8000-000000000062');
create temporary table partial_average_finalized as
select * from public.finalize_member_csv_import_validation(
  'e1000000-0000-4000-8000-000000000011','f1000000-0000-4000-8000-000000000062','f1000000-0000-4000-8000-000000000063'
);
select * from public.request_member_csv_import_apply(
  'a1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000011',
  (select revision from partial_average_finalized), true, 'Partial moving average import',
  'f1000000-0000-4000-8000-000000000064','f1000000-0000-4000-8000-000000000065'
);
select * from public.claim_member_csv_import_apply('e1000000-0000-4000-8000-000000000011','f1000000-0000-4000-8000-000000000066',1800);
select * from public.apply_member_csv_import(
  'a1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000011','f1000000-0000-4000-8000-000000000066',
  '[{"row_number":2,"invited_email":"partial-average@example.test","invitation_id":"d1000000-0000-4000-8000-000000000022","token_digest":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","token_key_version":1,"expires_at":"2099-01-01T00:00:00Z"}]'::jsonb,
  'f1000000-0000-4000-8000-000000000067','f1000000-0000-4000-8000-000000000065'
);
select is((select projected_quota::numeric from public.membership_quota_projections where membership_id = (select membership_id from public.member_csv_import_rows where import_job_id = 'e1000000-0000-4000-8000-000000000011')), 8.00::numeric, 'disabled Method A freeze averages a partial history');
select is((select projection_ready from public.membership_quota_projections where membership_id = (select membership_id from public.member_csv_import_rows where import_job_id = 'e1000000-0000-4000-8000-000000000011')), true, 'partial Method A history is projection-ready when the freeze is disabled');

-- Explicit freeze disable with zero history still leaves the supplied initial
-- quota as the ready projection; there is no history value to supersede it.
select * from public.create_member_csv_import(
  'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000013', repeat('0',64),
  '[{"first_name":"Zero","last_name":"History","invited_email":"zero-history@example.test","initial_quota":"27.50","use_initial_quota":false}]'::jsonb,
  'f1000000-0000-4000-8000-000000000076','f1000000-0000-4000-8000-000000000077'
);
select * from public.claim_member_csv_import('e1000000-0000-4000-8000-000000000013','f1000000-0000-4000-8000-000000000078',300);
select * from public.validate_member_csv_import('e1000000-0000-4000-8000-000000000013','f1000000-0000-4000-8000-000000000078');
create temporary table zero_history_finalized as
select * from public.finalize_member_csv_import_validation(
  'e1000000-0000-4000-8000-000000000013','f1000000-0000-4000-8000-000000000078','f1000000-0000-4000-8000-000000000079'
);
select * from public.request_member_csv_import_apply(
  'a1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000013',
  (select revision from zero_history_finalized), true, 'Zero-history initial quota',
  'f1000000-0000-4000-8000-000000000080','f1000000-0000-4000-8000-000000000081'
);
select * from public.claim_member_csv_import_apply('e1000000-0000-4000-8000-000000000013','f1000000-0000-4000-8000-000000000082',1800);
select * from public.apply_member_csv_import(
  'a1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000013','f1000000-0000-4000-8000-000000000082',
  '[{"row_number":2,"invited_email":"zero-history@example.test","invitation_id":"d1000000-0000-4000-8000-000000000024","token_digest":"1212121212121212121212121212121212121212121212121212121212121212","token_key_version":1,"expires_at":"2099-01-01T00:00:00Z"}]'::jsonb,
  'f1000000-0000-4000-8000-000000000083','f1000000-0000-4000-8000-000000000081'
);
select is((select uses_initial_quota from public.memberships where id = (select membership_id from public.member_csv_import_rows where import_job_id = 'e1000000-0000-4000-8000-000000000013')), false, 'zero-history explicit disable remains false');
select is((select projected_quota::numeric from public.membership_quota_projections where membership_id = (select membership_id from public.member_csv_import_rows where import_job_id = 'e1000000-0000-4000-8000-000000000013')), 27.50::numeric, 'zero-history initial quota remains ready');
select is((select projection_ready from public.membership_quota_projections where membership_id = (select membership_id from public.member_csv_import_rows where import_job_id = 'e1000000-0000-4000-8000-000000000013')), true, 'zero-history initial projection is ready');

insert into public.group_quota_settings (
  group_id, method, moving_average_history_length, precision, rounding_rule, version, updated_by
) values (
  'b1000000-0000-4000-8000-000000000002', 'best_10_of_20', null, 2, 'half_away_from_zero', 1,
  'a1000000-0000-4000-8000-000000000004'
);
select * from public.create_member_csv_import(
  'a1000000-0000-4000-8000-000000000004', 'e1000000-0000-4000-8000-000000000012', repeat('e',64),
  '[{"first_name":"Partial","last_name":"Best","invited_email":"partial-best@example.test","use_initial_quota":false,"seed_total_1":"12.00","seed_total_2":"4.00","seed_total_3":"8.00"}]'::jsonb,
  'f1000000-0000-4000-8000-000000000068', 'f1000000-0000-4000-8000-000000000069'
);
select * from public.claim_member_csv_import('e1000000-0000-4000-8000-000000000012','f1000000-0000-4000-8000-000000000070',300);
select * from public.validate_member_csv_import('e1000000-0000-4000-8000-000000000012','f1000000-0000-4000-8000-000000000070');
create temporary table partial_best_finalized as
select * from public.finalize_member_csv_import_validation(
  'e1000000-0000-4000-8000-000000000012','f1000000-0000-4000-8000-000000000070','f1000000-0000-4000-8000-000000000071'
);
select * from public.request_member_csv_import_apply(
  'a1000000-0000-4000-8000-000000000004','e1000000-0000-4000-8000-000000000012',
  (select revision from partial_best_finalized), true, 'Partial best totals import',
  'f1000000-0000-4000-8000-000000000072','f1000000-0000-4000-8000-000000000073'
);
select * from public.claim_member_csv_import_apply('e1000000-0000-4000-8000-000000000012','f1000000-0000-4000-8000-000000000074',1800);
select * from public.apply_member_csv_import(
  'a1000000-0000-4000-8000-000000000004','e1000000-0000-4000-8000-000000000012','f1000000-0000-4000-8000-000000000074',
  '[{"row_number":2,"invited_email":"partial-best@example.test","invitation_id":"d1000000-0000-4000-8000-000000000023","token_digest":"abababababababababababababababababababababababababababababababab","token_key_version":1,"expires_at":"2099-01-01T00:00:00Z"}]'::jsonb,
  'f1000000-0000-4000-8000-000000000075','f1000000-0000-4000-8000-000000000073'
);
select is((select projected_quota::numeric from public.membership_quota_projections where membership_id = (select membership_id from public.member_csv_import_rows where import_job_id = 'e1000000-0000-4000-8000-000000000012')), 8.00::numeric, 'disabled Method B freeze averages all available best totals');
select is((select projection_ready from public.membership_quota_projections where membership_id = (select membership_id from public.member_csv_import_rows where import_job_id = 'e1000000-0000-4000-8000-000000000012')), true, 'partial Method B history is projection-ready when the freeze is disabled');

-- Removing a group's quota settings rejects quota/history-bearing rows, while
-- ordinary rows in that same group remain importable and not projection-ready.
delete from public.group_quota_settings where group_id = 'b1000000-0000-4000-8000-000000000002';
select * from public.create_member_csv_import(
  'a1000000-0000-4000-8000-000000000004', 'e1000000-0000-4000-8000-000000000014', repeat('1',64),
  '[{"first_name":"No","last_name":"Settings","invited_email":"no-settings-quota@example.test","initial_quota":"10.00","use_initial_quota":true}]'::jsonb,
  'f1000000-0000-4000-8000-000000000084','f1000000-0000-4000-8000-000000000085'
);
select * from public.claim_member_csv_import('e1000000-0000-4000-8000-000000000014','f1000000-0000-4000-8000-000000000086',300);
select * from public.validate_member_csv_import('e1000000-0000-4000-8000-000000000014','f1000000-0000-4000-8000-000000000086');
create temporary table no_settings_quota_finalized as
select * from public.finalize_member_csv_import_validation(
  'e1000000-0000-4000-8000-000000000014','f1000000-0000-4000-8000-000000000086','f1000000-0000-4000-8000-000000000087'
);
select is((select state from no_settings_quota_finalized), 'rejected'::public.member_csv_import_state, 'quota-bearing rows reject without group quota settings');
select ok((select error_codes @> '[{"code":"quota_settings_required"}]'::jsonb from public.member_csv_import_rows where import_job_id = 'e1000000-0000-4000-8000-000000000014'), 'missing settings is reported on quota rows');

select * from public.create_member_csv_import(
  'a1000000-0000-4000-8000-000000000004', 'e1000000-0000-4000-8000-000000000015', repeat('2',64),
  '[{"first_name":"No","last_name":"SettingsOrdinary","invited_email":"no-settings-ordinary@example.test"}]'::jsonb,
  'f1000000-0000-4000-8000-000000000088','f1000000-0000-4000-8000-000000000089'
);
select * from public.claim_member_csv_import('e1000000-0000-4000-8000-000000000015','f1000000-0000-4000-8000-000000000090',300);
select * from public.validate_member_csv_import('e1000000-0000-4000-8000-000000000015','f1000000-0000-4000-8000-000000000090');
create temporary table no_settings_ordinary_finalized as
select * from public.finalize_member_csv_import_validation(
  'e1000000-0000-4000-8000-000000000015','f1000000-0000-4000-8000-000000000090','f1000000-0000-4000-8000-000000000091'
);
select * from public.request_member_csv_import_apply(
  'a1000000-0000-4000-8000-000000000004','e1000000-0000-4000-8000-000000000015',
  (select revision from no_settings_ordinary_finalized), true, 'No-settings ordinary import',
  'f1000000-0000-4000-8000-000000000092','f1000000-0000-4000-8000-000000000093'
);
select * from public.claim_member_csv_import_apply('e1000000-0000-4000-8000-000000000015','f1000000-0000-4000-8000-000000000094',1800);
select * from public.apply_member_csv_import(
  'a1000000-0000-4000-8000-000000000004','e1000000-0000-4000-8000-000000000015','f1000000-0000-4000-8000-000000000094',
  '[{"row_number":2,"invited_email":"no-settings-ordinary@example.test","invitation_id":"d1000000-0000-4000-8000-000000000025","token_digest":"3434343434343434343434343434343434343434343434343434343434343434","token_key_version":1,"expires_at":"2099-01-01T00:00:00Z"}]'::jsonb,
  'f1000000-0000-4000-8000-000000000095','f1000000-0000-4000-8000-000000000093'
);
select is((select projection_ready from public.membership_quota_projections where membership_id = (select membership_id from public.member_csv_import_rows where import_job_id = 'e1000000-0000-4000-8000-000000000015')), false, 'ordinary rows complete without settings as not-ready');

-- Settings drift after confirmation but before apply also requeues atomically;
-- the stored fingerprint remains claimable for fresh validation/confirmation.
select * from public.create_member_csv_import(
  'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000016', repeat('6',64),
  '[{"first_name":"Apply","last_name":"Drift","invited_email":"apply-drift@example.test"}]'::jsonb,
  'f1000000-0000-4000-8000-000000000096','f1000000-0000-4000-8000-000000000097'
);
select * from public.claim_member_csv_import('e1000000-0000-4000-8000-000000000016','f1000000-0000-4000-8000-000000000098',300);
select * from public.validate_member_csv_import('e1000000-0000-4000-8000-000000000016','f1000000-0000-4000-8000-000000000098');
create temporary table apply_drift_finalized as
select * from public.finalize_member_csv_import_validation(
  'e1000000-0000-4000-8000-000000000016','f1000000-0000-4000-8000-000000000098','f1000000-0000-4000-8000-000000000099'
);
select * from public.request_member_csv_import_apply(
  'a1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000016',
  (select revision from apply_drift_finalized), true, 'Apply drift import',
  'f1000000-0000-4000-8000-000000000100','f1000000-0000-4000-8000-000000000101'
);
select * from public.claim_member_csv_import_apply('e1000000-0000-4000-8000-000000000016','f1000000-0000-4000-8000-000000000102',1800);
update public.group_quota_settings set version = 3 where group_id = 'b1000000-0000-4000-8000-000000000001';
create temporary table apply_drift_requeued as
select * from public.apply_member_csv_import(
  'a1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000016','f1000000-0000-4000-8000-000000000102',
  '[{"row_number":2,"invited_email":"apply-drift@example.test","invitation_id":"d1000000-0000-4000-8000-000000000026","token_digest":"5656565656565656565656565656565656565656565656565656565656565656","token_key_version":1,"expires_at":"2099-01-01T00:00:00Z"}]'::jsonb,
  'f1000000-0000-4000-8000-000000000103','f1000000-0000-4000-8000-000000000101'
);
select is((select state from apply_drift_requeued), 'uploaded'::public.member_csv_import_state, 'settings drift requeues after confirmation before apply');
select is((select state from public.create_member_csv_import(
  'a1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000098',repeat('6',64),
  '[{"first_name":"Replay","last_name":"ApplyDrift","invited_email":"ignored@example.test"}]'::jsonb,
  'f1000000-0000-4000-8000-000000000104','f1000000-0000-4000-8000-000000000105'
)), 'uploaded'::public.member_csv_import_state, 'post-confirmation drift fingerprint remains claimable');

-- A coordinator may import ordinary rows; with no quota/history the member is
-- created successfully but the projection remains explicitly not ready.
select * from public.create_member_csv_import(
  'a1000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000009', repeat('9',64),
  '[{"first_name":"Ordinary","last_name":"Coordinator","invited_email":"ordinary-coordinator@example.test"}]'::jsonb,
  'f1000000-0000-4000-8000-000000000038', 'f1000000-0000-4000-8000-000000000039'
);
select * from public.claim_member_csv_import('e1000000-0000-4000-8000-000000000009','f1000000-0000-4000-8000-000000000040',300);
select * from public.validate_member_csv_import('e1000000-0000-4000-8000-000000000009','f1000000-0000-4000-8000-000000000040');
create temporary table ordinary_finalized as
select * from public.finalize_member_csv_import_validation(
  'e1000000-0000-4000-8000-000000000009','f1000000-0000-4000-8000-000000000040','f1000000-0000-4000-8000-000000000041'
);
select * from public.request_member_csv_import_apply(
  'a1000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000009',
  (select revision from ordinary_finalized), true, 'Ordinary coordinator import',
  'f1000000-0000-4000-8000-000000000042','f1000000-0000-4000-8000-000000000043'
);
select * from public.claim_member_csv_import_apply('e1000000-0000-4000-8000-000000000009','f1000000-0000-4000-8000-000000000044',1800);
select * from public.apply_member_csv_import(
  'a1000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000009','f1000000-0000-4000-8000-000000000044',
  '[{"row_number":2,"invited_email":"ordinary-coordinator@example.test","invitation_id":"d1000000-0000-4000-8000-000000000013","token_digest":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","token_key_version":1,"expires_at":"2099-01-01T00:00:00Z"}]'::jsonb,
  'f1000000-0000-4000-8000-000000000045','f1000000-0000-4000-8000-000000000043'
);
select is((select projection_ready from public.membership_quota_projections where membership_id = (select membership_id from public.member_csv_import_rows where import_job_id = 'e1000000-0000-4000-8000-000000000009')), false, 'ordinary rows remain not projection-ready without quota/history');

-- A settings change after validation invalidates the captured version before
-- confirmation; the caller must revalidate instead of applying stale rules.
select * from public.create_member_csv_import(
  'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000010', repeat('a',64),
  '[{"first_name":"Drift","last_name":"Check","invited_email":"drift-check@example.test"}]'::jsonb,
  'f1000000-0000-4000-8000-000000000046', 'f1000000-0000-4000-8000-000000000047'
);
select * from public.claim_member_csv_import('e1000000-0000-4000-8000-000000000010','f1000000-0000-4000-8000-000000000048',300);
select * from public.validate_member_csv_import('e1000000-0000-4000-8000-000000000010','f1000000-0000-4000-8000-000000000048');
create temporary table drift_finalized as
select * from public.finalize_member_csv_import_validation(
  'e1000000-0000-4000-8000-000000000010','f1000000-0000-4000-8000-000000000048','f1000000-0000-4000-8000-000000000049'
);
update public.group_quota_settings set version = 2 where group_id = 'b1000000-0000-4000-8000-000000000001';
create temporary table drift_requeued as
select * from public.request_member_csv_import_apply(
  'a1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000010',
  (select revision from drift_finalized), true, 'Stale settings',
  'f1000000-0000-4000-0000-000000000050','f1000000-0000-4000-8000-000000000051'
);
select is((select state from drift_requeued), 'uploaded'::public.member_csv_import_state, 'settings drift requeues before confirmation');
select is((select state from public.create_member_csv_import(
  'a1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000099',repeat('a',64),
  '[{"first_name":"Replay","last_name":"Drift","invited_email":"drift-replay@example.test"}]'::jsonb,
  'f1000000-0000-4000-8000-000000000052','f1000000-0000-4000-8000-000000000053'
)), 'uploaded'::public.member_csv_import_state, 'drifted fingerprint replay is claimable instead of wedged');
select * from public.claim_member_csv_import('e1000000-0000-4000-8000-000000000010','f1000000-0000-4000-8000-000000000054',300);
select * from public.validate_member_csv_import('e1000000-0000-4000-8000-000000000010','f1000000-0000-4000-8000-000000000054');
select is((select state from public.finalize_member_csv_import_validation(
  'e1000000-0000-4000-8000-000000000010','f1000000-0000-4000-8000-000000000054','f1000000-0000-4000-8000-000000000055'
)), 'ready'::public.member_csv_import_state, 'requeued import validates under the new settings version');

-- An address that becomes pending after validation is a final skip, not a
-- poison retry: apply recomputes counters after the race is resolved.
select * from public.create_member_csv_import(
  'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-00000000000b', repeat('b',64),
  '[{"first_name":"Race","last_name":"Skip","invited_email":"race-skip@example.test"}]'::jsonb,
  'f1000000-0000-4000-8000-000000000052', 'f1000000-0000-4000-8000-000000000053'
);
select * from public.claim_member_csv_import('e1000000-0000-4000-8000-00000000000b','f1000000-0000-4000-8000-000000000054',300);
select * from public.validate_member_csv_import('e1000000-0000-4000-8000-00000000000b','f1000000-0000-4000-8000-000000000054');
create temporary table race_skip_finalized as
select * from public.finalize_member_csv_import_validation(
  'e1000000-0000-4000-8000-00000000000b','f1000000-0000-4000-8000-000000000054','f1000000-0000-4000-8000-000000000055'
);
select * from public.request_member_csv_import_apply(
  'a1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-00000000000b',
  (select revision from race_skip_finalized), true, 'Apply-time skip race',
  'f1000000-0000-4000-8000-000000000056','f1000000-0000-4000-8000-000000000057'
);
select * from public.claim_member_csv_import_apply('e1000000-0000-4000-8000-00000000000b','f1000000-0000-4000-8000-000000000058',1800);
insert into public.memberships (id, group_id, role, status)
values ('c1000000-0000-4000-8000-000000000008','b1000000-0000-4000-8000-000000000001','member','pending');
insert into public.membership_invitations (
  id, group_id, membership_id, invited_email, invited_email_normalized, role,
  token_digest_sha256, token_key_version, status, issued_at, expires_at, inviter_user_id
) values (
  'd1000000-0000-4000-8000-000000000020','b1000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000008',
  'race-skip@example.test','race-skip@example.test','member',repeat('f',64),1,'pending',now(),now()+interval '1 day',
  'a1000000-0000-4000-8000-000000000001'
);
create temporary table race_skip_applied as
select * from public.apply_member_csv_import(
  'a1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-00000000000b','f1000000-0000-4000-8000-000000000058',
  '[{"row_number":2,"invited_email":"race-skip@example.test","invitation_id":"d1000000-0000-4000-8000-000000000021","token_digest":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","token_key_version":1,"expires_at":"2099-01-01T00:00:00Z"}]'::jsonb,
  'f1000000-0000-4000-8000-000000000059','f1000000-0000-4000-8000-000000000057'
);
select is((select state from race_skip_applied), 'completed'::public.member_csv_import_state, 'apply-time conflict still completes the job');
select is((select applied_rows from race_skip_applied), 0, 'apply-time conflict creates no duplicate member');
select is((select skipped_rows from race_skip_applied), 1, 'apply-time conflict recomputes the final skipped count');

-- A malformed trusted invitation payload aborts the entire apply and leaves no
-- membership/profile/contact/quota/handicap/invitation/outbox residue.
select * from public.create_member_csv_import(
  'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000003', repeat('3',64),
  '[{"first_name":"Rollback","last_name":"Me","invited_email":"rollback@example.test","initial_quota":"10.00","use_initial_quota":true}]'::jsonb,
  'f1000000-0000-4000-8000-000000000008', 'f1000000-0000-4000-8000-000000000009'
);
select * from public.claim_member_csv_import('e1000000-0000-4000-8000-000000000003','f1000000-0000-4000-8000-000000000012',300);
select * from public.validate_member_csv_import('e1000000-0000-4000-8000-000000000003','f1000000-0000-4000-8000-000000000012');
select * from public.finalize_member_csv_import_validation('e1000000-0000-4000-8000-000000000003','f1000000-0000-4000-8000-000000000012','f1000000-0000-4000-8000-000000000010');
select * from public.request_member_csv_import_apply('a1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000003',3,true,'Rollback test','f1000000-0000-4000-8000-000000000022','f1000000-0000-4000-8000-000000000023');
select * from public.claim_member_csv_import_apply('e1000000-0000-4000-8000-000000000003','f1000000-0000-4000-8000-000000000013',1800);
select throws_ok(
  $$ select * from public.apply_member_csv_import(
    'a1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000003','f1000000-0000-4000-8000-000000000013',
    '[{"row_number":2,"invited_email":"rollback@example.test","invitation_id":"d1000000-0000-4000-8000-000000000011","token_digest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","token_key_version":1,"expires_at":"not-a-date"}]'::jsonb,
    'f1000000-0000-4000-8000-000000000011','f1000000-0000-4000-8000-000000000023'
  ) $$,
  '22007', null, 'bad expiry aborts apply'
);
select is((select state from public.member_csv_import_jobs where id = 'e1000000-0000-4000-8000-000000000003'), 'applying'::public.member_csv_import_state, 'failed apply leaves the confirmed Applying lease for stale recovery');
select is((select count(*) from public.membership_invitations where group_id = 'b1000000-0000-4000-8000-000000000001' and invited_email_normalized = 'rollback@example.test'), 0::bigint, 'failed apply creates no partial invitation or membership');

-- Invalid whole-file rejection and duplicate-in-file errors.
select * from public.create_member_csv_import(
  'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000004', repeat('4',64),
  '[{"first_name":"Bad","last_name":"Number","invited_email":"bad-number@example.test","initial_quota":"1e2","secondary_email_visible":"yes"},{"first_name":"Dup","last_name":"One","invited_email":"dup@example.test"},{"first_name":"Dup","last_name":"Two","invited_email":"DUP@example.test"}]'::jsonb,
  'f1000000-0000-4000-8000-000000000013', 'f1000000-0000-4000-8000-000000000014'
);
update public.member_csv_import_rows
set raw_payload = raw_payload
  || pg_catalog.jsonb_build_object(
    'handicap_id', repeat('H', 101),
    'handicap', '1.0',
    'handicap_as_of', '2026-07-27'
  )
where import_job_id = 'e1000000-0000-4000-8000-000000000004'
  and row_number = 2;
select * from public.claim_member_csv_import('e1000000-0000-4000-8000-000000000004','f1000000-0000-4000-8000-000000000014',300);
select * from public.validate_member_csv_import('e1000000-0000-4000-8000-000000000004','f1000000-0000-4000-8000-000000000014');
select is((select invalid_rows from public.finalize_member_csv_import_validation('e1000000-0000-4000-8000-000000000004','f1000000-0000-4000-8000-000000000014','f1000000-0000-4000-8000-000000000015')), 3, 'any invalid row rejects the whole file');
select is((select state from public.member_csv_import_jobs where id = 'e1000000-0000-4000-8000-000000000004'), 'rejected'::public.member_csv_import_state, 'invalid file is Rejected');
select ok((select not (error_codes @> '[{"code":"quota_projection_unavailable"}]'::jsonb) from public.member_csv_import_rows where import_job_id = 'e1000000-0000-4000-8000-000000000004' and row_number = 3), 'ordinary rows without quota/history are not rejected as projection errors');
select ok((select error_codes @> '[{"code":"invalid_boolean"}]'::jsonb from public.member_csv_import_rows where import_job_id = 'e1000000-0000-4000-8000-000000000004' and row_number = 2), 'visibility booleans reject non-boolean values');
select ok((select error_codes @> '[{"code":"invalid_handicap_id"}]'::jsonb from public.member_csv_import_rows where import_job_id = 'e1000000-0000-4000-8000-000000000004' and row_number = 2), 'overlong handicap identifiers are rejected before apply');
select ok((select error_codes @> '[{"code":"duplicate_in_file"}]'::jsonb from public.member_csv_import_rows where import_job_id = 'e1000000-0000-4000-8000-000000000004' and row_number = 3), 'duplicate-in-file error is recorded');

-- Same fingerprint replay returns the completed job and creates no duplicate.
select is((select state from public.create_member_csv_import(
  'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000099', repeat('2',64), '[{"first_name":"Replay","last_name":"Ignored","invited_email":"replay@example.test"}]'::jsonb,
  'f1000000-0000-4000-8000-000000000099', 'f1000000-0000-4000-8000-000000000098'
)), 'completed'::public.member_csv_import_state, 'same group/fingerprint replay returns Completed');
select is((select count(*) from public.member_csv_import_jobs where group_id = 'b1000000-0000-4000-8000-000000000001' and source_fingerprint = repeat('2',64)), 1::bigint, 'same fingerprint has one job');

-- A later settings change cannot reopen or erase a completed import.
update public.group_quota_settings
set version = version + 1
where group_id = 'b1000000-0000-4000-8000-000000000001';
select throws_ok(
  $$ select * from public.request_member_csv_import_apply(
    'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002',
    (select revision from public.member_csv_import_jobs where id = 'e1000000-0000-4000-8000-000000000002'),
    true, 'Completed import must remain immutable',
    'f1000000-0000-4000-8000-000000000076', 'f1000000-0000-4000-8000-000000000077'
  ) $$,
  '40001', 'member_csv_import_revision_changed', 'settings drift cannot requeue a completed import'
);
select is((select state from public.member_csv_import_jobs where id = 'e1000000-0000-4000-8000-000000000002'), 'completed'::public.member_csv_import_state, 'completed import state remains immutable');
select is((select applied_rows from public.member_csv_import_jobs where id = 'e1000000-0000-4000-8000-000000000002'), 1, 'completed import applied count remains immutable');

-- Lease recovery and cross-tenant denial.
select throws_ok(
  $$ select * from public.get_member_csv_import('a1000000-0000-4000-8000-000000000004','e1000000-0000-4000-8000-000000000002') $$,
  'P0002', 'member_csv_import_not_found', 'cross-group admin cannot read import results'
);
select * from public.create_member_csv_import(
  'a1000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000005', repeat('5',64),
  '[{"first_name":"Lease","last_name":"Me","invited_email":"lease@example.test"}]'::jsonb,
  'f1000000-0000-4000-8000-000000000016', 'f1000000-0000-4000-8000-000000000017'
);
select * from public.claim_member_csv_import('e1000000-0000-4000-8000-000000000005','f1000000-0000-4000-8000-000000000018',300);
update public.member_csv_import_jobs set lease_expires_at = now() - interval '1 second' where id = 'e1000000-0000-4000-8000-000000000005';
select is((select state from public.recover_stale_member_csv_import('e1000000-0000-4000-8000-000000000005','f1000000-0000-4000-8000-000000000018')), 'uploaded'::public.member_csv_import_state, 'stale validation lease recovers to Uploaded');

select * from finish();
rollback;
