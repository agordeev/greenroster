begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

select has_function(
  'public',
  'resolve_group_roles_activity',
  array['uuid','text','uuid','integer','timestamptz','uuid'],
  'group roles and activity projection exists'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.resolve_group_roles_activity(uuid,text,uuid,integer,timestamptz,uuid)',
    'execute'
  ),
  'service role can execute the protected group roles/activity projection'
);
select ok(
  not has_function_privilege('anon', 'public.resolve_group_roles_activity(uuid,text,uuid,integer,timestamptz,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.resolve_group_roles_activity(uuid,text,uuid,integer,timestamptz,uuid)', 'execute'),
  'anonymous and authenticated clients cannot execute the projection'
);

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at
)
values
  ('ba000000-0000-4000-8000-000000000001', 'activity-admin@example.test', now(), false, false, now(), now()),
  ('ba000000-0000-4000-8000-000000000002', 'activity-coordinator@example.test', now(), false, false, now(), now()),
  ('ba000000-0000-4000-8000-000000000003', 'activity-member@example.test', now(), false, false, now(), now()),
  ('ba000000-0000-4000-8000-000000000004', 'activity-other@example.test', now(), false, false, now(), now()),
  ('ba000000-0000-4000-8000-000000000005', 'activity-recovery@example.test', now(), false, false, now(), now());

update auth.users
set raw_app_meta_data = jsonb_build_object('greenroster_password_recovery', jsonb_build_object('session_id', 'bf000000-0000-4000-8000-000000000001'))
where id = 'ba000000-0000-4000-8000-000000000005';

insert into public.user_profiles (user_id, display_name, first_name, last_name)
values
  ('ba000000-0000-4000-8000-000000000001', 'Activity Admin', 'Activity', 'Admin'),
  ('ba000000-0000-4000-8000-000000000002', 'Activity Coordinator', 'Activity', 'Coordinator'),
  ('ba000000-0000-4000-8000-000000000003', 'Activity Member', 'Activity', 'Member'),
  ('ba000000-0000-4000-8000-000000000004', 'Other Admin', 'Other', 'Admin'),
  ('ba000000-0000-4000-8000-000000000005', 'Recovery Admin', 'Recovery', 'Admin');

insert into public.groups (id, name, time_zone)
values
  ('bc000000-0000-4000-8000-000000000001', 'Activity Group', 'America/Chicago'),
  ('bc000000-0000-4000-8000-000000000002', 'Other Group', 'UTC');

insert into public.memberships (
  id, group_id, user_id, role, status, activated_at, inactivated_at
)
values
  ('bd000000-0000-4000-8000-000000000001', 'bc000000-0000-4000-8000-000000000001', 'ba000000-0000-4000-8000-000000000001', 'administrator', 'active', now(), null),
  ('bd000000-0000-4000-8000-000000000002', 'bc000000-0000-4000-8000-000000000001', 'ba000000-0000-4000-8000-000000000002', 'coordinator', 'active', now(), null),
  ('bd000000-0000-4000-8000-000000000003', 'bc000000-0000-4000-8000-000000000001', 'ba000000-0000-4000-8000-000000000003', 'member', 'active', now(), null),
  ('bd000000-0000-4000-8000-000000000004', 'bc000000-0000-4000-8000-000000000002', 'ba000000-0000-4000-8000-000000000004', 'administrator', 'active', now(), null),
  ('bd000000-0000-4000-8000-000000000005', 'bc000000-0000-4000-8000-000000000001', 'ba000000-0000-4000-8000-000000000005', 'administrator', 'active', now(), null);

insert into public.membership_golfer_profiles (membership_id, group_id, first_name, last_name)
values
  ('bd000000-0000-4000-8000-000000000001', 'bc000000-0000-4000-8000-000000000001', 'Activity', 'Admin'),
  ('bd000000-0000-4000-8000-000000000002', 'bc000000-0000-4000-8000-000000000001', 'Activity', 'Coordinator');

