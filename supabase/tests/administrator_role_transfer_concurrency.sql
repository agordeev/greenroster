create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at
)
values
  ('14000000-0000-4000-8000-000000000001', 'concurrent-admin-a@example.test', now(), false, false, now(), now()),
  ('14000000-0000-4000-8000-000000000002', 'concurrent-admin-b@example.test', now(), false, false, now(), now()),
  ('14000000-0000-4000-8000-000000000003', 'concurrent-transfer-actor@example.test', now(), false, false, now(), now()),
  ('14000000-0000-4000-8000-000000000004', 'concurrent-transfer-replacement@example.test', now(), false, false, now(), now());

insert into public.user_profiles (user_id)
values
  ('14000000-0000-4000-8000-000000000001'),
  ('14000000-0000-4000-8000-000000000002'),
  ('14000000-0000-4000-8000-000000000003'),
  ('14000000-0000-4000-8000-000000000004');

insert into public.groups (id, name, time_zone)
values
  ('54000000-0000-4000-8000-000000000001', 'Concurrent Administrators', 'UTC'),
  ('54000000-0000-4000-8000-000000000002', 'Concurrent Transfer', 'UTC');

insert into public.memberships (
  id, group_id, user_id, role, status, activated_at
)
values
  ('64000000-0000-4000-8000-000000000001', '54000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000001', 'administrator', 'active', now()),
  ('64000000-0000-4000-8000-000000000002', '54000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000002', 'administrator', 'active', now()),
  ('64000000-0000-4000-8000-000000000003', '54000000-0000-4000-8000-000000000002', '14000000-0000-4000-8000-000000000003', 'administrator', 'active', now()),
  ('64000000-0000-4000-8000-000000000004', '54000000-0000-4000-8000-000000000002', '14000000-0000-4000-8000-000000000004', 'member', 'active', now());

