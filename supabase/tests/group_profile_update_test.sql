begin;

create extension if not exists pgtap with schema extensions;

select plan(51);

select ok(
  not has_function_privilege(
    'anon',
    'public.update_group_profile(uuid,text,text,bigint,text,uuid,uuid)',
    'execute'
  ),
  'anonymous clients cannot update a group profile'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.update_group_profile(uuid,text,text,bigint,text,uuid,uuid)',
    'execute'
  ),
  'authenticated clients cannot bypass the trusted profile boundary'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.update_group_profile(uuid,text,text,bigint,text,uuid,uuid)',
    'execute'
  ),
  'the trusted server can update a group profile'
);
select ok(
  (select prosecdef from pg_catalog.pg_proc where oid = 'public.update_group_profile(uuid,text,text,bigint,text,uuid,uuid)'::regprocedure),
  'the profile mutation is a security definer'
);
select ok(
  (select proconfig = array['search_path=""'] from pg_catalog.pg_proc where oid = 'public.update_group_profile(uuid,text,text,bigint,text,uuid,uuid)'::regprocedure),
  'the profile mutation pins an empty search path'
);
select ok(
  not has_table_privilege('authenticated', 'public.groups', 'update'),
  'authenticated clients cannot update groups directly'
);
select is(
  app.safe_group_activity_state(
    'group.profile_updated',
    '{"group_version":2,"changed_fields":["name"],"request_fingerprint":"secret"}'::jsonb
  ) ->> 'kind',
  'group',
  'profile activity is redacted as a group summary'
);
select ok(
  (app.safe_group_activity_state(
    'group.profile_updated',
    '{"group_version":2,"changed_fields":["name"],"request_fingerprint":"secret"}'::jsonb
  ) ? 'request_fingerprint') is false,
  'profile activity never exposes the idempotency fingerprint'
);

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at
)
values
  ('15000000-0000-4000-8000-000000000001', 'profile-admin-a@example.test', now(), false, false, now(), now()),
  ('15000000-0000-4000-8000-000000000002', 'profile-coordinator-a@example.test', now(), false, false, now(), now()),
  ('15000000-0000-4000-8000-000000000003', 'profile-member-a@example.test', now(), false, false, now(), now()),
  ('15000000-0000-4000-8000-000000000004', 'profile-admin-b@example.test', now(), false, false, now(), now()),
  ('15000000-0000-4000-8000-000000000005', 'profile-recovery@example.test', now(), false, false, now(), now());

insert into public.user_profiles (user_id)
values
  ('15000000-0000-4000-8000-000000000001'),
  ('15000000-0000-4000-8000-000000000002'),
  ('15000000-0000-4000-8000-000000000003'),
  ('15000000-0000-4000-8000-000000000004'),
  ('15000000-0000-4000-8000-000000000005');

insert into public.groups (id, name, time_zone)
values
  ('55000000-0000-4000-8000-000000000001', 'Profile Group A', 'UTC'),
  ('55000000-0000-4000-8000-000000000002', 'Profile Group B', 'UTC');

insert into public.memberships (id, group_id, user_id, role, status, activated_at)
values
  ('65000000-0000-4000-8000-000000000001', '55000000-0000-4000-8000-000000000001', '15000000-0000-4000-8000-000000000001', 'administrator', 'active', now()),
  ('65000000-0000-4000-8000-000000000002', '55000000-0000-4000-8000-000000000001', '15000000-0000-4000-8000-000000000002', 'coordinator', 'active', now()),
  ('65000000-0000-4000-8000-000000000003', '55000000-0000-4000-8000-000000000001', '15000000-0000-4000-8000-000000000003', 'member', 'active', now()),
  ('65000000-0000-4000-8000-000000000004', '55000000-0000-4000-8000-000000000002', '15000000-0000-4000-8000-000000000004', 'administrator', 'active', now()),
  ('65000000-0000-4000-8000-000000000005', '55000000-0000-4000-8000-000000000001', '15000000-0000-4000-8000-000000000005', 'administrator', 'active', now());