insert into public.membership_invitations (
  id, group_id, membership_id, invited_email, invited_email_normalized,
  role, token_digest_sha256, token_key_version, status, issued_at, expires_at,
  inviter_user_id, version
)
values (
  'be000000-0000-4000-8000-000000000001',
  'bc000000-0000-4000-8000-000000000001',
  'bd000000-0000-4000-8000-000000000002',
  'activity-coordinator@example.test', 'activity-coordinator@example.test',
  'coordinator', repeat('a', 64), 1, 'pending',
  '2026-07-01T00:00:00Z', '2099-07-01T00:00:00Z',
  'ba000000-0000-4000-8000-000000000001', 1
);

insert into public.audit_events (
  id, group_id, actor_user_id, action, target_type, target_id, target_version,
  before_state, after_state, source, correlation_id, operation_id, reason, occurred_at
)
values
  ('bf000000-0000-4000-8000-000000000001', 'bc000000-0000-4000-8000-000000000001', 'ba000000-0000-4000-8000-000000000001',
   'membership.role_changed', 'membership', 'bd000000-0000-4000-8000-000000000002', 2,
   '{"membership_id":"bd000000-0000-4000-8000-000000000002","membership_version":1,"role":"member","status":"active","request_fingerprint":"SECRET"}',
   '{"membership_id":"bd000000-0000-4000-8000-000000000002","membership_version":2,"role":"coordinator","status":"active","request_fingerprint":"SECRET"}',
   'portal', 'c0000000-0000-4000-8000-000000000001', null, 'Role promotion', '2026-07-27T12:00:00Z'),
  ('bf000000-0000-4000-8000-000000000002', 'bc000000-0000-4000-8000-000000000001', 'ba000000-0000-4000-8000-000000000001',
   'member.updated', 'membership', 'bd000000-0000-4000-8000-000000000003', 2,
   '{"membership_id":"bd000000-0000-4000-8000-000000000003","secondary_email":"private@example.test","address_line1":"1 Secret Way"}',
   '{"membership_id":"bd000000-0000-4000-8000-000000000003","membership_version":2,"status":"active","role":"member","profile_version":3,"contact_version":4,"profile_fields":{},"contact_fields":{},"visibility":{}}',
   'portal', 'c0000000-0000-4000-8000-000000000002', null, 'Private correction', '2026-07-27T11:00:00Z'),
  ('bf000000-0000-4000-8000-000000000003', 'bc000000-0000-4000-8000-000000000001', 'ba000000-0000-4000-8000-000000000001',
   'membership.invitation_issued', 'membership_invitation', 'be000000-0000-4000-8000-000000000001', 1,
   null,
   '{"invitation_id":"be000000-0000-4000-8000-000000000001","membership_id":"bd000000-0000-4000-8000-000000000002","status":"pending","role":"coordinator","token_key_version":1,"invited_email":"private@example.test"}',
   'server', 'c0000000-0000-4000-8000-000000000003', null, 'Invitation issued', '2026-07-27T10:00:00Z'),
  ('bf000000-0000-4000-8000-000000000004', 'bc000000-0000-4000-8000-000000000001', 'ba000000-0000-4000-8000-000000000001',
   'group.quota_rules_configured', 'group_quota_settings', 'bc000000-0000-4000-8000-000000000001', 4,
   null,
   '{"version":4,"bands":[{"lower_bound":0,"upper_bound":10}],"method":"moving_average"}',
   'server', 'c0000000-0000-4000-8000-000000000004', null, 'Quota settings', '2026-07-27T09:00:00Z'),
  ('bf000000-0000-4000-8000-000000000005', 'bc000000-0000-4000-8000-000000000001', 'ba000000-0000-4000-8000-000000000002',
   'member.self_profile_updated', 'membership', 'bd000000-0000-4000-8000-000000000002', 1,
   null,
   '{"membership_id":"bd000000-0000-4000-8000-000000000002","membership_version":1,"profile_version":2,"contact_version":2,"request_fingerprint":"SECRET"}',
   'mobile', 'c0000000-0000-4000-8000-000000000005', null, null, '2026-07-27T08:00:00Z'),
  ('bf000000-0000-4000-8000-000000000006', 'bc000000-0000-4000-8000-000000000001', 'ba000000-0000-4000-8000-000000000002',
   'member.handicap_changed', 'membership', 'bd000000-0000-4000-8000-000000000002', 2,
   '{"membership_id":"bd000000-0000-4000-8000-000000000002","membership_version":1,"current_record_id":"bf000000-0000-4000-8000-000000000011","current_handicap_id":"H-41","current_handicap":"8.80","current_source":"manual","current_as_of":"2026-07-20","current_created_at":"2026-07-20T08:01:00Z"}',
   '{"membership_id":"bd000000-0000-4000-8000-000000000002","membership_version":2,"handicap_record_id":"bf000000-0000-4000-8000-000000000009","handicap_id":"H-42","handicap":"8.40","source":"manual","as_of":"2026-07-27","created_at":"2026-07-27T08:01:00Z"}',
   'mobile', 'c0000000-0000-4000-8000-000000000006', null, 'Handicap update', '2026-07-27T07:00:00Z'),
  ('bf000000-0000-4000-8000-000000000008', 'bc000000-0000-4000-8000-000000000001', 'ba000000-0000-4000-8000-000000000001',
   'membership.administrator_transferred', 'group', 'bc000000-0000-4000-8000-000000000001', 2,
   '{"group_version":1,"previous_administrator":{"membership_id":"bd000000-0000-4000-8000-000000000001","role":"administrator"},"replacement":{"membership_id":"bd000000-0000-4000-8000-000000000002","role":"coordinator"}}',
   '{"group_version":2,"previous_administrator":{"membership_id":"bd000000-0000-4000-8000-000000000001","role":"coordinator"},"replacement":{"membership_id":"bd000000-0000-4000-8000-000000000002","role":"administrator"}}',
   'portal', 'c0000000-0000-4000-8000-000000000008', null, 'Administrator handoff', '2026-07-27T08:30:00Z'),
  ('bf000000-0000-4000-8000-000000000010', 'bc000000-0000-4000-8000-000000000001', 'ba000000-0000-4000-8000-000000000001',
   'member.status_changed', 'membership', 'bd000000-0000-4000-8000-000000000003', 3,
   '{"membership_id":"bd000000-0000-4000-8000-000000000003","membership_version":2,"status":"active","role":"member","inactivated_at":false}',
   '{"membership_id":"bd000000-0000-4000-8000-000000000003","membership_version":3,"status":"inactive","role":"member","inactivated_at":"2026-07-27T06:30:00Z","cancelled_notification_count":1}',
   'portal', 'c0000000-0000-4000-8000-000000000010', null, 'Member requested leave', '2026-07-27T06:30:00Z'),
  ('bf000000-0000-4000-8000-000000000011', 'bc000000-0000-4000-8000-000000000001', 'ba000000-0000-4000-8000-000000000003',
   'profile.first_run_completed', 'user_profile', 'ba000000-0000-4000-8000-000000000003', null,
   '{"complete":false}', '{"complete":true,"terms_version":"2026-01","privacy_version":"2026-01"}',
   'mobile', 'c0000000-0000-4000-8000-000000000011', null, null, '2026-07-27T06:15:00Z'),
  ('bf000000-0000-4000-8000-000000000012', 'bc000000-0000-4000-8000-000000000001', 'ba000000-0000-4000-8000-000000000003',
   'identity.password_recovered', 'user', 'ba000000-0000-4000-8000-000000000003', null,
   null, '{"recovery_session_consumed":true}',
   'server', 'c0000000-0000-4000-8000-000000000012', null, null, '2026-07-27T06:00:00Z'),
  ('bf000000-0000-4000-8000-000000000007', 'bc000000-0000-4000-8000-000000000002', 'ba000000-0000-4000-8000-000000000004',
   'member.updated', 'membership', 'bd000000-0000-4000-8000-000000000004', 2,
   null, '{"membership_id":"bd000000-0000-4000-8000-000000000004","status":"active"}',
   'portal', 'c0000000-0000-4000-8000-000000000007', null, null, '2026-07-27T06:00:00Z');

