create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;

insert into auth.users (
  id,
  email,
  email_confirmed_at,
  is_sso_user,
  is_anonymous,
  created_at,
  updated_at
)
values
  ('b3000000-0000-4000-8000-000000000001', 'race-admin@example.test', now(), false, false, now(), now()),
  ('b3000000-0000-4000-8000-000000000002', 'race-old@example.test', now(), false, false, now(), now());

insert into public.user_profiles (user_id)
values
  ('b3000000-0000-4000-8000-000000000001'),
  ('b3000000-0000-4000-8000-000000000002');

insert into public.groups (id, name, time_zone)
values ('c3000000-0000-4000-8000-000000000001', 'Account E-mail Race', 'UTC');

insert into public.memberships (
  id,
  group_id,
  user_id,
  role,
  status,
  activated_at
)
values
  ('d3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001', 'b3000000-0000-4000-8000-000000000001', 'administrator', 'active', now()),
  ('d3000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000001', 'b3000000-0000-4000-8000-000000000002', 'member', 'active', now()),
  ('d3000000-0000-4000-8000-000000000003', 'c3000000-0000-4000-8000-000000000001', null, 'member', 'pending', null);

insert into public.membership_golfer_profiles (
  membership_id,
  group_id,
  first_name,
  last_name
)
values (
  'd3000000-0000-4000-8000-000000000003',
  'c3000000-0000-4000-8000-000000000001',
  'Race',
  'Target'
);

create function app.test_account_email_race_issue_invitation(
  p_pause_seconds double precision
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform group_row.id
  from public.groups as group_row
  where group_row.id = 'c3000000-0000-4000-8000-000000000001'
  for update;

  perform pg_catalog.pg_sleep(p_pause_seconds);

  perform *
  from public.issue_membership_invitation(
    'b3000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000003',
    'e3000000-0000-4000-8000-000000000001',
    'race-new@example.test',
    repeat('a', 64),
    1,
    pg_catalog.now() + interval '1 day',
    'f3000000-0000-4000-8000-000000000001',
    'f3000000-0000-4000-8000-000000000002'
  );

  return 'issued';
exception
  when others then
    return sqlstate || ':' || sqlerrm;
end;
$$;

create function app.test_account_email_race_update()
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  update auth.users
  set email = 'race-new@example.test',
      email_change = null,
      email_change_sent_at = null,
      email_change_token_new = null,
      email_change_confirm_status = 0,
      email_confirmed_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  where id = 'b3000000-0000-4000-8000-000000000002';

  return 'updated';
exception
  when others then
    return sqlstate || ':' || sqlerrm;
end;
$$;

select plan(7);

select extensions.dblink_connect(
  'account_email_race_c1',
  'host=supabase_db_GreenRoster port=5432 dbname=postgres user=postgres password=postgres'
);
select extensions.dblink_connect(
  'account_email_race_c2',
  'host=supabase_db_GreenRoster port=5432 dbname=postgres user=postgres password=postgres'
);

do $test$
begin
  -- Invitation issuance holds the group lock while the Auth update reaches
  -- the trigger. The trigger must wait, then reject the now-pending address.
  perform extensions.dblink_send_query(
    'account_email_race_c1',
    $$ select app.test_account_email_race_issue_invitation(0.5) $$
  );
  perform pg_catalog.pg_sleep(0.1);
  perform extensions.dblink_send_query(
    'account_email_race_c2',
    $$ select app.test_account_email_race_update() $$
  );
end;
$test$;

select results_eq(
  $$
    select outcome
    from extensions.dblink_get_result('account_email_race_c1') as result(outcome text)
  $$,
  $$ values ('issued'::text) $$,
  'the invitation side of the account e-mail race commits'
);
select results_eq(
  $$
    select outcome
    from extensions.dblink_get_result('account_email_race_c2') as result(outcome text)
  $$,
  $$ values ('23505:invitation_email_in_use'::text) $$,
  'the concurrent Auth e-mail transition rejects the pending invitation address'
);
select is(
  (select email::text from auth.users where id = 'b3000000-0000-4000-8000-000000000002'),
  'race-old@example.test'::text,
  'the rejected Auth side leaves the old e-mail in place'
);
select is(
  (select count(*) from public.membership_invitations where id = 'e3000000-0000-4000-8000-000000000001'),
  1::bigint,
  'the race creates exactly one pending invitation'
);
select is(
  (select invited_email::text from public.membership_invitations where id = 'e3000000-0000-4000-8000-000000000001'),
  'race-new@example.test'::text,
  'the committed invitation owns the contested normalized address'
);
select is(
  (select count(*) from public.audit_events where actor_user_id = 'b3000000-0000-4000-8000-000000000002' and action = 'account.email_changed'),
  0::bigint,
  'the rejected Auth side appends no account e-mail audit'
);
select is(
  (select count(*) from auth.users where email = 'race-new@example.test'),
  0::bigint,
  'the race leaves no duplicate Auth account e-mail'
);

select extensions.dblink_disconnect('account_email_race_c1');
select extensions.dblink_disconnect('account_email_race_c2');

drop function app.test_account_email_race_update();
drop function app.test_account_email_race_issue_invitation(double precision);

begin;
delete from public.notification_deliveries
where group_id = 'c3000000-0000-4000-8000-000000000001';
delete from public.notification_outbox_jobs
where group_id = 'c3000000-0000-4000-8000-000000000001';
alter table public.audit_events disable trigger audit_events_append_only;
delete from public.audit_events
where group_id = 'c3000000-0000-4000-8000-000000000001';
alter table public.audit_events enable trigger audit_events_append_only;
delete from public.membership_invitations
where group_id = 'c3000000-0000-4000-8000-000000000001';
delete from public.membership_golfer_profiles
where membership_id = 'd3000000-0000-4000-8000-000000000003';
alter table public.memberships disable trigger memberships_protect_last_active_administrator;
delete from public.memberships
where group_id = 'c3000000-0000-4000-8000-000000000001';
alter table public.memberships enable trigger memberships_protect_last_active_administrator;
delete from public.user_profiles
where user_id in (
  'b3000000-0000-4000-8000-000000000001',
  'b3000000-0000-4000-8000-000000000002'
);
delete from public.groups
where id = 'c3000000-0000-4000-8000-000000000001';
delete from auth.users
where id in (
  'b3000000-0000-4000-8000-000000000001',
  'b3000000-0000-4000-8000-000000000002'
);
commit;

select * from finish();