select throws_ok(
  $$ select * from public.update_group_profile(
    '15000000-0000-4000-8000-000000000001', ' ', 'UTC', 1,
    'Missing name', '25000000-0000-4000-8000-000000000001', '35000000-0000-4000-8000-000000000001'
  ) $$,
  '22023', 'group_profile_name_required', 'blank group names are rejected'
);
select throws_ok(
  $$ select * from public.update_group_profile(
    '15000000-0000-4000-8000-000000000001', 'Profile Group', 'Mars/Olympus_Mons', 1,
    'Invalid zone', '25000000-0000-4000-8000-000000000002', '35000000-0000-4000-8000-000000000002'
  ) $$,
  '22023', 'group_profile_time_zone_invalid', 'unsupported time zones are rejected by the IANA domain'
);
select throws_ok(
  $$ select * from public.update_group_profile(
    '15000000-0000-4000-8000-000000000001', 'Profile Group', 'UTC', 1,
    ' ', '25000000-0000-4000-8000-000000000003', '35000000-0000-4000-8000-000000000003'
  ) $$,
  '22023', 'group_profile_reason_required', 'profile changes require a reason'
);
select throws_ok(
  $$ select * from public.update_group_profile(
    '15000000-0000-4000-8000-000000000002', 'Attacker', 'UTC', 1,
    'Coordinator attempt', '25000000-0000-4000-8000-000000000004', '35000000-0000-4000-8000-000000000004'
  ) $$,
  'P0003', 'actor_not_authorized', 'coordinators cannot update a group profile'
);
select throws_ok(
  $$ select * from public.update_group_profile(
    '15000000-0000-4000-8000-000000000003', 'Attacker', 'UTC', 1,
    'Member attempt', '25000000-0000-4000-8000-000000000005', '35000000-0000-4000-8000-000000000005'
  ) $$,
  'P0003', 'actor_not_authorized', 'members cannot update a group profile'
);

update auth.users
set raw_app_meta_data = jsonb_build_object(
  'greenroster_password_recovery', jsonb_build_object('session_id', '45000000-0000-4000-8000-000000000001')
)
where id = '15000000-0000-4000-8000-000000000005';
select throws_ok(
  $$ select * from public.update_group_profile(
    '15000000-0000-4000-8000-000000000005', 'Recovery attempt', 'UTC', 1,
    'Recovery attempt', '25000000-0000-4000-8000-000000000006', '35000000-0000-4000-8000-000000000006'
  ) $$,
  'P0003', 'recovery_session_forbidden', 'password-recovery sessions cannot update group settings'
);

create temporary table profile_result as
select * from public.update_group_profile(
  '15000000-0000-4000-8000-000000000001',
  '  Green Hills  ',
  'America/New_York',
  1,
  '  Correct the club display name  ',
  '25000000-0000-4000-8000-000000000007',
  '35000000-0000-4000-8000-000000000007'
);

select is((select updated_group_id::uuid from profile_result), '55000000-0000-4000-8000-000000000001'::uuid, 'the result identifies the actor-derived group');
select is((select updated_group_name from profile_result), 'Green Hills'::text, 'the result returns the normalized group name');
select is((select updated_group_time_zone from profile_result), 'America/New_York'::text, 'the result returns the validated IANA zone');
select is((select updated_group_version from profile_result), 2::bigint, 'the result returns the incremented group version');
select is((select name from public.groups where id = '55000000-0000-4000-8000-000000000001'), 'Green Hills'::text, 'the group name is updated atomically');
select is((select time_zone::text from public.groups where id = '55000000-0000-4000-8000-000000000001'), 'America/New_York'::text, 'the group time zone is updated atomically');
select is((select version from public.groups where id = '55000000-0000-4000-8000-000000000001'), 2::bigint, 'the group version advances exactly once');
select is((select count(*) from public.audit_events where action = 'group.profile_updated'), 1::bigint, 'a profile change writes one audit event');
select is((select reason from public.audit_events where action = 'group.profile_updated'), 'Correct the club display name'::text, 'the audit stores the normalized reason');
select is((select source from public.audit_events where action = 'group.profile_updated'), 'portal'::text, 'the audit records the portal source');
select is((select correlation_id from public.audit_events where action = 'group.profile_updated'), '25000000-0000-4000-8000-000000000007'::uuid, 'the correlation reaches the audit event');
select is((select operation_id from public.audit_events where action = 'group.profile_updated'), '35000000-0000-4000-8000-000000000007'::uuid, 'the operation id reaches the audit event');
select is((select before_state ->> 'group_version' from public.audit_events where action = 'group.profile_updated'), '1'::text, 'the audit records the prior group version');
select is((select after_state ->> 'group_version' from public.audit_events where action = 'group.profile_updated'), '2'::text, 'the audit records the committed group version');
select is((select after_state -> 'changed_fields' ->> 0 from public.audit_events where action = 'group.profile_updated'), 'name'::text, 'the audit records the changed name field');
select is((select after_state -> 'changed_fields' ->> 1 from public.audit_events where action = 'group.profile_updated'), 'time_zone'::text, 'the audit records the changed time zone field');
select is((select after_state ->> 'updated_group_name' from public.audit_events where action = 'group.profile_updated'), 'Green Hills'::text, 'the service audit retains the committed name for exact replay');
select is((select after_state ->> 'updated_group_time_zone' from public.audit_events where action = 'group.profile_updated'), 'America/New_York'::text, 'the service audit retains the committed time zone for exact replay');
select is((select name from public.groups where id = '55000000-0000-4000-8000-000000000002'), 'Profile Group B'::text, 'an actor update cannot cross into another group');
select is((select app.safe_group_activity_state('group.profile_updated', after_state) ->> 'group_version' from public.audit_events where action = 'group.profile_updated'), '2'::text, 'the safe activity summary preserves only the group version');
select ok((select app.safe_group_activity_state('group.profile_updated', after_state) -> 'changed_fields' = '["name","time_zone"]'::jsonb from public.audit_events where action = 'group.profile_updated'), 'the safe activity summary preserves changed field names');
select ok((select (app.safe_group_activity_state('group.profile_updated', after_state) ? 'request_fingerprint') is false from public.audit_events where action = 'group.profile_updated'), 'the safe activity summary excludes the raw fingerprint');