create temporary table activity_admin on commit drop as
select public.resolve_group_roles_activity(
  'ba000000-0000-4000-8000-000000000001', null, null, 20, null, null
) as payload;

select is((select payload->'group'->>'group_id' from activity_admin), 'bc000000-0000-4000-8000-000000000001', 'group is actor-derived');
select is((select payload->'group'->>'time_zone' from activity_admin), 'America/Chicago', 'group timezone is returned');
select is(jsonb_array_length((select payload->'roles' from activity_admin)), 3, 'administrators and coordinators are listed');
select is((select row->>'invitation_state' from activity_admin, jsonb_array_elements(payload->'roles') row where row->>'membership_id' = 'bd000000-0000-4000-8000-000000000002'), 'pending', 'role row includes invitation state');
select ok((select payload::text from activity_admin) not like '%activity-coordinator@example.test%', 'role projection does not expose account or invitation e-mail');
select ok((select payload::text from activity_admin) not like '%SECRET%' and (select payload::text from activity_admin) not like '%private@example.test%' and (select payload::text from activity_admin) not like '%Secret Way%', 'safe summaries redact raw audit values and fingerprints');
select ok((select payload::text from activity_admin) like '%group.quota_rules_configured%', 'administrator sees administrator-only activity');
select is((select payload->'activity'->'items'->0->'after'->>'summary_available' from activity_admin), 'true', 'known action receives a safe summary');
select is((select payload->'activity'->'items'->0->'after'->>'role' from activity_admin), 'coordinator', 'role summary exposes only the changed role');
select is(
  (
    select item->'before'->>'inactivated_at'
    from activity_admin, jsonb_array_elements(payload->'activity'->'items') as item
    where item->>'event_id' = 'bf000000-0000-4000-8000-000000000010'
  ),
  null,
  'legacy boolean inactivation state is not misrepresented as a timestamp'
);
select is(
  (
    select item->'after'->>'inactivated_at'
    from activity_admin, jsonb_array_elements(payload->'activity'->'items') as item
    where item->>'event_id' = 'bf000000-0000-4000-8000-000000000010'
  ),
  '2026-07-27T06:30:00Z',
  'status activity exposes the safe inactivation timestamp'
);
select is(
  (
    select item->'before'->>'handicap'
    from activity_admin, jsonb_array_elements(payload->'activity'->'items') as item
    where item->>'event_id' = 'bf000000-0000-4000-8000-000000000006'
  ),
  '8.80',
  'handicap activity preserves the prior safe value'
);
select is(
  (
    select item->'after'->>'handicap'
    from activity_admin, jsonb_array_elements(payload->'activity'->'items') as item
    where item->>'event_id' = 'bf000000-0000-4000-8000-000000000006'
  ),
  '8.40',
  'handicap activity preserves the new safe value'
);

