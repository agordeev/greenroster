create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;

insert into auth.users (
  id,
  email,
  encrypted_password,
  email_confirmed_at,
  is_sso_user,
  is_anonymous,
  created_at,
  updated_at
)
values (
  '17000000-0000-4000-8000-000000000001',
  'atomic-concurrency@example.test',
  'old-concurrent-hash',
  now(),
  false,
  false,
  now(),
  now()
);

insert into public.password_recovery_sessions (
  session_id,
  user_id,
  expires_at,
  claim_id,
  claimed_at,
  reset_operation_id
)
values (
  '27000000-0000-4000-8000-000000000001',
  '17000000-0000-4000-8000-000000000001',
  now() + interval '10 minutes',
  '37000000-0000-4000-8000-000000000001',
  now(),
  '47000000-0000-4000-8000-000000000001'
);

select plan(5);

do $test$
begin
  perform extensions.dblink_connect(
    'recovery_atomic_c1',
    'host=supabase_db_GreenRoster port=5432 dbname=postgres user=postgres password=postgres'
  );
  perform extensions.dblink_connect(
    'recovery_atomic_c2',
    'host=supabase_db_GreenRoster port=5432 dbname=postgres user=postgres password=postgres'
  );

  perform extensions.dblink_send_query(
    'recovery_atomic_c1',
    $query$
      with password_change as materialized (
        update auth.users
        set encrypted_password = 'new-concurrent-hash',
            raw_app_meta_data = pg_catalog.jsonb_build_object(
              'greenroster_password_recovery',
              pg_catalog.jsonb_build_object(
                'session_id', '27000000-0000-4000-8000-000000000001',
                'claim_id', '37000000-0000-4000-8000-000000000001',
                'operation_id', '47000000-0000-4000-8000-000000000001'
              )
            )
        where id = '17000000-0000-4000-8000-000000000001'
        returning id
      ), pause as materialized (
        select pg_catalog.pg_sleep(0.5)
        from password_change
      )
      select count(*)::bigint from pause
    $query$
  );
  perform pg_catalog.pg_sleep(0.1);
  perform extensions.dblink_send_query(
    'recovery_atomic_c2',
    $query$
      select public.release_password_recovery_claim(
        '27000000-0000-4000-8000-000000000001',
        '17000000-0000-4000-8000-000000000001',
        '37000000-0000-4000-8000-000000000001'
      )
    $query$
  );
end;
$test$;

select results_eq(
  $$
    select changed_rows
    from extensions.dblink_get_result('recovery_atomic_c1')
      as result(changed_rows bigint)
  $$,
  $$ values (1::bigint) $$,
  'the Auth password transaction commits while holding the identity lock'
);

select results_eq(
  $$
    select released
    from extensions.dblink_get_result('recovery_atomic_c2')
      as result(released boolean)
  $$,
  $$ values (false) $$,
  'a concurrent release waits and cannot clear a committed recovery'
);

select ok(
  (
    select consumed_at is not null
      and consumed_correlation_id = '47000000-0000-4000-8000-000000000001'
    from public.password_recovery_sessions
    where session_id = '27000000-0000-4000-8000-000000000001'
  ),
  'the serialized password transaction consumes the stable operation'
);

select is(
  (
    select count(*)
    from public.identity_security_audit_events
    where user_id = '17000000-0000-4000-8000-000000000001'
      and operation_id = '47000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'the concurrent completion appends exactly one identity audit event'
);

select is(
  (
    select encrypted_password
    from auth.users
    where id = '17000000-0000-4000-8000-000000000001'
  )::text,
  'new-concurrent-hash'::text,
  'the committed password hash is retained'
);

select * from finish();

select extensions.dblink_disconnect('recovery_atomic_c1');
select extensions.dblink_disconnect('recovery_atomic_c2');

begin;
alter table public.identity_security_audit_events
disable trigger identity_security_audit_events_append_only;
delete from public.identity_security_audit_events
where user_id = '17000000-0000-4000-8000-000000000001';
alter table public.identity_security_audit_events
enable trigger identity_security_audit_events_append_only;
delete from public.password_recovery_sessions
where session_id = '27000000-0000-4000-8000-000000000001';
delete from auth.users
where id = '17000000-0000-4000-8000-000000000001';
commit;

drop extension dblink;
