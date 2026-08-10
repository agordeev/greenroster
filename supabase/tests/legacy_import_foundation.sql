begin;

create extension if not exists pgtap with schema extensions;
select plan(27);

select has_table('public', 'legacy_import_jobs', 'legacy import jobs are persisted');
select has_table('public', 'legacy_import_rows', 'legacy import rows are persisted');
select has_table('public', 'legacy_import_crosswalk', 'legacy key decisions are persisted');
select has_table('public', 'legacy_import_exceptions', 'legacy import exceptions are persisted');

select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class
   where oid = 'public.legacy_import_jobs'::regclass),
  'legacy import jobs use force RLS'
);
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class
   where oid = 'public.legacy_import_rows'::regclass),
  'legacy import rows use force RLS'
);
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class
   where oid = 'public.legacy_import_crosswalk'::regclass),
  'legacy crosswalks use force RLS'
);
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class
   where oid = 'public.legacy_import_exceptions'::regclass),
  'legacy exceptions use force RLS'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_indexes
    where schemaname = 'public'
      and indexname = 'legacy_import_crosswalk_key_idx'
      and indexdef like '%(import_job_id, group_id, source_profile, legacy_type, legacy_key)%'
  ),
  'legacy key uniqueness is scoped to the import job'
);
select ok(
  pg_catalog.pg_get_functiondef(
    'public.create_legacy_import_job(uuid,uuid,text,text,text,jsonb,jsonb,uuid,uuid)'::pg_catalog.regprocedure
  ) like '%crosswalk.import_job_id = row.import_job_id%',
  'staging maps rows only through the current job crosswalk'
);
select ok(
  pg_catalog.pg_get_functiondef(
    'public.get_legacy_import_job(uuid,uuid)'::pg_catalog.regprocedure
  ) like '%crosswalk.import_job_id = row.import_job_id%',
  'job projection maps rows only through the current job crosswalk'
);
select ok(
  pg_catalog.pg_get_functiondef(
    'public.set_legacy_import_mapping(uuid,uuid,uuid,text,text,uuid,text,text,bigint,uuid,uuid)'::pg_catalog.regprocedure
  ) like '%crosswalk.import_job_id = job.id%',
  'mapping decisions select only the requested job crosswalk'
);

select ok(
  not has_table_privilege('authenticated', 'public.legacy_import_jobs', 'select')
  and not has_table_privilege('authenticated', 'public.legacy_import_rows', 'select')
  and not has_table_privilege('authenticated', 'public.legacy_import_crosswalk', 'select')
  and not has_table_privilege('authenticated', 'public.legacy_import_exceptions', 'select'),
  'browser roles cannot read staged legacy data directly'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.create_legacy_import_job(uuid,uuid,text,text,text,jsonb,jsonb,uuid,uuid)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.get_legacy_import_job(uuid,uuid)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.set_legacy_import_mapping(uuid,uuid,uuid,text,text,uuid,text,text,bigint,uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.create_legacy_import_job(uuid,uuid,text,text,text,jsonb,jsonb,uuid,uuid)',
    'execute'
  ),
  'only the trusted server receives legacy import authority'
);

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at
)
values (
  '91000000-0000-4000-8000-000000000081',
  'legacy-import-admin@example.test',
  now(), false, false, now(), now()
);
insert into public.user_profiles (user_id)
values ('91000000-0000-4000-8000-000000000081');
insert into public.groups (id, name, time_zone)
values ('92000000-0000-4000-8000-000000000081', 'Legacy Import Group', 'UTC');
insert into public.memberships (
  id, group_id, user_id, role, status, activated_at
)
values (
  '93000000-0000-4000-8000-000000000081',
  '92000000-0000-4000-8000-000000000081',
  '91000000-0000-4000-8000-000000000081',
  'administrator', 'active', now()
);

-- The trusted RPC is called through the service role in production, but the
-- test inspects its private tables as the database owner. Direct table access
-- is intentionally not granted to service_role (asserted below).
set local role postgres;
select * from public.create_legacy_import_job(
  '91000000-0000-4000-8000-000000000081',
  '94000000-0000-4000-8000-000000000081',
  'golfdogfight-export',
  '2026-08',
  repeat('a', 64),
  '[{"row_number":2,"legacy_type":"member","legacy_key":"m-1","payload":{"first_name":"Alex","password":"do-not-stage"}}]'::jsonb,
  '[]'::jsonb,
  '95000000-0000-4000-8000-000000000081',
  '96000000-0000-4000-8000-000000000081'
);

