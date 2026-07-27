begin;

create extension if not exists pgtap with schema extensions;

select plan(61);

select has_table(
  'public',
  'membership_golfer_profiles',
  'membership-owned golfer profiles exist'
);
select has_table(
  'public',
  'membership_private_contacts',
  'membership-owned private contacts exist'
);
select has_pk('public', 'membership_golfer_profiles', 'golfer profiles have immutable identifiers');
select has_pk('public', 'membership_private_contacts', 'private contacts have immutable identifiers');
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid = 'public.membership_golfer_profiles'::regclass),
  'golfer profiles force RLS'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid = 'public.membership_private_contacts'::regclass),
  'private contacts force RLS'
);
select ok(
  not has_table_privilege('anon', 'public.membership_golfer_profiles', 'select,insert,update,delete'),
  'anonymous clients cannot access golfer profiles directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.membership_golfer_profiles', 'select,insert,update,delete'),
  'authenticated clients cannot access golfer profiles directly'
);
select ok(
  not has_table_privilege('anon', 'public.membership_private_contacts', 'select,insert,update,delete'),
  'anonymous clients cannot access private contacts directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.membership_private_contacts', 'select,insert,update,delete'),
  'authenticated clients cannot access private contacts directly'
);
select ok(
  has_table_privilege('service_role', 'public.membership_golfer_profiles', 'select'),
  'trusted server can read golfer profiles through an explicit grant'
);
select ok(
  not has_table_privilege('service_role', 'public.membership_private_contacts', 'select'),
  'trusted server cannot read private contacts through a raw table grant'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.create_pending_member_profile(uuid,text,text,text,text,text,boolean,text,text,text,text,text,text,text,text,text,text,boolean,boolean,boolean,boolean,boolean,text,uuid,uuid)',
    'execute'
  ),
  'trusted server can create pending member profiles'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.create_pending_member_profile(uuid,text,text,text,text,text,boolean,text,text,text,text,text,text,text,text,text,text,boolean,boolean,boolean,boolean,boolean,text,uuid,uuid)',
    'execute'
  ),
  'authenticated clients cannot invoke member creation directly'
);

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at
)
values
  ('17000000-0000-4000-8000-000000000001', 'member-create-admin-a@example.test', now(), false, false, now(), now()),
  ('17000000-0000-4000-8000-000000000002', 'member-create-coordinator-a@example.test', now(), false, false, now(), now()),
  ('17000000-0000-4000-8000-000000000003', 'member-create-member-a@example.test', now(), false, false, now(), now()),
  ('17000000-0000-4000-8000-000000000004', 'member-create-admin-b@example.test', now(), false, false, now(), now());

insert into public.user_profiles (user_id)
values
  ('17000000-0000-4000-8000-000000000001'),
  ('17000000-0000-4000-8000-000000000002'),
  ('17000000-0000-4000-8000-000000000003'),
  ('17000000-0000-4000-8000-000000000004');

insert into public.groups (id, name, time_zone)
values
  ('57000000-0000-4000-8000-000000000001', 'Member create group A', 'UTC'),
  ('57000000-0000-4000-8000-000000000002', 'Member create group B', 'UTC');

insert into public.memberships (
  id, group_id, user_id, role, status, activated_at
)
values
  ('67000000-0000-4000-8000-000000000001', '57000000-0000-4000-8000-000000000001', '17000000-0000-4000-8000-000000000001', 'administrator', 'active', now()),
  ('67000000-0000-4000-8000-000000000002', '57000000-0000-4000-8000-000000000001', '17000000-0000-4000-8000-000000000002', 'coordinator', 'active', now()),
  ('67000000-0000-4000-8000-000000000003', '57000000-0000-4000-8000-000000000001', '17000000-0000-4000-8000-000000000003', 'member', 'active', now()),
  ('67000000-0000-4000-8000-000000000004', '57000000-0000-4000-8000-000000000002', '17000000-0000-4000-8000-000000000004', 'administrator', 'active', now());

