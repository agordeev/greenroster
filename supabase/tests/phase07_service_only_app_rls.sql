begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class
   where oid = 'app.fixture_dataset'::regclass),
  'the synthetic fixture manifest is protected by forced RLS'
);

select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class
   where oid = 'app.current_legal_documents'::regclass),
  'current legal configuration is protected by forced RLS'
);

select ok(
  not has_table_privilege('anon', 'app.fixture_dataset', 'select'),
  'anonymous clients cannot read the synthetic fixture manifest directly'
);

select ok(
  not has_table_privilege('authenticated', 'app.fixture_dataset', 'select'),
  'authenticated clients cannot read the synthetic fixture manifest directly'
);

select ok(
  not has_table_privilege('anon', 'app.current_legal_documents', 'select'),
  'anonymous clients cannot read legal configuration directly'
);

select ok(
  not has_table_privilege('authenticated', 'app.current_legal_documents', 'select'),
  'authenticated clients cannot read legal configuration directly'
);

select ok(
  not has_table_privilege('service_role', 'app.fixture_dataset', 'select'),
  'the service role has no raw fixture-manifest table grant'
);

select ok(
  not has_table_privilege('service_role', 'app.current_legal_documents', 'select'),
  'the service role has no raw legal-configuration table grant'
);

select * from finish();

rollback;