create function app.test_concurrent_administrator_demotion(
  p_membership_id uuid,
  p_pause_seconds double precision
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.memberships
  set role = 'coordinator'
  where id = p_membership_id;

  perform pg_catalog.pg_sleep(p_pause_seconds);
  return 'committed';
exception
  when others then
    return sqlstate || ':' || sqlerrm;
end;
$$;

select plan(8);

do $test$
begin
  perform extensions.dblink_connect(
    'admin_demotion_c1',
    'host=supabase_db_GreenRoster port=5432 dbname=postgres user=postgres password=postgres'
  );
  perform extensions.dblink_connect(
    'admin_demotion_c2',
    'host=supabase_db_GreenRoster port=5432 dbname=postgres user=postgres password=postgres'
  );

  perform extensions.dblink_send_query(
    'admin_demotion_c1',
    $$ select app.test_concurrent_administrator_demotion('64000000-0000-4000-8000-000000000001', 0.5) $$
  );
  perform pg_catalog.pg_sleep(0.1);
  perform extensions.dblink_send_query(
    'admin_demotion_c2',
    $$ select app.test_concurrent_administrator_demotion('64000000-0000-4000-8000-000000000002', 0) $$
  );
end;
$test$;

select results_eq(
  $$
    select outcome
    from extensions.dblink_get_result('admin_demotion_c1') as result(outcome text)
  $$,
  $$ values ('committed'::text) $$,
  'the first concurrent demotion commits while another administrator exists'
);

select results_eq(
  $$
    select outcome
    from extensions.dblink_get_result('admin_demotion_c2') as result(outcome text)
  $$,
  $$ values ('P0001:last_active_administrator'::text) $$,
  'the serialized concurrent demotion rejects removal of the remaining administrator'
);

select is(
  (
    select count(*)
    from public.memberships
    where group_id = '54000000-0000-4000-8000-000000000001'
      and role = 'administrator'
      and status = 'active'
  ),
  1::bigint,
  'concurrent privileged writes cannot leave a group without an administrator'
);

select is(
  (
    select count(*)
    from public.memberships
    where group_id = '54000000-0000-4000-8000-000000000001'
      and role = 'coordinator'
      and status = 'active'
  ),
  1::bigint,
  'exactly one of the concurrent demotions changes state'
);

select extensions.dblink_disconnect('admin_demotion_c1');
select extensions.dblink_disconnect('admin_demotion_c2');
select extensions.dblink_connect(
  'admin_demotion_c1',
  'host=supabase_db_GreenRoster port=5432 dbname=postgres user=postgres password=postgres'
);
select extensions.dblink_connect(
  'admin_demotion_c2',
  'host=supabase_db_GreenRoster port=5432 dbname=postgres user=postgres password=postgres'
);

do $test$
begin
  perform extensions.dblink_send_query(
    'admin_demotion_c1',
    $query$
      with group_lock as materialized (
        select id
        from public.groups
        where id = '54000000-0000-4000-8000-000000000002'
        for update
      ), pause as materialized (
        select pg_catalog.pg_sleep(0.5)
        from group_lock
      )
      select transfer.group_version
      from pause
      cross join lateral public.transfer_group_administrator(
        '14000000-0000-4000-8000-000000000003',
        '64000000-0000-4000-8000-000000000004',
        1,
        true,
        'Concurrent transfer',
        '24000000-0000-4000-8000-000000000001',
        '34000000-0000-4000-8000-000000000001'
      ) as transfer
    $query$
  );
  perform pg_catalog.pg_sleep(0.1);
  perform extensions.dblink_send_query(
    'admin_demotion_c2',
    $query$
      select group_version
      from public.transfer_group_administrator(
        '14000000-0000-4000-8000-000000000003',
        '64000000-0000-4000-8000-000000000004',
        1,
        true,
        'Concurrent transfer retry',
        '24000000-0000-4000-8000-000000000099',
        '34000000-0000-4000-8000-000000000001'
      )
    $query$
  );
end;
$test$;

select results_eq(
  $$
    select group_version
    from extensions.dblink_get_result('admin_demotion_c1')
      as result(group_version bigint)
  $$,
  $$ values (2::bigint) $$,
  'the first concurrent transfer returns the committed group version'
);

select results_eq(
  $$
    select group_version
    from extensions.dblink_get_result('admin_demotion_c2')
      as result(group_version bigint)
  $$,
  $$ values (2::bigint) $$,
  'the concurrent duplicate reconciles the original committed result'
);

select is(
  (
    select count(*)
    from public.audit_events
    where actor_user_id = '14000000-0000-4000-8000-000000000003'
      and action = 'membership.administrator_transferred'
      and operation_id = '34000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'concurrent transfer retries commit exactly one audit event'
);

select is(
  (
    select version
    from public.groups
    where id = '54000000-0000-4000-8000-000000000002'
  ),
  2::bigint,
  'concurrent transfer retries advance the aggregate version once'
);

select * from finish();

select extensions.dblink_disconnect('admin_demotion_c1');
select extensions.dblink_disconnect('admin_demotion_c2');

drop function app.test_concurrent_administrator_demotion(uuid, double precision);

begin;
alter table public.audit_events disable trigger audit_events_append_only;
delete from public.audit_events
where actor_user_id = '14000000-0000-4000-8000-000000000003'
  and action = 'membership.administrator_transferred'
  and operation_id = '34000000-0000-4000-8000-000000000001';
alter table public.audit_events enable trigger audit_events_append_only;
alter table public.memberships disable trigger memberships_protect_last_active_administrator;
delete from public.memberships
where group_id in (
  '54000000-0000-4000-8000-000000000001',
  '54000000-0000-4000-8000-000000000002'
);
alter table public.memberships enable trigger memberships_protect_last_active_administrator;
delete from public.user_profiles
where user_id in (
  '14000000-0000-4000-8000-000000000001',
  '14000000-0000-4000-8000-000000000002',
  '14000000-0000-4000-8000-000000000003',
  '14000000-0000-4000-8000-000000000004'
);
delete from public.groups
where id in (
  '54000000-0000-4000-8000-000000000001',
  '54000000-0000-4000-8000-000000000002'
);
delete from auth.users
where id in (
  '14000000-0000-4000-8000-000000000001',
  '14000000-0000-4000-8000-000000000002',
  '14000000-0000-4000-8000-000000000003',
  '14000000-0000-4000-8000-000000000004'
);
commit;

drop extension dblink;