select throws_ok(
  $$ select * from public.create_pending_member_profile(
    '17000000-0000-4000-8000-000000000003',
    'Member', 'Denied', null, null, null, false,
    null, null, null, null, null, null, null, null, null, null,
    null, null, null, null, null, 'Member must not create records',
    '27000000-0000-4000-8000-000000000001', '37000000-0000-4000-8000-000000000001'
  ) $$,
  'P0003',
  'actor_not_authorized',
  'an active member cannot create another member'
);
select is(
  (select count(*) from public.memberships where group_id = '57000000-0000-4000-8000-000000000001' and status = 'pending'),
  0::bigint,
  'a denied create writes no pending membership'
);

select throws_ok(
  $$ select * from public.create_pending_member_profile(
    '17000000-0000-4000-8000-000000000002',
    'Member', 'No reason', null, null, null, false,
    null, null, null, null, null, null, null, null, null, null,
    null, null, null, null, null, repeat('x', 501),
    '27000000-0000-4000-8000-000000000002', '37000000-0000-4000-8000-000000000002'
  ) $$,
  '22023',
  'member_create_reason_invalid',
  'an overlong optional member-create reason is rejected'
);

select throws_ok(
  $$ select * from public.create_pending_member_profile(
    '17000000-0000-4000-8000-000000000002',
    'Member', 'Bad email', null, null, null, false,
    'not-an-email', null, null, null, null, null, null, null, null, null,
    null, null, null, null, null, 'Validation rollback',
    '27000000-0000-4000-8000-000000000003', '37000000-0000-4000-8000-000000000003'
  ) $$,
  '22023',
  'member_secondary_email_invalid',
  'an invalid secondary email is rejected'
);

select throws_ok(
  $$ select * from public.create_pending_member_profile(
    '17000000-0000-4000-8000-000000000002',
    'Member', 'Long address', null, null, null, false,
    null, null, null, null, repeat('X', 201), null, null, null, null, null,
    null, null, null, null, null, 'Validation rollback',
    '27000000-0000-4000-8000-000000000004', '37000000-0000-4000-8000-000000000004'
  ) $$,
  '22023',
  'member_address_field_invalid',
  'an overlong postal field is rejected while independent fields remain optional'
);
select is(
  (select count(*) from public.memberships where group_id = '57000000-0000-4000-8000-000000000001'),
  3::bigint,
  'validation failures roll back the membership insert'
);

create temporary table coordinator_member_create as
select * from public.create_pending_member_profile(
  '17000000-0000-4000-8000-000000000002',
  '  Alex  ', '  Golfer ', '  Sam ', null, 'Back', true,
  '  Alex.Secondary@Example.test ',
  ' +1 (555) 123-4567 ',
  '555.765.4321',
  'office ext 12',
  '1 Main Street', 'Unit 2', 'Exampletown', 'CA', '90210', 'United States',
  true, true, false, false, true,
  '  Add from coordinator portal  ',
  '27000000-0000-4000-8000-000000000005', '37000000-0000-4000-8000-000000000005'
);