create temporary table activity_page_one on commit drop as
select public.resolve_group_roles_activity('ba000000-0000-4000-8000-000000000001', null, null, 2, null, null) as payload;
select is(jsonb_array_length((select payload->'activity'->'items' from activity_page_one)), 2, 'activity limit returns the requested page size');
select is((select payload->'activity'->>'has_more' from activity_page_one), 'true', 'activity page reports more rows');
create temporary table activity_page_two on commit drop as
select public.resolve_group_roles_activity(
  'ba000000-0000-4000-8000-000000000001', null, null, 2,
  ((select payload->'activity'->'next_cursor'->>'occurred_at' from activity_page_one))::timestamptz,
  ((select payload->'activity'->'next_cursor'->>'event_id' from activity_page_one))::uuid
) as payload;
select ok(
  not exists (
    select 1
    from jsonb_array_elements((select payload->'activity'->'items' from activity_page_one)) first_page
    join jsonb_array_elements((select payload->'activity'->'items' from activity_page_two)) second_page
      on first_page->>'event_id' = second_page->>'event_id'
  ),
  'keyset page cursor does not repeat rows'
);
select is((select payload->'activity'->'items'->0->>'event_id' from activity_page_two), 'bf000000-0000-4000-8000-000000000003', 'keyset cursor resumes at the first omitted event');

