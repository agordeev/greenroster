begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

select has_function(
  'public',
  'resolve_mobile_group_directory',
  array['text', 'text'],
  'authenticated mobile group directory function exists'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.resolve_mobile_group_directory(text,text)',
    'execute'
  ),
  'authenticated users can execute the mobile directory function'
);
select ok(
  not has_function_privilege('anon', 'public.resolve_mobile_group_directory(text,text)', 'execute')
  and not has_function_privilege('service_role', 'public.resolve_mobile_group_directory(text,text)', 'execute'),
  'public, anon, and service_role cannot execute the mobile directory function'
);

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, banned_until, created_at, updated_at
)
values
  ('da000000-0000-4000-8000-000000000001', 'directory-alice@example.test', now(), false, false, null, now(), now()),
  ('da000000-0000-4000-8000-000000000002', 'directory-bob@example.test', now(), false, false, null, now(), now()),
  ('da000000-0000-4000-8000-000000000003', 'directory-carol@example.test', now(), false, false, null, now(), now()),
  ('da000000-0000-4000-8000-000000000004', 'directory-aaron@example.test', now(), false, false, null, now(), now()),
  ('da000000-0000-4000-8000-000000000005', 'directory-gary@example.test', now(), false, false, null, now(), now()),
  ('da000000-0000-4000-8000-000000000006', 'directory-hannah@example.test', now(), false, false, null, now(), now()),
  ('da000000-0000-4000-8000-000000000007', 'directory-disabled@example.test', now(), false, false, null, now(), now()),
  ('da000000-0000-4000-8000-000000000008', 'directory-inactive@example.test', now(), false, false, null, now(), now()),
  ('da000000-0000-4000-8000-000000000009', 'directory-unverified@example.test', null, false, false, null, now(), now()),
  ('da000000-0000-4000-8000-000000000010', 'directory-banned@example.test', now(), false, false, '2099-01-01T00:00:00Z', now(), now());

insert into public.user_profiles (user_id, display_name, first_name, last_name, disabled_at)
values
  ('da000000-0000-4000-8000-000000000001', 'Directory Alice', 'Alice', 'Anderson', null),
  ('da000000-0000-4000-8000-000000000002', 'Directory Bob', 'Bob', 'Baker', null),
  ('da000000-0000-4000-8000-000000000003', 'Directory Carol', 'Carol', 'Contact', null),
  ('da000000-0000-4000-8000-000000000004', 'Directory Aaron', 'Aaron', null, null),
  ('da000000-0000-4000-8000-000000000005', 'Directory Gary', 'Gary', 'Group', null),
  ('da000000-0000-4000-8000-000000000006', 'Directory Hannah', 'Hannah', 'Hidden', null),
  ('da000000-0000-4000-8000-000000000007', 'Directory Disabled', 'Disabled', 'Member', now()),
  ('da000000-0000-4000-8000-000000000008', 'Directory Inactive', 'Inactive', 'Member', null),
  ('da000000-0000-4000-8000-000000000009', 'Directory Unverified', 'Unverified', 'Member', null),
  ('da000000-0000-4000-8000-000000000010', 'Directory Banned', 'Banned', 'Member', null);

insert into public.groups (id, name, time_zone)
values
  ('db000000-0000-4000-8000-000000000001', 'Directory Group A', 'UTC'),
  ('db000000-0000-4000-8000-000000000002', 'Directory Group B', 'UTC'),
  ('db000000-0000-4000-8000-000000000003', 'Directory Group C', 'UTC');

insert into public.memberships (id, group_id, user_id, role, status, activated_at, inactivated_at)
values
  ('dc000000-0000-4000-8000-000000000001', 'db000000-0000-4000-8000-000000000001', 'da000000-0000-4000-8000-000000000001', 'member', 'active', now(), null),
  ('dc000000-0000-4000-8000-000000000002', 'db000000-0000-4000-8000-000000000001', 'da000000-0000-4000-8000-000000000002', 'member', 'active', now(), null),
  ('dc000000-0000-4000-8000-000000000003', 'db000000-0000-4000-8000-000000000001', 'da000000-0000-4000-8000-000000000003', 'member', 'active', now(), null),
  ('dc000000-0000-4000-8000-000000000004', 'db000000-0000-4000-8000-000000000001', 'da000000-0000-4000-8000-000000000004', 'member', 'active', now(), null),
  ('dc000000-0000-4000-8000-000000000011', 'db000000-0000-4000-8000-000000000002', 'da000000-0000-4000-8000-000000000005', 'member', 'active', now(), null),
  ('dc000000-0000-4000-8000-000000000012', 'db000000-0000-4000-8000-000000000002', 'da000000-0000-4000-8000-000000000006', 'member', 'active', now(), null),
  ('dc000000-0000-4000-8000-000000000021', 'db000000-0000-4000-8000-000000000003', 'da000000-0000-4000-8000-000000000007', 'member', 'active', now(), null),
  ('dc000000-0000-4000-8000-000000000022', 'db000000-0000-4000-8000-000000000001', 'da000000-0000-4000-8000-000000000008', 'member', 'inactive', null, now()),
  ('dc000000-0000-4000-8000-000000000023', 'db000000-0000-4000-8000-000000000003', 'da000000-0000-4000-8000-000000000009', 'member', 'active', now(), null),
  ('dc000000-0000-4000-8000-000000000024', 'db000000-0000-4000-8000-000000000003', 'da000000-0000-4000-8000-000000000010', 'member', 'active', now(), null);

