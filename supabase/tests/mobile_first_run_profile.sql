begin;

create extension if not exists pgtap with schema extensions;

select plan(37);

select has_table('app', 'current_legal_documents', 'current legal document configuration exists');
select ok(
  not has_table_privilege('anon', 'app.current_legal_documents', 'select'),
  'anonymous clients cannot read legal configuration directly'
);
select ok(
  not has_table_privilege('authenticated', 'app.current_legal_documents', 'select'),
  'authenticated clients cannot read legal configuration directly'
);
select ok(
  not has_function_privilege('anon', 'public.resolve_mobile_first_run()', 'execute'),
  'anonymous clients cannot resolve a profile'
);
select ok(
  has_function_privilege('authenticated', 'public.resolve_mobile_first_run()', 'execute'),
  'authenticated clients can resolve their constrained first-run state'
);
select ok(
  not has_function_privilege('anon', 'public.complete_mobile_first_run(text,text,text,text,uuid,uuid)', 'execute'),
  'anonymous clients cannot complete first run'
);
select ok(
  has_function_privilege('authenticated', 'public.complete_mobile_first_run(text,text,text,text,uuid,uuid)', 'execute'),
  'authenticated clients can call the constrained first-run mutation'
);

insert into app.current_legal_documents (
  singleton, terms_version, privacy_version, configured_at
)
values (
  true,
  'synthetic-terms-v1',
  'synthetic-privacy-v1',
  '2026-01-01 00:00:02+00'
);

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at
)
values
  ('11000000-0000-4000-8000-000000000001', 'first-run-a@example.test', now(), false, false, now(), now()),
  ('11000000-0000-4000-8000-000000000002', 'first-run-b@example.test', now(), false, false, now(), now()),
  ('11000000-0000-4000-8000-000000000003', 'inactive@example.test', now(), false, false, now(), now());

insert into public.groups (id, name, time_zone)
values
  ('51000000-0000-4000-8000-000000000001', 'First Run A', 'UTC'),
  ('51000000-0000-4000-8000-000000000002', 'First Run B', 'UTC');

insert into public.user_profiles (user_id)
values
  ('11000000-0000-4000-8000-000000000001'),
  ('11000000-0000-4000-8000-000000000002'),
  ('11000000-0000-4000-8000-000000000003');

