create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at
) values
  ('1c000000-0000-4000-8000-000000000001','csv-race-actor@example.test',now(),false,false,now(),now()),
  ('1c000000-0000-4000-8000-000000000002','csv-race-admin@example.test',now(),false,false,now(),now());
insert into public.user_profiles (user_id) values
  ('1c000000-0000-4000-8000-000000000001'),
  ('1c000000-0000-4000-8000-000000000002');
insert into public.groups (id, name, time_zone)
values ('5c000000-0000-4000-8000-000000000001','CSV Authorization Race','UTC');
insert into public.memberships (id, group_id, user_id, role, status, activated_at) values
  ('6c000000-0000-4000-8000-000000000001','5c000000-0000-4000-8000-000000000001','1c000000-0000-4000-8000-000000000001','administrator','active',now()),
  ('6c000000-0000-4000-8000-000000000002','5c000000-0000-4000-8000-000000000001','1c000000-0000-4000-8000-000000000002','administrator','active',now());

create function app.test_revoke_csv_import_actor(p_pause_seconds double precision)
returns text language plpgsql security definer set search_path = '' as $$
begin
  perform group_row.id from public.groups as group_row
  where group_row.id = '5c000000-0000-4000-8000-000000000001' for update;
  update public.memberships set role = 'member'
  where id = '6c000000-0000-4000-8000-000000000001';
  perform pg_catalog.pg_sleep(p_pause_seconds);
  return 'committed';
exception when others then
  return sqlstate || ':' || sqlerrm;
end;
$$;

create function app.test_create_csv_import_after_revocation()
returns text language plpgsql security definer set search_path = '' as $$
begin
  perform * from public.create_member_csv_import(
    '1c000000-0000-4000-8000-000000000001','ec000000-0000-4000-8000-000000000001',repeat('c',64),
    '[{"first_name":"Race","last_name":"Create","invited_email":"race-create@example.test"}]'::jsonb,
    'fc000000-0000-4000-8000-000000000001','fc000000-0000-4000-8000-000000000002'
  );
  return 'created';
exception when others then
  return sqlstate || ':' || sqlerrm;
end;
$$;

create function app.test_request_csv_apply_after_revocation()
returns text language plpgsql security definer set search_path = '' as $$
begin
  perform * from public.request_member_csv_import_apply(
    '1c000000-0000-4000-8000-000000000001','ec000000-0000-4000-8000-000000000002',3,true,
    'Authorization race','fc000000-0000-4000-8000-000000000011','fc000000-0000-4000-8000-000000000012'
  );
  return 'requested';
exception when others then
  return sqlstate || ':' || sqlerrm;
end;
$$;

select plan(7);
select extensions.dblink_connect('csv_auth_c1','host=supabase_db_GreenRoster port=5432 dbname=postgres user=postgres password=postgres');
select extensions.dblink_connect('csv_auth_c2','host=supabase_db_GreenRoster port=5432 dbname=postgres user=postgres password=postgres');

do $test$
begin
  perform extensions.dblink_send_query('csv_auth_c1',$$ select app.test_revoke_csv_import_actor(0.5) $$);
  perform pg_catalog.pg_sleep(0.1);
  perform extensions.dblink_send_query('csv_auth_c2',$$ select app.test_create_csv_import_after_revocation() $$);
end;
$test$;
select results_eq(
  $$ select outcome from extensions.dblink_get_result('csv_auth_c1') as result(outcome text) $$,
  $$ values ('committed'::text) $$,
  'the concurrent role revocation commits'
);
select results_eq(
  $$ select outcome from extensions.dblink_get_result('csv_auth_c2') as result(outcome text) $$,
  $$ values ('P0003:actor_not_authorized'::text) $$,
  'upload rechecks authorization after the group lock'
);
select is((select count(*) from public.member_csv_import_jobs where id = 'ec000000-0000-4000-8000-000000000001'),0::bigint,'revoked upload creates no job');