select is(
  jsonb_array_length((select public.resolve_group_roles_activity('ba000000-0000-4000-8000-000000000001', 'membership', 'bd000000-0000-4000-8000-000000000002', 20, null, null)->'activity'->'items')),
  5,
  'membership filter includes invitation and administrator-transfer events for the replacement membership'
);
select is(
  jsonb_array_length((select public.resolve_group_roles_activity('ba000000-0000-4000-8000-000000000001', 'membership', 'bd000000-0000-4000-8000-000000000001', 20, null, null)->'activity'->'items')),
  1,
  'membership filter includes administrator-transfer events for the previous administrator'
);
select is(
  jsonb_array_length((select public.resolve_group_roles_activity('ba000000-0000-4000-8000-000000000001', 'membership', 'bd000000-0000-4000-8000-000000000003', 20, null, null)->'activity'->'items')),
  4,
  'membership filter maps profile and identity activity through the tenant membership'
);
select is(
  jsonb_array_length((select public.resolve_group_roles_activity('ba000000-0000-4000-8000-000000000001', 'membership', 'bd000000-0000-4000-8000-000000000004', 20, null, null)->'activity'->'items')),
  0,
  'cross-group guessed membership target returns no activity'
);

create temporary table activity_coordinator on commit drop as
select public.resolve_group_roles_activity('ba000000-0000-4000-8000-000000000002', null, null, 20, null, null) as payload;
select ok((select payload::text from activity_coordinator) not like '%group.quota_rules_configured%', 'coordinator is denied administrator-only settings activity');
select ok((select payload::text from activity_coordinator) like '%member.self_profile_updated%' and (select payload::text from activity_coordinator) like '%member.handicap_changed%', 'coordinator sees current operational self-profile and handicap activity');
select ok((select payload::text from activity_coordinator) not like '%ba000000-0000-4000-8000-000000000001%', 'activity payload never exposes actor Auth IDs');
select ok(
  (select payload::text from activity_admin) not like '%ba000000-0000-4000-8000-000000000003%'
  and (
    select count(*)
    from activity_admin, jsonb_array_elements(payload->'activity'->'items') as item
    where item->>'action' in ('profile.first_run_completed', 'identity.password_recovered')
      and item->'target'->>'type' = 'membership'
      and item->'target'->>'id' = 'bd000000-0000-4000-8000-000000000003'
  ) = 2,
  'profile and identity targets expose the tenant membership ID instead of the Auth user ID'
);
select ok(
  not has_table_privilege('authenticated', 'public.audit_events', 'select')
  and not has_table_privilege('anon', 'public.audit_events', 'select'),
  'raw audit rows are not directly readable by application roles'
);

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', 'ba000000-0000-4000-8000-000000000005', true);
select throws_ok(
  $$ select * from public.audit_events $$,
  '42501',
  null,
  'a recovery-session administrator cannot bypass the safe activity projection'
);
reset role;

select throws_ok(
  $$ select public.resolve_group_roles_activity('ba000000-0000-4000-8000-000000000003', null, null, 20, null, null) $$,
  'P0003', 'actor_not_authorized', 'ordinary member cannot read the role/activity projection'
);
select throws_ok(
  $$ select public.resolve_group_roles_activity('ba000000-0000-4000-8000-000000000005', null, null, 20, null, null) $$,
  'P0003', 'recovery_session_forbidden', 'recovery-only actor cannot read the projection'
);
select throws_ok(
  $$ select public.resolve_group_roles_activity('ba000000-0000-4000-8000-000000000001', 'bad type!', null, 20, null, null) $$,
  '22023', 'activity_target_type_invalid', 'target entity type is strictly validated'
);
select throws_ok(
  $$ select public.resolve_group_roles_activity('ba000000-0000-4000-8000-000000000001', 'membership', null, 20, now(), null) $$,
  '22023', 'activity_cursor_incomplete', 'seek cursor requires both timestamp and event id'
);

select * from finish();
rollback;