select is(
  (select created_group_id::uuid from coordinator_member_create),
  '57000000-0000-4000-8000-000000000001'::uuid,
  'the create result derives the coordinator tenant'
);
select is(
  (select profile_version from coordinator_member_create),
  1::bigint,
  'the first golfer profile version is one'
);
select is(
  (select contact_version from coordinator_member_create),
  1::bigint,
  'the first private contact version is one'
);
select is(
  (select role from public.memberships where id = (select created_membership_id from coordinator_member_create)),
  'member'::public.membership_role,
  'created membership always starts with the member role'
);
select is(
  (select status from public.memberships where id = (select created_membership_id from coordinator_member_create)),
  'pending'::public.membership_status,
  'created membership is pending'
);
select is(
  (select user_id from public.memberships where id = (select created_membership_id from coordinator_member_create)),
  null::app.entity_id,
  'created pending membership has no attached identity'
);
select is(
  (select dues_paid from public.memberships where id = (select created_membership_id from coordinator_member_create)),
  true,
  'the dues-paid flag is persisted'
);
select is(
  (select first_name from public.membership_golfer_profiles where membership_id = (select created_membership_id from coordinator_member_create)),
  'Alex',
  'required first name is trimmed and stored'
);
select is(
  (select last_name from public.membership_golfer_profiles where membership_id = (select created_membership_id from coordinator_member_create)),
  'Golfer',
  'required last name is trimmed and stored'
);
select is(
  (select spouse_first_name from public.membership_golfer_profiles where membership_id = (select created_membership_id from coordinator_member_create)),
  'Sam',
  'optional spouse name is stored'
);
select is(
  (select tee_location from public.membership_golfer_profiles where membership_id = (select created_membership_id from coordinator_member_create)),
  'back',
  'tee values are normalized to the lower-case contract'
);
select is(
  (select secondary_email from public.membership_private_contacts where membership_id = (select created_membership_id from coordinator_member_create)),
  'Alex.Secondary@Example.test',
  'secondary email display form is retained'
);
select is(
  (select secondary_email_normalized from public.membership_private_contacts where membership_id = (select created_membership_id from coordinator_member_create)),
  'alex.secondary@example.test',
  'secondary email matching form is normalized'
);
select is(
  (select home_phone_display from public.membership_private_contacts where membership_id = (select created_membership_id from coordinator_member_create)),
  '+1 (555) 123-4567',
  'home phone display form is retained exactly after outer trim'
);
select is(
  (select home_phone_normalized from public.membership_private_contacts where membership_id = (select created_membership_id from coordinator_member_create)),
  '+15551234567',
  'home phone is conservatively normalized'
);
select is(
  (select work_phone_normalized from public.membership_private_contacts where membership_id = (select created_membership_id from coordinator_member_create)),
  '5557654321',
  'work phone punctuation is normalized'
);
select is(
  (select mobile_phone_normalized from public.membership_private_contacts where membership_id = (select created_membership_id from coordinator_member_create)),
  null::text,
  'ambiguous phone display retains no guessed normalized value'
);
select is(
  (select secondary_email_visible from public.membership_private_contacts where membership_id = (select created_membership_id from coordinator_member_create)),
  true,
  'requested secondary-email visibility is stored'
);
select is(
  (select mobile_phone_visible from public.membership_private_contacts where membership_id = (select created_membership_id from coordinator_member_create)),
  false,
  'phone visibility remains private when not requested'
);
select is(
  (select address_listed from public.membership_private_contacts where membership_id = (select created_membership_id from coordinator_member_create)),
  true,
  'requested address listing permission is stored'
);
select is(
  (select count(*) from public.audit_events where action = 'member.created'),
  1::bigint,
  'member create writes one audit event'
);
select is(
  (select reason from public.audit_events where action = 'member.created'),
  'Add from coordinator portal',
  'audit reason is trimmed'
);
select is(
  (select source from public.audit_events where action = 'member.created'),
  'server',
  'member creation records the server source'
);
select ok(
  (select after_state -> 'contact_fields' ? 'secondary_email' from public.audit_events where action = 'member.created'),
  'audit records contact field presence'
);
select ok(
  (select after_state::text not like '%Alex.Secondary%'
    and after_state::text not like '%+1 (555) 123-4567%'
    and after_state::text not like '%+15551234567%'
    and after_state::text not like '%5557654321%'
    and after_state::text not like '%Main Street%'
   from public.audit_events where action = 'member.created'),
  'audit after-state excludes sensitive contact values'
);

select * from public.create_pending_member_profile(
  '17000000-0000-4000-8000-000000000002',
  'Changed', 'Retry payload', null, null, 'front', false,
  'retry@example.test', '9999999', null, null, null, null, null, null, null, null,
  null, null, null, null, null, 'Changed retry payload',
  '27000000-0000-4000-8000-000000000099', '37000000-0000-4000-8000-000000000005'
);
select is(
  (select count(*) from public.memberships where group_id = '57000000-0000-4000-8000-000000000001' and status = 'pending'),
  1::bigint,
  'idempotent retry does not create a second pending membership'
);
select is(
  (select first_name from public.membership_golfer_profiles where membership_id = (select created_membership_id from coordinator_member_create)),
  'Alex',
  'idempotent retry returns the original record without replacing profile data'
);
select is(
  (select count(*) from public.audit_events where action = 'member.created'),
  1::bigint,
  'idempotent retry does not duplicate the audit event'
);