select is(
  (select count(*)::integer
   from public.legacy_import_rows
   where import_job_id = '94000000-0000-4000-8000-000000000081'),
  1,
  'one staged source row is retained'
);
select ok(
  (select not (payload ? 'password')
   from public.legacy_import_rows
   where import_job_id = '94000000-0000-4000-8000-000000000081'),
  'sensitive payload keys are redacted before staging'
);
select is(
  (select payload ->> 'first_name'
   from public.legacy_import_rows
   where import_job_id = '94000000-0000-4000-8000-000000000081'),
  'Alex',
  'safe mapped values remain available to the trusted worker'
);
select is(
  (select count(*)::integer
   from public.audit_events
   where action = 'legacy_import.staged'
     and operation_id = '96000000-0000-4000-8000-000000000081'),
  1,
  'staging writes one audit event'
);
select is(
  (select import_job_id
   from public.create_legacy_import_job(
     '91000000-0000-4000-8000-000000000081',
     '94000000-0000-4000-8000-000000000099',
     'golfdogfight-export',
     '2026-08',
     repeat('a', 64),
     '[{"row_number":2,"legacy_type":"member","legacy_key":"m-1","payload":{"first_name":"Alex","password":"do-not-stage"}}]'::jsonb,
     '[]'::jsonb,
     '95000000-0000-4000-8000-000000000099',
     '96000000-0000-4000-8000-000000000099'
   )),
  '94000000-0000-4000-8000-000000000081'::app.entity_id,
  'the source fingerprint replays the original job'
);
select is(
  (select count(*)::integer
   from public.audit_events
   where action = 'legacy_import.staged'
     and group_id = '92000000-0000-4000-8000-000000000081'),
  1,
  'a fingerprint replay does not write a second audit event'
);

-- A corrected export gets a new replay fingerprint and an independent
-- crosswalk row even when it repeats the same legacy key.
select * from public.create_legacy_import_job(
  '91000000-0000-4000-8000-000000000081',
  '94000000-0000-4000-8000-000000000082',
  'golfdogfight-export',
  '2026-08',
  repeat('b', 64),
  '[{"row_number":2,"legacy_type":"member","legacy_key":"m-1","payload":{"first_name":"Alexandra"}}]'::jsonb,
  '[]'::jsonb,
  '95000000-0000-4000-8000-000000000082',
  '96000000-0000-4000-8000-000000000082'
);
select is(
  (select count(*)::integer
   from public.legacy_import_crosswalk
   where group_id = '92000000-0000-4000-8000-000000000081'
     and source_profile = 'golfdogfight-export'
     and legacy_type = 'member'
     and legacy_key = 'm-1'),
  2,
  'corrected exports preserve independent job crosswalk evidence'
);
select is(
  (select count(*)::integer
   from public.get_legacy_import_job(
     '91000000-0000-4000-8000-000000000081',
     '94000000-0000-4000-8000-000000000082'
   )),
  1,
  'job projection returns only rows from the requested export'
);
select is(
  (select legacy_key
   from public.get_legacy_import_job(
     '91000000-0000-4000-8000-000000000081',
     '94000000-0000-4000-8000-000000000082'
   )),
  'm-1',
  'job projection keeps the legacy key without exposing payload'
);

select * from public.set_legacy_import_mapping(
  '91000000-0000-4000-8000-000000000081',
  '94000000-0000-4000-8000-000000000082',
  (select id from public.legacy_import_rows
   where import_job_id = '94000000-0000-4000-8000-000000000082'),
  'matched',
  'member',
  '97000000-0000-4000-8000-000000000081',
  'deterministic',
  'The approved identity decision matches this member.',
  2,
  '95000000-0000-4000-8000-000000000083',
  '96000000-0000-4000-8000-000000000083'
);
select is(
  (select mapping_state::text
   from public.legacy_import_crosswalk
   where import_job_id = '94000000-0000-4000-8000-000000000082'),
  'matched',
  'mapping updates only the requested job crosswalk'
);
select is(
  (select mapping_state::text
   from public.legacy_import_crosswalk
   where import_job_id = '94000000-0000-4000-8000-000000000081'),
  'pending',
  'mapping never mutates a prior export crosswalk'
);
select * from public.set_legacy_import_mapping(
  '91000000-0000-4000-8000-000000000081',
  '94000000-0000-4000-8000-000000000082',
  (select id from public.legacy_import_rows
   where import_job_id = '94000000-0000-4000-8000-000000000082'),
  'matched',
  'member',
  '97000000-0000-4000-8000-000000000081',
  'deterministic',
  'The approved identity decision matches this member.',
  2,
  '95000000-0000-4000-8000-000000000083',
  '96000000-0000-4000-8000-000000000083'
);
select is(
  (select count(*)::integer
   from public.audit_events
   where action = 'legacy_import.mapping_set'
     and operation_id = '96000000-0000-4000-8000-000000000083'),
  1,
  'mapping replay is idempotent'
);

select throws_ok(
  $$ select * from public.get_legacy_import_job(
    '91000000-0000-4000-8000-000000000081',
    '94000000-0000-4000-8000-000000000099'
  ) $$,
  'P0002',
  'legacy_import_not_found',
  'an actor cannot read a job it does not own'
);

reset role;
select * from finish();
rollback;
