begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

select has_function(
  'public',
  'resolve_mobile_member_self_profile',
  array[]::text[],
  'actor-derived self-profile projection exists'
);
select has_function(
  'public',
  'update_mobile_member_self_profile',
  array['text','text','text','text','text','text','text','text','text','text','text','text','text','text','text','boolean','boolean','boolean','boolean','boolean','bigint','bigint','bigint','text','uuid','uuid'],
  'actor-derived self-profile mutation exists'
);
select has_function(
  'public',
  'set_mobile_member_self_handicap',
  array['text','app.handicap_value','date','bigint','boolean','text','uuid','uuid'],
  'actor-derived self-handicap mutation exists'
);
select ok(
  has_function_privilege('authenticated', 'public.resolve_mobile_member_self_profile()', 'execute')
  and has_function_privilege('authenticated', 'public.update_mobile_member_self_profile(text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,boolean,boolean,boolean,boolean,boolean,bigint,bigint,bigint,text,uuid,uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.set_mobile_member_self_handicap(text,app.handicap_value,date,bigint,boolean,text,uuid,uuid)', 'execute'),
  'authenticated clients can use only the constrained self boundaries'
);
select ok(
  not has_function_privilege('anon', 'public.resolve_mobile_member_self_profile()', 'execute')
  and not has_function_privilege('service_role', 'public.resolve_mobile_member_self_profile()', 'execute')
  and not has_function_privilege('anon', 'public.update_mobile_member_self_profile(text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,boolean,boolean,boolean,boolean,boolean,bigint,bigint,bigint,text,uuid,uuid)', 'execute')
  and not has_function_privilege('service_role', 'public.update_mobile_member_self_profile(text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,boolean,boolean,boolean,boolean,boolean,bigint,bigint,bigint,text,uuid,uuid)', 'execute')
  and not has_function_privilege('anon', 'public.set_mobile_member_self_handicap(text,app.handicap_value,date,bigint,boolean,text,uuid,uuid)', 'execute')
  and not has_function_privilege('service_role', 'public.set_mobile_member_self_handicap(text,app.handicap_value,date,bigint,boolean,text,uuid,uuid)', 'execute'),
  'anonymous and service-role clients cannot call mobile self boundaries'
);
select ok(
  not has_table_privilege('authenticated', 'public.membership_golfer_profiles', 'select,insert,update,delete')
  and not has_table_privilege('authenticated', 'public.membership_private_contacts', 'select,insert,update,delete')
  and not has_table_privilege('authenticated', 'public.membership_handicap_records', 'select,insert,update,delete'),
  'authenticated clients cannot read or mutate raw self records'
);

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, banned_until, created_at, updated_at
)
values
  ('f2000000-0000-4000-8000-000000000001', 'self-a@example.test', now(), false, false, null, now(), now()),
  ('f2000000-0000-4000-8000-000000000002', 'self-b@example.test', now(), false, false, null, now(), now()),
  ('f2000000-0000-4000-8000-000000000003', 'self-inactive@example.test', now(), false, false, null, now(), now()),
  ('f2000000-0000-4000-8000-000000000004', 'self-unverified@example.test', null, false, false, null, now(), now()),
  ('f2000000-0000-4000-8000-000000000005', 'self-recovery@example.test', now(), false, false, null, now(), now());

update auth.users
set raw_app_meta_data = jsonb_build_object(
  'greenroster_password_recovery', jsonb_build_object('session_id', 'f3000000-0000-4000-8000-000000000001')
)
where id = 'f2000000-0000-4000-8000-000000000005';

insert into public.user_profiles (user_id, first_name, last_name)
values
  ('f2000000-0000-4000-8000-000000000001', 'Alex', 'Golfer'),
  ('f2000000-0000-4000-8000-000000000002', 'Fallback', 'Golfer'),
  ('f2000000-0000-4000-8000-000000000003', 'Inactive', 'Golfer'),
  ('f2000000-0000-4000-8000-000000000004', 'Unverified', 'Golfer'),
  ('f2000000-0000-4000-8000-000000000005', 'Recovery', 'Golfer');

insert into public.groups (id, name, time_zone)
values
  ('f4000000-0000-4000-8000-000000000001', 'Self Group A', 'America/Chicago'),
  ('f4000000-0000-4000-8000-000000000002', 'Self Group B', 'UTC');

