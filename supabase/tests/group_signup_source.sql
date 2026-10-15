begin;

create extension if not exists pgtap with schema extensions;

select plan(6);

insert into app.current_legal_documents (singleton, terms_version, privacy_version)
values (true, 'synthetic-terms-v1', 'synthetic-privacy-v1')
on conflict (singleton) do update
set terms_version = excluded.terms_version,
    privacy_version = excluded.privacy_version;

insert into auth.users (id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at)
values
  ('1d000000-0000-4000-8000-000000000001', 'signup-source-calculator@example.test',
   now(), false, false, now(), now()),
  ('1d000000-0000-4000-8000-000000000002', 'signup-source-direct@example.test',
   now(), false, false, now(), now()),
  ('1d000000-0000-4000-8000-000000000003', 'signup-source-invalid@example.test',
   now(), false, false, now(), now());

create temporary table calculator_signup as
select * from public.bootstrap_organizer(
  '1d000000-0000-4000-8000-000000000001', 'Cal', 'Culator',
  'Calculator Group', 'UTC',
  '2d000000-0000-4000-8000-000000000001', '3d000000-0000-4000-8000-000000000001',
  'quota-calculator'
);

create temporary table direct_signup as
select * from public.bootstrap_organizer(
  '1d000000-0000-4000-8000-000000000002', 'Dee', 'Rect',
  'Direct Group', 'UTC',
  '2d000000-0000-4000-8000-000000000002', '3d000000-0000-4000-8000-000000000002'
);

select is(
  (select signup_source from public.groups
   where id = (select created_group_id from calculator_signup)),
  'quota-calculator',
  'a group started from the calculator records where the organizer came from'
);
select is(
  (select signup_source from public.groups
   where id = (select created_group_id from direct_signup)),
  null,
  'a group started from a direct visit records no source'
);
select is(
  (select after_state ->> 'signup_source' from public.audit_events
   where action = 'group.organizer_signup'
     and group_id = (select created_group_id from calculator_signup)),
  'quota-calculator',
  'the signup audit event carries the source'
);

select throws_ok(
  $$ select * from public.bootstrap_organizer(
    '1d000000-0000-4000-8000-000000000003', 'In', 'Valid',
    'Invalid Source Group', 'UTC',
    '2d000000-0000-4000-8000-000000000003', '3d000000-0000-4000-8000-000000000003',
    'https://example.test/?q=1'
  ) $$,
  '23514',
  null,
  'a source that is not a short slug is rejected'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.bootstrap_organizer(uuid, text, text, text, text, uuid, uuid, text)',
    'execute'
  ),
  'signed-in members cannot call organizer signup directly'
);
select is(
  (select count(*)::integer from pg_catalog.pg_proc
   where proname = 'bootstrap_organizer'
     and pronamespace = 'public'::regnamespace),
  1,
  'only the new organizer signup signature remains'
);

select * from finish();

rollback;