insert into public.memberships (
  id, group_id, user_id, role, status, activated_at, inactivated_at
)
values
  ('61000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'administrator', 'active', now(), null),
  ('61000000-0000-4000-8000-000000000002', '51000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000002', 'member', 'active', now(), null),
  ('61000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000003', 'member', 'inactive', null, now());

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000001', true);

select is(
  (select current_terms_version from public.resolve_mobile_first_run()),
  'synthetic-terms-v1'::text,
  'the server returns its configured current Terms version'
);
select is(
  (select current_privacy_version from public.resolve_mobile_first_run()),
  'synthetic-privacy-v1'::text,
  'the server returns its configured current Privacy version'
);
select is(
  (select is_complete from public.resolve_mobile_first_run()),
  false,
  'a blank profile requires first-run completion'
);
select is(
  (select count(*) from public.resolve_mobile_first_run()),
  1::bigint,
  'an active identity resolves exactly its own first-run state'
);
select throws_ok(
  $$ select * from public.complete_mobile_first_run(' ', 'Member', 'synthetic-terms-v1', 'synthetic-privacy-v1', '21000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001') $$,
  '22023',
  'profile_names_required',
  'blank names are rejected by the server'
);
select is(
  (select count(*) from public.audit_events where action = 'profile.first_run_completed'),
  0::bigint,
  'a rejected completion writes no audit event'
);
select throws_ok(
  $$ select * from public.complete_mobile_first_run('Alice', 'Admin', 'stale-terms-v0', 'synthetic-privacy-v1', '21000000-0000-4000-8000-000000000005', '31000000-0000-4000-8000-000000000005') $$,
  '40001',
  'legal_document_versions_changed',
  'the server rejects acceptance when a displayed legal version is stale'
);
select ok(
  (select accepted_terms_at is null and accepted_privacy_at is null from public.user_profiles where user_id = '11000000-0000-4000-8000-000000000001'),
  'a stale legal precondition changes no profile state'
);
select lives_ok(
  $$ select * from public.complete_mobile_first_run('  Alice  ', '  Admin  ', 'synthetic-terms-v1', 'synthetic-privacy-v1', '21000000-0000-4000-8000-000000000002', '31000000-0000-4000-8000-000000000002') $$,
  'an active member can complete first run'
);
select is(
  (select first_name from public.user_profiles where user_id = '11000000-0000-4000-8000-000000000001'),
  'Alice'::text,
  'the server normalizes the first name'
);
select is(
  (select last_name from public.user_profiles where user_id = '11000000-0000-4000-8000-000000000001'),
  'Admin'::text,
  'the server normalizes the last name'
);
select is(
  (select display_name from public.user_profiles where user_id = '11000000-0000-4000-8000-000000000001'),
  'Alice Admin'::text,
  'the server derives the display name'
);
select is(
  (select accepted_terms_version from public.user_profiles where user_id = '11000000-0000-4000-8000-000000000001'),
  'synthetic-terms-v1'::text,
  'the client cannot nominate the accepted Terms version'
);
select is(
  (select accepted_privacy_version from public.user_profiles where user_id = '11000000-0000-4000-8000-000000000001'),
  'synthetic-privacy-v1'::text,
  'the client cannot nominate the accepted Privacy version'
);
select ok(
  (select accepted_terms_at is not null and accepted_privacy_at is not null from public.user_profiles where user_id = '11000000-0000-4000-8000-000000000001'),
  'acceptance timestamps come from the server transaction'
);
select is(
  (select is_complete from public.resolve_mobile_first_run()),
  true,
  'the stored profile satisfies the current first-run contract'
);
select is(
  (select correlation_id from public.audit_events where action = 'profile.first_run_completed'),
  '21000000-0000-4000-8000-000000000002'::uuid,
  'the client correlation identifier reaches the audit event'
);
select is(
  (select source from public.audit_events where action = 'profile.first_run_completed'),
  'mobile'::text,
  'the audit identifies the mobile source'
);
select is(
  (select before_state ->> 'complete' from public.audit_events where action = 'profile.first_run_completed'),
  'false'::text,
  'the audit preserves the incomplete pre-mutation state'
);
select ok(
  (select not (after_state ? 'first_name') and not (after_state ? 'last_name') from public.audit_events where action = 'profile.first_run_completed'),
  'the audit does not duplicate profile names'
);
select lives_ok(
  $$ select * from public.complete_mobile_first_run('Ignored', 'Retry', 'stale-terms', 'stale-privacy', '21000000-0000-4000-8000-000000000099', '31000000-0000-4000-8000-000000000002') $$,
  'a lost completion response is safe to retry'
);
select is(
  (select count(*) from public.audit_events where action = 'profile.first_run_completed'),
  1::bigint,
  'an idempotent retry writes no duplicate audit event'
);
select is(
  (select first_name from public.user_profiles where user_id = '11000000-0000-4000-8000-000000000001'),
  'Alice'::text,
  'an idempotent retry does not apply a changed payload'
);

select pg_catalog.set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000002', true);
select is(
  (select first_name from public.resolve_mobile_first_run()),
  null::text,
  'another tenant sees only its own blank profile'
);
select lives_ok(
  $$ select * from public.complete_mobile_first_run('Bob', 'Member', 'synthetic-terms-v1', 'synthetic-privacy-v1', '21000000-0000-4000-8000-000000000003', '31000000-0000-4000-8000-000000000003') $$,
  'another tenant completes only its own profile'
);
select is(
  (select first_name from public.user_profiles where user_id = '11000000-0000-4000-8000-000000000001'),
  null::text,
  'RLS prevents the second tenant from reading the first profile directly'
);
reset role;
select is(
  (select group_id from public.audit_events where actor_user_id = '11000000-0000-4000-8000-000000000002'),
  '51000000-0000-4000-8000-000000000002'::app.entity_id,
  'the server derives the second tenant audit group from membership'
);

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000003', true);
select is(
  (select count(*) from public.resolve_mobile_first_run()),
  0::bigint,
  'inactive membership resolves no first-run data'
);
select throws_ok(
  $$ select * from public.complete_mobile_first_run('Inactive', 'Member', 'synthetic-terms-v1', 'synthetic-privacy-v1', '21000000-0000-4000-8000-000000000004', '31000000-0000-4000-8000-000000000004') $$,
  'P0002',
  'identity_context_unavailable',
  'inactive membership cannot complete first run'
);

reset role;
delete from app.current_legal_documents;
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$ select * from public.resolve_mobile_first_run() $$,
  'P0001',
  'legal_document_versions_unavailable',
  'missing deployment legal configuration fails fast'
);

select * from finish();

rollback;
