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
  ('b3100000-0000-4000-8000-000000000001', 'attachment-admin@example.test', now(), false, false, now(), now()),
  ('b3100000-0000-4000-8000-000000000002', 'attachment-old@example.test', now(), false, false, now(), now());

insert into public.user_profiles (user_id)
values ('b3100000-0000-4000-8000-000000000001');

insert into public.groups (id, name, time_zone)
values ('c3100000-0000-4000-8000-000000000001', 'Account Attachment Race', 'UTC');

insert into public.memberships (
  id,
  group_id,
  user_id,
  role,
  status,
  activated_at
)
values
  ('d3100000-0000-4000-8000-000000000001', 'c3100000-0000-4000-8000-000000000001', 'b3100000-0000-4000-8000-000000000001', 'administrator', 'active', now()),
  ('d3100000-0000-4000-8000-000000000002', 'c3100000-0000-4000-8000-000000000001', null, 'member', 'pending', null),
  ('d3100000-0000-4000-8000-000000000003', 'c3100000-0000-4000-8000-000000000001', null, 'member', 'pending', null);

insert into public.membership_golfer_profiles (
  membership_id,
  group_id,
  first_name,
  last_name
)
values
  ('d3100000-0000-4000-8000-000000000002', 'c3100000-0000-4000-8000-000000000001', 'Attachment', 'Target'),
  ('d3100000-0000-4000-8000-000000000003', 'c3100000-0000-4000-8000-000000000001', 'Pending', 'Duplicate');

select * from public.issue_membership_invitation(
  'b3100000-0000-4000-8000-000000000001',
  'd3100000-0000-4000-8000-000000000002',
  'e3100000-0000-4000-8000-000000000001',
  'different-invitation@example.test',
  repeat('a', 64),
  1,
  now() + interval '1 day',
  'f3100000-0000-4000-8000-000000000001',
  'f3100000-0000-4000-8000-000000000002'
);
select * from public.issue_membership_invitation(
  'b3100000-0000-4000-8000-000000000001',
  'd3100000-0000-4000-8000-000000000003',
  'e3100000-0000-4000-8000-000000000002',
  'attachment-new@example.test',
  repeat('b', 64),
  1,
  now() + interval '1 day',
  'f3100000-0000-4000-8000-000000000003',
  'f3100000-0000-4000-8000-000000000004'
);