create temporary table administrator_member_create as
select * from public.create_pending_member_profile(
  '17000000-0000-4000-8000-000000000001',
  'Admin', 'Created', null, null, 'Pro', null,
  null, null, null, null, null, null, null, null, null, null,
  null, null, null, null, null, null,
  '27000000-0000-4000-8000-000000000006', '37000000-0000-4000-8000-000000000006'
);
select is(
  (select created_group_id::uuid from administrator_member_create),
  '57000000-0000-4000-8000-000000000001'::uuid,
  'an administrator can create in the actor-derived tenant'
);
select is(
  (select dues_paid from public.memberships where id = (select created_membership_id from administrator_member_create)),
  false,
  'an omitted dues flag uses the membership default'
);
select is(
  (select reason from public.audit_events where target_id = (select created_membership_id from administrator_member_create) and action = 'member.created'),
  null::text,
  'an ordinary member create audits no invented reason when none was supplied'
);
select is(
  (select count(*) from public.memberships where group_id = '57000000-0000-4000-8000-000000000001' and status = 'pending'),
  2::bigint,
  'coordinator and administrator creates both persist'
);
select is(
  (select secondary_email_visible from public.membership_private_contacts where membership_id = (select created_membership_id from administrator_member_create)),
  false,
  'secondary email visibility defaults to private'
);
select is(
  (select home_phone_visible and work_phone_visible and mobile_phone_visible from public.membership_private_contacts where membership_id = (select created_membership_id from administrator_member_create)),
  false,
  'all phone visibility defaults to private'
);
select is(
  (select address_listed from public.membership_private_contacts where membership_id = (select created_membership_id from administrator_member_create)),
  false,
  'address listing defaults to private'
);

create temporary table group_b_member_create as
select * from public.create_pending_member_profile(
  '17000000-0000-4000-8000-000000000004',
  'Other', 'Tenant', null, null, 'Middle', false,
  null, null, null, null, null, null, null, null, null, null,
  true, null, null, null, null, 'Other tenant add',
  '27000000-0000-4000-8000-000000000007', '37000000-0000-4000-8000-000000000007'
);
select is(
  (select created_group_id::uuid from group_b_member_create),
  '57000000-0000-4000-8000-000000000002'::uuid,
  'the second tenant receives only its own member record'
);
select is(
  (select secondary_email_visible from public.membership_private_contacts where membership_id = (select created_membership_id from group_b_member_create)),
  true,
  'contact visibility can be controlled independently from whether a value is present'
);
select ok(
  (select count(*) = 0 from public.membership_golfer_profiles where group_id = '57000000-0000-4000-8000-000000000001' and membership_id = (select created_membership_id from group_b_member_create)),
  'cross-tenant membership identifiers do not leak into another group'
);

update public.memberships
set role = 'member'
where id = '67000000-0000-4000-8000-000000000002';
select throws_ok(
  $$ select * from public.create_pending_member_profile(
    '17000000-0000-4000-8000-000000000002',
    'Revoked', 'Coordinator', null, null, null, false,
    null, null, null, null, null, null, null, null, null, null,
    null, null, null, null, null, 'Role was revoked',
    '27000000-0000-4000-8000-000000000008', '37000000-0000-4000-8000-000000000008'
  ) $$,
  'P0003',
  'actor_not_authorized',
  'a role revocation takes effect on the next create'
);

insert into public.memberships (id, group_id, role, status)
values (
  '67000000-0000-4000-8000-000000000009',
  '57000000-0000-4000-8000-000000000002',
  'member',
  'pending'
);
select throws_ok(
  $$ insert into public.membership_golfer_profiles (
    membership_id, group_id, first_name, last_name
  ) values (
    '67000000-0000-4000-8000-000000000009',
    '57000000-0000-4000-8000-000000000001',
    'Wrong', 'Tenant'
  ) $$,
  '23503',
  null,
  'the composite membership/group foreign key rejects cross-tenant profile ownership'
);

select throws_ok(
  $$ set local role authenticated; select count(*) from public.membership_private_contacts $$,
  '42501',
  null,
  'the authenticated role cannot read private contacts even with RLS enabled'
);
reset role;

select * from finish();

rollback;