insert into public.memberships (id, group_id, user_id, role, status, activated_at, inactivated_at)
values
  ('f5000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'member', 'active', now(), null),
  ('f5000000-0000-4000-8000-000000000002', 'f4000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000002', 'member', 'active', now(), null),
  ('f5000000-0000-4000-8000-000000000003', 'f4000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000003', 'member', 'inactive', null, now()),
  ('f5000000-0000-4000-8000-000000000004', 'f4000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000004', 'member', 'active', now(), null),
  ('f5000000-0000-4000-8000-000000000005', 'f4000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000005', 'member', 'active', now(), null);

insert into public.membership_golfer_profiles (id, membership_id, group_id, first_name, last_name, spouse_first_name, tee_location)
values ('f6000000-0000-4000-8000-000000000001', 'f5000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000001', 'Alex', 'Golfer', 'Sam', 'middle');

insert into public.membership_private_contacts (
  id, membership_id, group_id, secondary_email, secondary_email_normalized,
  home_phone_display, home_phone_normalized, work_phone_display, work_phone_normalized,
  mobile_phone_display, mobile_phone_normalized, address_line1, city, state_region, postal_code, country,
  secondary_email_visible, home_phone_visible, work_phone_visible, mobile_phone_visible, address_listed
)
values (
  'f7000000-0000-4000-8000-000000000001', 'f5000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000001',
  'alex.secondary@example.test', 'alex.secondary@example.test', '+1 555 100 1000', app.normalize_member_phone('+1 555 100 1000'),
  '+1 555 100 1001', app.normalize_member_phone('+1 555 100 1001'), '+1 555 100 1002', app.normalize_member_phone('+1 555 100 1002'),
  '1 Old Way', 'Austin', 'TX', '78701', 'US', true, true, false, false, true
);

insert into public.membership_handicap_records (
  id, membership_id, group_id, handicap_id, handicap, source, as_of, created_at
)
values
  ('f8000000-0000-4000-8000-000000000001', 'f5000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000001', 'H-OLD', 12.4, 'import', '2026-07-20', '2026-07-20T10:00:00Z'),
  ('f8000000-0000-4000-8000-000000000002', 'f5000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000001', 'H-NEW', 11.9, 'manual', '2026-07-21', '2026-07-21T10:00:00Z');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'f2000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$ insert into public.membership_golfer_profiles (membership_id, group_id, first_name, last_name) values ('f5000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000001', 'Denied', 'Write') $$,
  '42501', 'permission denied for table membership_golfer_profiles', 'authenticated clients cannot bypass the self-profile RPC with a raw write'
);

select is((select membership_id::text from public.resolve_mobile_member_self_profile()), 'f5000000-0000-4000-8000-000000000001', 'projection resolves only the authenticated membership');
select is((select group_id::text from public.resolve_mobile_member_self_profile()), 'f4000000-0000-4000-8000-000000000001', 'projection derives the authenticated tenant');
select is((select group_name from public.resolve_mobile_member_self_profile()), 'Self Group A', 'projection includes group name');
select is((select first_name from public.resolve_mobile_member_self_profile()), 'Alex', 'projection includes own first name');
select is((select handicap_id from public.resolve_mobile_member_self_profile()), 'H-NEW', 'projection orders current handicap by as-of and created-at');
select is((select handicap::numeric from public.resolve_mobile_member_self_profile()), 11.9::numeric, 'projection includes the current handicap');
select is((select count(*) from public.resolve_mobile_member_self_profile()), 1::bigint, 'projection is one flat row');

-- A member with no membership-owned golfer profile still resolves the names
-- captured during first-run, and can create the row through the same boundary.
select set_config('request.jwt.claim.sub', 'f2000000-0000-4000-8000-000000000002', true);
select is((select first_name from public.resolve_mobile_member_self_profile()), 'Fallback', 'projection falls back to user-profile first name');
select is((select profile_version from public.resolve_mobile_member_self_profile()), 0::bigint, 'missing golfer profile reports version zero');
select is(
  (select profile_version from public.update_mobile_member_self_profile(
    'Fallback Updated', 'Golfer', null, null, 'front', 'fallback.secondary@example.test', null, null, '+1 555 300 3000',
    '3 Fallback Way', null, 'Austin', 'TX', '78703', 'US', false, false, false, false, false, 0, 0, 1,
    'Create self rows', 'f9000000-0000-4000-8000-000000000009', 'fa000000-0000-4000-8000-000000000009'
  )),
  1::bigint,
  'first self save creates a missing golfer profile at version one'
);
set local role postgres;
select is((select version from public.membership_golfer_profiles where membership_id = 'f5000000-0000-4000-8000-000000000002'), 1::bigint, 'first self save creates the golfer row at version one');
select is((select version from public.membership_private_contacts where membership_id = 'f5000000-0000-4000-8000-000000000002'), 1::bigint, 'first self save creates the contact row at version one');
set local role authenticated;