insert into public.membership_golfer_profiles (membership_id, group_id, first_name, last_name, tee_location)
values
  ('dc000000-0000-4000-8000-000000000001', 'db000000-0000-4000-8000-000000000001', 'Alice', 'Anderson', 'middle'),
  ('dc000000-0000-4000-8000-000000000002', 'db000000-0000-4000-8000-000000000001', 'Bob', 'Baker', 'back'),
  ('dc000000-0000-4000-8000-000000000003', 'db000000-0000-4000-8000-000000000001', 'Carol', 'Contact', 'front'),
  ('dc000000-0000-4000-8000-000000000011', 'db000000-0000-4000-8000-000000000002', 'Gary', 'Group', 'pro'),
  ('dc000000-0000-4000-8000-000000000012', 'db000000-0000-4000-8000-000000000002', 'Hannah', 'Hidden', 'middle'),
  ('dc000000-0000-4000-8000-000000000021', 'db000000-0000-4000-8000-000000000003', 'Disabled', 'Member', 'front'),
  ('dc000000-0000-4000-8000-000000000022', 'db000000-0000-4000-8000-000000000001', 'Inactive', 'Member', 'front'),
  ('dc000000-0000-4000-8000-000000000023', 'db000000-0000-4000-8000-000000000003', 'Unverified', 'Member', 'front'),
  ('dc000000-0000-4000-8000-000000000024', 'db000000-0000-4000-8000-000000000003', 'Banned', 'Member', 'front');

insert into public.membership_private_contacts (
  membership_id, group_id, secondary_email, secondary_email_normalized,
  home_phone_display, home_phone_normalized, work_phone_display, work_phone_normalized,
  mobile_phone_display, mobile_phone_normalized, address_line1, address_line2,
  city, state_region, postal_code, country,
  secondary_email_visible, home_phone_visible, work_phone_visible,
  mobile_phone_visible, address_listed
)
values
  ('dc000000-0000-4000-8000-000000000001', 'db000000-0000-4000-8000-000000000001', 'alice.visible@example.test', 'alice.visible@example.test',
    '+1 555 010 0101', app.normalize_member_phone('+1 555 010 0101'), '+1 555 010 0102', app.normalize_member_phone('+1 555 010 0102'),
    '+1 555 010 0103', app.normalize_member_phone('+1 555 010 0103'), '1 Visible Way', 'Suite 1', 'Austin', 'TX', '78701', 'US',
    true, true, true, true, true),
  ('dc000000-0000-4000-8000-000000000002', 'db000000-0000-4000-8000-000000000001', 'bob.hidden@example.test', 'bob.hidden@example.test',
    '+1 555 010 0201', app.normalize_member_phone('+1 555 010 0201'), '+1 555 010 0202', app.normalize_member_phone('+1 555 010 0202'),
    '+1 555 010 0203', app.normalize_member_phone('+1 555 010 0203'), '2 Hidden Way', null, 'Austin', 'TX', '78702', 'US',
    false, false, false, false, false),
  ('dc000000-0000-4000-8000-000000000003', 'db000000-0000-4000-8000-000000000001', 'carol.visible@example.test', 'carol.visible@example.test',
    '+1 555 010 0301', app.normalize_member_phone('+1 555 010 0301'), null, null, null, null, null, null, null, null, null, null,
    true, false, false, false, false);

select pg_catalog.set_config('request.jwt.claim.sub', 'da000000-0000-4000-8000-000000000001', true);
create temporary table directory_a on commit drop as
select public.resolve_mobile_group_directory() as payload;

select is(
  (select payload->'group'->>'group_id' from directory_a),
  'db000000-0000-4000-8000-000000000001',
  'directory envelope resolves the actor group'
);
select is(
  (select payload->'group'->>'name' from directory_a),
  'Directory Group A',
  'directory envelope includes group name'
);
select is(
  (select payload->'group'->>'time_zone' from directory_a),
  'UTC',
  'directory envelope includes group time zone'
);
select is(
  jsonb_array_length((select payload->'members' from directory_a)),
  4,
  'directory includes active members in the actor tenant only'
);
select is(
  (select row->>'membership_id'
   from jsonb_array_elements((select payload->'members' from directory_a)) as row
   limit 1),
  'dc000000-0000-4000-8000-000000000004',
  'directory ordering uses surname fallback to first name'
);
select is(
  (select row->>'membership_id'
   from jsonb_array_elements((select payload->'members' from directory_a)) as row
   where row->>'membership_id' = 'dc000000-0000-4000-8000-000000000011'),
  null,
  'directory excludes the other tenant'
);
select is(
  (select row->>'membership_id'
   from jsonb_array_elements((select payload->'members' from directory_a)) as row
   where row->>'membership_id' = 'dc000000-0000-4000-8000-000000000022'),
  null,
  'directory excludes inactive memberships'
);