select lives_ok(
  $$ select * from public.update_group_profile(
    '15000000-0000-4000-8000-000000000001', 'Blue Hills', 'America/Chicago', 2,
    'Update the club profile again', '25000000-0000-4000-8000-000000000008', '35000000-0000-4000-8000-000000000008'
  ) $$,
  'a later profile update can advance the group after the first operation'
);
select is((select name from public.groups where id = '55000000-0000-4000-8000-000000000001'), 'Blue Hills'::text, 'the later update is the current group state');
select is((select version from public.groups where id = '55000000-0000-4000-8000-000000000001'), 3::bigint, 'the later update advances the group version once');

create temporary table profile_retry_after_second_update as
select * from public.update_group_profile(
  '15000000-0000-4000-8000-000000000001', 'Green Hills', 'America/New_York', 1,
  'Correct the club display name', '25000000-0000-4000-8000-000000000099', '35000000-0000-4000-8000-000000000007'
);
select is((select updated_group_name from profile_retry_after_second_update), 'Green Hills'::text, 'a retry returns the original committed name after a later update');
select is((select updated_group_time_zone from profile_retry_after_second_update), 'America/New_York'::text, 'a retry returns the original committed time zone after a later update');
select is((select updated_group_version from profile_retry_after_second_update), 2::bigint, 'a retry preserves the original committed version after a later update');
select is((select count(*) from public.audit_events where action = 'group.profile_updated'), 2::bigint, 'a retry after a later update does not duplicate audit');

update public.memberships
set role = 'coordinator'
where user_id = '15000000-0000-4000-8000-000000000001'
  and group_id = '55000000-0000-4000-8000-000000000001';
create temporary table profile_retry_after_demotion as
select * from public.update_group_profile(
  '15000000-0000-4000-8000-000000000001', 'Green Hills', 'America/New_York', 1,
  'Correct the club display name', '25000000-0000-4000-8000-000000000099', '35000000-0000-4000-8000-000000000007'
);
select is((select updated_group_name from profile_retry_after_demotion), 'Green Hills'::text, 'a demoted administrator can replay the exact committed name');
select is((select updated_group_time_zone from profile_retry_after_demotion), 'America/New_York'::text, 'a demoted administrator can replay the exact committed time zone');
select is((select updated_group_version from profile_retry_after_demotion), 2::bigint, 'a demoted administrator can replay the exact committed version');
select is((select count(*) from public.audit_events where action = 'group.profile_updated'), 2::bigint, 'a demoted replay does not duplicate audit');
update public.memberships
set role = 'administrator'
where user_id = '15000000-0000-4000-8000-000000000001'
  and group_id = '55000000-0000-4000-8000-000000000001';

select throws_ok(
  $$ select * from public.update_group_profile(
    '15000000-0000-4000-8000-000000000001', 'Different name', 'America/New_York', 1,
    'Reused operation', '25000000-0000-4000-8000-000000000099', '35000000-0000-4000-8000-000000000007'
  ) $$,
  '23505', 'operation_id_reused', 'an operation id cannot be reused with a different payload'
);
select throws_ok(
  $$ select * from public.update_group_profile(
    '15000000-0000-4000-8000-000000000001', 'Another name', 'America/New_York', 1,
    'Stale screen', '25000000-0000-4000-8000-000000000100', '35000000-0000-4000-8000-000000000100'
  ) $$,
  '40001', 'group_version_changed', 'a stale group version is rejected'
);
select lives_ok(
  $$ select * from public.update_group_profile(
    '15000000-0000-4000-8000-000000000004', '  Other Group Updated  ', 'UTC', 1,
    'Update own group', '25000000-0000-4000-8000-000000000101', '35000000-0000-4000-8000-000000000101'
  ) $$,
  'a second administrator can update only their own actor-derived group'
);
select is((select name from public.groups where id = '55000000-0000-4000-8000-000000000002'), 'Other Group Updated'::text, 'the second administrator update stays in its tenant');

select * from finish();

rollback;