select extensions.dblink_disconnect('csv_auth_c1');
select extensions.dblink_disconnect('csv_auth_c2');
select extensions.dblink_connect('csv_auth_c1','host=supabase_db_GreenRoster port=5432 dbname=postgres user=postgres password=postgres');
select extensions.dblink_connect('csv_auth_c2','host=supabase_db_GreenRoster port=5432 dbname=postgres user=postgres password=postgres');

update public.memberships set role = 'administrator'
where id = '6c000000-0000-4000-8000-000000000001';
select * from public.create_member_csv_import(
  '1c000000-0000-4000-8000-000000000001','ec000000-0000-4000-8000-000000000002',repeat('d',64),
  '[{"first_name":"Race","last_name":"Confirm","invited_email":"race-confirm@example.test"}]'::jsonb,
  'fc000000-0000-4000-8000-000000000003','fc000000-0000-4000-8000-000000000004'
);
select * from public.claim_member_csv_import('ec000000-0000-4000-8000-000000000002','fc000000-0000-4000-8000-000000000005',300);
select * from public.validate_member_csv_import('ec000000-0000-4000-8000-000000000002','fc000000-0000-4000-8000-000000000005');
select * from public.finalize_member_csv_import_validation(
  'ec000000-0000-4000-8000-000000000002','fc000000-0000-4000-8000-000000000005','fc000000-0000-4000-8000-000000000006'
);
select is((select state from public.member_csv_import_jobs where id = 'ec000000-0000-4000-8000-000000000002'),'ready'::public.member_csv_import_state,'confirmation race fixture is Ready');

do $test$
begin
  perform extensions.dblink_send_query('csv_auth_c1',$$ select app.test_revoke_csv_import_actor(0.5) $$);
  perform pg_catalog.pg_sleep(0.1);
  perform extensions.dblink_send_query('csv_auth_c2',$$ select app.test_request_csv_apply_after_revocation() $$);
end;
$test$;
select results_eq(
  $$ select outcome from extensions.dblink_get_result('csv_auth_c1') as result(outcome text) $$,
  $$ values ('committed'::text) $$,
  'the confirmation-race role revocation commits'
);
select results_eq(
  $$ select outcome from extensions.dblink_get_result('csv_auth_c2') as result(outcome text) $$,
  $$ values ('P0003:actor_not_authorized'::text) $$,
  'apply confirmation rechecks authorization after the group lock'
);
select is((select state from public.member_csv_import_jobs where id = 'ec000000-0000-4000-8000-000000000002'),'ready'::public.member_csv_import_state,'revoked confirmation leaves the job Ready');

select * from finish();
select extensions.dblink_disconnect('csv_auth_c1');
select extensions.dblink_disconnect('csv_auth_c2');

drop function app.test_request_csv_apply_after_revocation();
drop function app.test_create_csv_import_after_revocation();
drop function app.test_revoke_csv_import_actor(double precision);

begin;
delete from public.member_csv_import_rows where import_job_id = 'ec000000-0000-4000-8000-000000000002';
delete from public.member_csv_import_jobs where id = 'ec000000-0000-4000-8000-000000000002';
alter table public.audit_events disable trigger audit_events_append_only;
delete from public.audit_events where group_id = '5c000000-0000-4000-8000-000000000001';
alter table public.audit_events enable trigger audit_events_append_only;
alter table public.memberships disable trigger memberships_protect_last_active_administrator;
delete from public.memberships where group_id = '5c000000-0000-4000-8000-000000000001';
alter table public.memberships enable trigger memberships_protect_last_active_administrator;
delete from public.user_profiles where user_id in (
  '1c000000-0000-4000-8000-000000000001','1c000000-0000-4000-8000-000000000002'
);
delete from public.groups where id = '5c000000-0000-4000-8000-000000000001';
delete from auth.users where id in (
  '1c000000-0000-4000-8000-000000000001','1c000000-0000-4000-8000-000000000002'
);
commit;