select ok(
  exists (
    select 1
    from jsonb_array_elements((select payload->'members' from directory_a)) as row
    where row->>'membership_id' = 'dc000000-0000-4000-8000-000000000001'
      and row->>'secondary_email' = 'alice.visible@example.test'
      and row->>'home_phone' = '+1 555 010 0101'
      and row->'address'->>'line1' = '1 Visible Way'
  ),
  'explicitly visible contact fields and address are returned'
);
select ok(
  exists (
    select 1
    from jsonb_array_elements((select payload->'members' from directory_a)) as row
    where row->>'membership_id' = 'dc000000-0000-4000-8000-000000000002'
      and not (row ? 'secondary_email')
      and not (row ? 'home_phone')
      and not (row ? 'work_phone')
      and not (row ? 'mobile_phone')
      and not (row ? 'address')
  ),
  'hidden contact and address fields are absent rather than leaked as null values'
);
select ok(
  exists (
    select 1
    from jsonb_array_elements((select payload->'members' from directory_a)) as row
    where row->>'membership_id' = 'dc000000-0000-4000-8000-000000000003'
      and row->>'secondary_email' = 'carol.visible@example.test'
      and not (row ? 'home_phone')
  ),
  'field-level visibility is independently enforced'
);
select is(
  (select public.resolve_mobile_group_directory()),
  (select public.resolve_mobile_group_directory()),
  'directory ordering is stable across repeated reads'
);

select is(
  (select (public.resolve_mobile_group_directory('  Alice   Anderson  ')->'members'->0->>'membership_id')),
  'dc000000-0000-4000-8000-000000000001',
  'first-last full-name search normalizes whitespace'
);
select is(
  (select (public.resolve_mobile_group_directory('Anderson Alice')->'members'->0->>'membership_id')),
  'dc000000-0000-4000-8000-000000000001',
  'last-first full-name search is supported'
);
select is(
  jsonb_array_length((select public.resolve_mobile_group_directory('ALICE.VISIBLE@EXAMPLE.TEST')->'members')),
  1,
  'search can use explicitly visible secondary email'
);
select is(
  jsonb_array_length((select public.resolve_mobile_group_directory('bob.hidden@example.test')->'members')),
  0,
  'search cannot use hidden secondary email'
);
select is(
  jsonb_array_length((select public.resolve_mobile_group_directory(null, 'b')->'members')),
  1,
  'alphabet filter is case-insensitive on surname'
);
select is(
  jsonb_array_length((select public.resolve_mobile_group_directory(null, 'a')->'members')),
  2,
  'alphabet filter falls back to first name when surname is absent'
);
select is(
  jsonb_array_length((select public.resolve_mobile_group_directory('no such member')->'members')),
  0,
  'empty search results retain the envelope with an empty members array'
);
select throws_ok(
  $$ select public.resolve_mobile_group_directory(repeat('x', 201), null) $$,
  '22023',
  'mobile_directory_search_invalid',
  'search longer than 200 characters is rejected'
);
select throws_ok(
  $$ select public.resolve_mobile_group_directory(null, 'AB') $$,
  '22023',
  'mobile_directory_alphabet_invalid',
  'multi-letter alphabet input is rejected'
);

select pg_catalog.set_config('request.jwt.claim.sub', 'da000000-0000-4000-8000-000000000005', true);
select is(
  (select public.resolve_mobile_group_directory()->'group'->>'group_id'),
  'db000000-0000-4000-8000-000000000002',
  'another active member resolves only its own group'
);
select is(
  jsonb_array_length((select public.resolve_mobile_group_directory()->'members')),
  2,
  'another tenant sees only its active directory rows'
);

select pg_catalog.set_config('request.jwt.claim.sub', 'da000000-0000-4000-8000-000000000007', true);
select throws_ok($$ select public.resolve_mobile_group_directory() $$, 'P0003', 'actor_not_authorized', 'disabled member is denied');
select pg_catalog.set_config('request.jwt.claim.sub', 'da000000-0000-4000-8000-000000000008', true);
select throws_ok($$ select public.resolve_mobile_group_directory() $$, 'P0003', 'actor_not_authorized', 'inactive member is denied');
select pg_catalog.set_config('request.jwt.claim.sub', 'da000000-0000-4000-8000-000000000009', true);
select throws_ok($$ select public.resolve_mobile_group_directory() $$, 'P0003', 'actor_not_authorized', 'unverified member is denied');
select pg_catalog.set_config('request.jwt.claim.sub', 'da000000-0000-4000-8000-000000000010', true);
select throws_ok($$ select public.resolve_mobile_group_directory() $$, 'P0003', 'actor_not_authorized', 'banned member is denied');
select pg_catalog.set_config('request.jwt.claim.sub', '', true);
select throws_ok($$ select public.resolve_mobile_group_directory() $$, 'P0003', 'actor_not_authorized', 'anonymous request is denied');

select * from finish();
rollback;