select set_config('request.jwt.claim.sub', 'f2000000-0000-4000-8000-000000000001', true);
select is(
  (select membership_version from public.update_mobile_member_self_profile(
    'Alexandra', 'Golfer', 'Sam', 'Golfer', 'back', 'alex.new@example.test', '+1 (555) 200-1000', '+1 (555) 200-1001', '+1 (555) 200-1002',
    '2 New Way', 'Unit 2', 'Dallas', 'TX', '75201', 'US', true, false, true, true, false, 1, 1, 1,
    'Self edit', 'f9000000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000001'
  )),
  1::bigint,
  'self edit leaves membership version unchanged'
);
set local role postgres;
select is((select first_name from public.membership_golfer_profiles where membership_id = 'f5000000-0000-4000-8000-000000000001'), 'Alexandra', 'self edit updates only own golfer profile');
select is((select secondary_email from public.membership_private_contacts where membership_id = 'f5000000-0000-4000-8000-000000000001'), 'alex.new@example.test', 'self edit updates own contact data');
select is((select home_phone_normalized from public.membership_private_contacts where membership_id = 'f5000000-0000-4000-8000-000000000001'), '+15552001000', 'phone normalization remains server authoritative');
select ok(
  not exists (
    select 1 from public.audit_events as event
    where event.action = 'member.self_profile_updated'
      and (event.before_state::text like '%Alexandra%' or event.after_state::text like '%alex.new@example.test%')
  ),
  'self audit state does not contain raw profile or contact values'
);
set local role authenticated;

select is(
  (select profile_version from public.update_mobile_member_self_profile(
    'Alexandra', 'Golfer', 'Sam', 'Golfer', 'back', 'alex.new@example.test', '+1 (555) 200-1000', '+1 (555) 200-1001', '+1 (555) 200-1002',
    '2 New Way', 'Unit 2', 'Dallas', 'TX', '75201', 'US', true, false, true, true, false, 1, 1, 1,
    'Self edit', 'f9000000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000001'
  )),
  2::bigint,
  'an exact retry replays the prior self edit'
);
select throws_ok(
  $$ select * from public.update_mobile_member_self_profile(
    'Different', 'Golfer', 'Sam', 'Golfer', 'back', 'alex.new@example.test', '+1 (555) 200-1000', '+1 (555) 200-1001', '+1 (555) 200-1002',
    '2 New Way', 'Unit 2', 'Dallas', 'TX', '75201', 'US', true, false, true, true, false, 1, 1, 1,
    'Reuse', 'f9000000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000001'
  ) $$,
  '23505', 'operation_id_reused', 'a self edit operation cannot be reused with different values'
);
select throws_ok(
  $$ select * from public.update_mobile_member_self_profile(
    'Stale', 'Golfer', null, null, 'front', null, null, null, null, null, null, null, null, null, null, false, false, false, false, false, 1, 1, 1,
    'Stale', 'f9000000-0000-4000-8000-000000000002', 'fa000000-0000-4000-8000-000000000002'
  ) $$,
  '40001', 'member_profile_version_changed', 'stale profile versions are rejected'
);
select throws_ok(
  $$ select * from public.update_mobile_member_self_profile(
    'Alexandra', 'Golfer', 'Sam', 'Golfer', 'back', 'alex.new@example.test', '+1 (555) 200-1000', '+1 (555) 200-1001', '+1 (555) 200-1002',
    '2 New Way', 'Unit 2', 'Dallas', 'TX', '75201', 'US', true, false, true, true, false, 2, 1, 1,
    'Stale contact', 'f9000000-0000-4000-8000-000000000004', 'fa000000-0000-4000-8000-000000000004'
  ) $$,
  '40001', 'member_contact_version_changed', 'stale contact versions are rejected independently'
);
select throws_ok(
  $$ select * from public.update_mobile_member_self_profile(
    'Alexandra', 'Golfer', null, null, 'invalid', null, null, null, null, null, null, null, null, null, null, false, false, false, false, false, 2, 2, 1,
    'Invalid tee', 'f9000000-0000-4000-8000-000000000005', 'fa000000-0000-4000-8000-000000000005'
  ) $$,
  '22023', 'member_tee_invalid', 'unsupported tee values are rejected'
);

