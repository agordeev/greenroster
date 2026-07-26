create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;

insert into app.current_legal_documents (
  singleton, terms_version, privacy_version, configured_at
)
values (true, 'concurrent-terms-v1', 'concurrent-privacy-v1', now());

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at
)
values (
  '12000000-0000-4000-8000-000000000001',
  'first-run-concurrent@example.test',
  now(),
  false,
  false,
  now(),
  now()
);

insert into public.groups (id, name, time_zone)
values ('52000000-0000-4000-8000-000000000001', 'Concurrency Test', 'UTC');

insert into public.user_profiles (user_id)
values ('12000000-0000-4000-8000-000000000001');

insert into public.memberships (
  id, group_id, user_id, role, status, activated_at
)
values (
  '62000000-0000-4000-8000-000000000001',
  '52000000-0000-4000-8000-000000000001',
  '12000000-0000-4000-8000-000000000001',
  'member',
  'active',
  now()
);

select plan(3);

do $test$
begin
  perform extensions.dblink_connect(
    'first_run_c1',
    'host=supabase_db_GreenRoster port=5432 dbname=postgres user=postgres password=postgres'
  );
  perform extensions.dblink_connect(
    'first_run_c2',
    'host=supabase_db_GreenRoster port=5432 dbname=postgres user=postgres password=postgres'
  );

  perform extensions.dblink_send_query(
    'first_run_c1',
    $query$
      with request_context as materialized (
        select pg_catalog.set_config(
          'request.jwt.claim.sub',
          '12000000-0000-4000-8000-000000000001',
          false
        )
      ), profile_lock as materialized (
        select profile.user_id
        from public.user_profiles as profile
        cross join request_context
        where profile.user_id = '12000000-0000-4000-8000-000000000001'
        for update
      ), pause as materialized (
        select pg_catalog.pg_sleep(0.5)
        from profile_lock
      )
      select completion.completed_first_name
      from pause
      cross join lateral public.complete_mobile_first_run(
        'Concurrent',
        'Member',
        'concurrent-terms-v1',
        'concurrent-privacy-v1',
        '22000000-0000-4000-8000-000000000001',
        '32000000-0000-4000-8000-000000000001'
      ) as completion
    $query$
  );

  perform pg_catalog.pg_sleep(0.1);

  perform extensions.dblink_send_query(
    'first_run_c2',
    $query$
      with request_context as materialized (
        select pg_catalog.set_config(
          'request.jwt.claim.sub',
          '12000000-0000-4000-8000-000000000001',
          false
        )
      )
      select completion.completed_first_name
      from request_context
      cross join lateral public.complete_mobile_first_run(
        'Ignored',
        'Retry',
        'concurrent-terms-v1',
        'concurrent-privacy-v1',
        '22000000-0000-4000-8000-000000000099',
        '32000000-0000-4000-8000-000000000001'
      ) as completion
    $query$
  );
end;
$test$;

select results_eq(
  $$
    select completed_first_name
    from extensions.dblink_get_result('first_run_c1')
      as result(completed_first_name text)
  $$,
  $$ values ('Concurrent'::text) $$,
  'the first concurrent completion succeeds'
);

select results_eq(
  $$
    select completed_first_name
    from extensions.dblink_get_result('first_run_c2')
      as result(completed_first_name text)
  $$,
  $$ values ('Concurrent'::text) $$,
  'the concurrent duplicate returns the original successful result'
);

select is(
  (
    select count(*)
    from public.audit_events
    where actor_user_id = '12000000-0000-4000-8000-000000000001'
      and action = 'profile.first_run_completed'
      and operation_id = '32000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'concurrent retries commit exactly one audit event'
);

select * from finish();

select extensions.dblink_disconnect('first_run_c1');
select extensions.dblink_disconnect('first_run_c2');

begin;
alter table public.audit_events disable trigger audit_events_append_only;
delete from public.audit_events
where actor_user_id = '12000000-0000-4000-8000-000000000001'
  and action = 'profile.first_run_completed'
  and operation_id = '32000000-0000-4000-8000-000000000001';
alter table public.audit_events enable trigger audit_events_append_only;
delete from public.memberships
where user_id = '12000000-0000-4000-8000-000000000001';
delete from public.user_profiles
where user_id = '12000000-0000-4000-8000-000000000001';
delete from public.groups
where id = '52000000-0000-4000-8000-000000000001';
delete from auth.users
where id = '12000000-0000-4000-8000-000000000001';
delete from app.current_legal_documents;
commit;

drop extension dblink;