create function app.test_account_email_attachment_update(
  p_pause_seconds double precision
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  update auth.users
  set email = 'attachment-new@example.test',
      email_change = null,
      email_change_sent_at = null,
      email_change_token_new = null,
      email_change_confirm_status = 0,
      email_confirmed_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  where id = 'b3100000-0000-4000-8000-000000000002';

  perform pg_catalog.pg_sleep(p_pause_seconds);
  return 'updated';
exception
  when others then
    return sqlstate || ':' || sqlerrm;
end;
$$;

create function app.test_account_email_attachment_accept(
  p_pause_seconds double precision
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform *
  from public.accept_membership_invitation(
    'b3100000-0000-4000-8000-000000000002',
    'e3100000-0000-4000-8000-000000000001',
    repeat('a', 64),
    'f3100000-0000-4000-8000-000000000005',
    'f3100000-0000-4000-8000-000000000006'
  );

  perform pg_catalog.pg_sleep(p_pause_seconds);
  return 'accepted';
exception
  when others then
    return sqlstate || ':' || sqlerrm;
end;
$$;

select * from no_plan();

select extensions.dblink_connect(
  'account_attachment_race_c1',
  'host=supabase_db_GreenRoster port=5432 dbname=postgres user=postgres password=postgres'
);
select extensions.dblink_connect(
  'account_attachment_race_c2',
  'host=supabase_db_GreenRoster port=5432 dbname=postgres user=postgres password=postgres'
);

-- Auth e-mail transition first: the attachment waits for the Auth row, then
-- observes the committed new address and rejects against pending invitation B.
do $test$
begin
  perform extensions.dblink_send_query(
    'account_attachment_race_c1',
    $$ select app.test_account_email_attachment_update(0.5) $$
  );
  perform pg_catalog.pg_sleep(0.1);
  perform extensions.dblink_send_query(
    'account_attachment_race_c2',
    $$ select app.test_account_email_attachment_accept(0) $$
  );
end;
$test$;

select results_eq(
  $$
    select outcome
    from extensions.dblink_get_result('account_attachment_race_c1') as result(outcome text)
  $$,
  $$ values ('updated'::text) $$,
  'the Auth transition commits when it wins the attachment race'
);
select results_eq(
  $$
    select outcome
    from extensions.dblink_get_result('account_attachment_race_c2') as result(outcome text)
  $$,
  $$ values ('23505:invitation_email_in_use'::text) $$,
  'attachment rejects the committed new Auth e-mail when it wins the lock ordering'
);
select is(
  (select email::text from auth.users where id = 'b3100000-0000-4000-8000-000000000002'),
  'attachment-new@example.test'::text,
  'the first ordering leaves the new Auth e-mail committed'
);
select is(
  (select user_id::uuid from public.memberships where id = 'd3100000-0000-4000-8000-000000000002'),
  null::uuid,
  'the first ordering leaves the target membership unattached'
);

select extensions.dblink_disconnect('account_attachment_race_c1');
select extensions.dblink_disconnect('account_attachment_race_c2');

-- Restore the unattached identity before reversing the ordering.  No pending
-- invitation has been consumed by the rejected attachment above.
update auth.users
set email = 'attachment-old@example.test',
    updated_at = pg_catalog.now()
where id = 'b3100000-0000-4000-8000-000000000002';

select extensions.dblink_connect(
  'account_attachment_race_c1',
  'host=supabase_db_GreenRoster port=5432 dbname=postgres user=postgres password=postgres'
);
select extensions.dblink_connect(
  'account_attachment_race_c2',
  'host=supabase_db_GreenRoster port=5432 dbname=postgres user=postgres password=postgres'
);

-- Attachment first: the old e-mail does not collide with B, so attachment
-- commits. The later Auth transition then waits for the Auth row and rejects
-- against B after the membership is attached.
do $test$
begin
  perform extensions.dblink_send_query(
    'account_attachment_race_c1',
    $$ select app.test_account_email_attachment_accept(0.5) $$
  );
  perform pg_catalog.pg_sleep(0.1);
  perform extensions.dblink_send_query(
    'account_attachment_race_c2',
    $$ select app.test_account_email_attachment_update(0) $$
  );
end;
$test$;

select results_eq(
  $$
    select outcome
    from extensions.dblink_get_result('account_attachment_race_c1') as result(outcome text)
  $$,
  $$ values ('accepted'::text) $$,
  'the attachment commits when it wins the lock ordering'
);
select results_eq(
  $$
    select outcome
    from extensions.dblink_get_result('account_attachment_race_c2') as result(outcome text)
  $$,
  $$ values ('23505:invitation_email_in_use'::text) $$,
  'the later Auth transition rejects the pending invitation address'
);
select is(
  (select email::text from auth.users where id = 'b3100000-0000-4000-8000-000000000002'),
  'attachment-old@example.test'::text,
  'the second ordering leaves the old Auth e-mail after the rejected transition'
);
select is(
  (select user_id::uuid from public.memberships where id = 'd3100000-0000-4000-8000-000000000002'),
  'b3100000-0000-4000-8000-000000000002'::uuid,
  'the second ordering attaches the identity exactly once'
);
select is(
  (select status::text from public.membership_invitations where id = 'e3100000-0000-4000-8000-000000000001'),
  'accepted'::text,
  'the accepted invitation remains committed after the later Auth rejection'
);
select is(
  (select status::text from public.membership_invitations where id = 'e3100000-0000-4000-8000-000000000002'),
  'pending'::text,
  'the conflicting invitation remains pending after both orderings'
);

select extensions.dblink_disconnect('account_attachment_race_c1');
select extensions.dblink_disconnect('account_attachment_race_c2');

drop function app.test_account_email_attachment_update(double precision);
drop function app.test_account_email_attachment_accept(double precision);

begin;
delete from public.notification_deliveries
where group_id = 'c3100000-0000-4000-8000-000000000001';
delete from public.notification_outbox_jobs
where group_id = 'c3100000-0000-4000-8000-000000000001';
alter table public.audit_events disable trigger audit_events_append_only;
delete from public.audit_events
where group_id = 'c3100000-0000-4000-8000-000000000001';
alter table public.audit_events enable trigger audit_events_append_only;
alter table public.identity_security_audit_events
disable trigger identity_security_audit_events_append_only;
delete from public.identity_security_audit_events
where user_id = 'b3100000-0000-4000-8000-000000000002';
alter table public.identity_security_audit_events
enable trigger identity_security_audit_events_append_only;
delete from public.membership_invitations
where group_id = 'c3100000-0000-4000-8000-000000000001';
delete from public.membership_golfer_profiles
where group_id = 'c3100000-0000-4000-8000-000000000001';
alter table public.memberships disable trigger memberships_protect_last_active_administrator;
delete from public.memberships
where group_id = 'c3100000-0000-4000-8000-000000000001';
alter table public.memberships enable trigger memberships_protect_last_active_administrator;
delete from public.user_profiles
where user_id in (
  'b3100000-0000-4000-8000-000000000001',
  'b3100000-0000-4000-8000-000000000002'
);
delete from public.groups
where id = 'c3100000-0000-4000-8000-000000000001';
delete from auth.users
where id in (
  'b3100000-0000-4000-8000-000000000001',
  'b3100000-0000-4000-8000-000000000002'
);
commit;

select * from finish();
