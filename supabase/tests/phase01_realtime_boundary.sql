begin;

create extension if not exists pgtap with schema extensions;

select plan(6);

select ok(
  exists (
    select 1
    from pg_catalog.pg_publication
    where pubname = 'supabase_realtime'
  ),
  'the local Supabase Realtime publication exists'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename in (
        'groups',
        'memberships',
        'user_profiles',
        'audit_events',
        'password_recovery_sessions',
        'password_recovery_intents',
        'identity_security_audit_events'
      )
  ),
  0::bigint,
  'Phase 01 tenant tables expose no change stream to any subscription role'
);

select ok(
  not has_table_privilege('authenticated', 'public.memberships', 'insert,update,delete'),
  'all authenticated membership roles lack direct membership mutation privileges'
);
select ok(
  not has_table_privilege('authenticated', 'public.groups', 'insert,update,delete'),
  'all authenticated membership roles lack direct group mutation privileges'
);
select ok(
  not has_table_privilege('authenticated', 'public.audit_events', 'insert,update,delete'),
  'all authenticated membership roles lack direct audit mutation privileges'
);
select ok(
  not has_table_privilege('anon', 'public.groups', 'select,insert,update,delete'),
  'anonymous clients have no tenant group table privileges'
);

select * from finish();

rollback;