select is((select membership_version from public.set_mobile_member_self_handicap('H-PRIOR', 10.8, '2026-07-21', 1, true, 'Prior handicap', 'f9000000-0000-4000-8000-000000000008', 'fa000000-0000-4000-8000-000000000008')), 2::bigint, 'a prior handicap establishes a newer membership version');
select throws_ok(
  $$ select * from public.set_mobile_member_self_handicap('H-STALE', 10.6, '2026-07-22', 1, true, 'Stale membership', 'f9000000-0000-4000-8000-000000000006', 'fa000000-0000-4000-8000-000000000006') $$,
  '40001', 'member_membership_version_changed', 'stale membership versions are rejected for handicap append'
);
select throws_ok(
  $$ select * from public.set_mobile_member_self_handicap('H-UNCONFIRMED', 10.6, '2026-07-22', 1, false, 'Not confirmed', 'f9000000-0000-4000-8000-000000000007', 'fa000000-0000-4000-8000-000000000007') $$,
  '22023', 'member_handicap_confirmation_required', 'handicap confirmation is required'
);
select is((select membership_version from public.set_mobile_member_self_handicap('H-SELF', 10.6, '2026-07-22', 2, true, 'Self handicap', 'f9000000-0000-4000-8000-000000000003', 'fa000000-0000-4000-8000-000000000003')), 3::bigint, 'self handicap increments membership version');
set local role postgres;
select is((select count(*) from public.membership_handicap_records where membership_id = 'f5000000-0000-4000-8000-000000000001'), 4::bigint, 'self handicap appends without rewriting history');
set local role authenticated;
select is((select handicap_id from public.resolve_mobile_member_self_profile()), 'H-SELF', 'self handicap becomes the current projection');
select is((select membership_version from public.set_mobile_member_self_handicap('H-SELF', 10.6, '2026-07-22', 2, true, 'Self handicap', 'f9000000-0000-4000-8000-000000000003', 'fa000000-0000-4000-8000-000000000003')), 3::bigint, 'an exact handicap retry is idempotent');
select throws_ok(
  $$ select * from public.set_mobile_member_self_handicap('H-DIFFERENT', 10.6, '2026-07-22', 2, true, 'Reuse', 'f9000000-0000-4000-8000-000000000003', 'fa000000-0000-4000-8000-000000000003') $$,
  '23505', 'operation_id_reused', 'a handicap operation cannot be reused with different values'
);
set local role postgres;
select ok(
  not exists (
    select 1 from public.audit_events as event
    where event.action = 'member.handicap_changed'
      and event.operation_id = 'fa000000-0000-4000-8000-000000000003'
      and (event.before_state::text like '%Alexandra%' or event.after_state::text like '%alex.new@example.test%')
  ),
  'self handicap audit state does not contain profile or contact PII'
);
set local role authenticated;

select set_config('request.jwt.claim.sub', 'f2000000-0000-4000-8000-000000000003', true);
select throws_ok($$ select * from public.resolve_mobile_member_self_profile() $$, 'P0003', 'actor_not_authorized', 'inactive members cannot resolve self profile');
select set_config('request.jwt.claim.sub', 'f2000000-0000-4000-8000-000000000004', true);
select throws_ok($$ select * from public.resolve_mobile_member_self_profile() $$, 'P0003', 'actor_not_authorized', 'unverified identities cannot resolve self profile');
select set_config('request.jwt.claim.sub', 'f2000000-0000-4000-8000-000000000005', true);
select throws_ok($$ select * from public.resolve_mobile_member_self_profile() $$, 'P0003', 'recovery_session_forbidden', 'recovery sessions cannot use self profile mutations');
select throws_ok(
  $$ select * from public.set_mobile_member_self_handicap('H-RECOVERY', 10.6, '2026-07-22', 1, true, 'Recovery attempt', 'f9000000-0000-4000-8000-000000000010', 'fa000000-0000-4000-8000-000000000010') $$,
  'P0003', 'recovery_session_forbidden', 'recovery sessions cannot mutate self handicap'
);

select * from finish();
rollback;
