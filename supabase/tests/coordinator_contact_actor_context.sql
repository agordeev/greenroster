begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

select has_function(
  'public',
  'resolve_mobile_coordinator_contacts',
  array[]::text[],
  'mobile coordinator-contact reader exists'
);
select has_function(
  'public',
  'read_coordinator_contacts_for_actor',
  array['uuid'],
  'service-only coordinator-contact reader exists'
);
select ok(
  has_function_privilege('authenticated', 'public.resolve_mobile_coordinator_contacts()', 'execute')
  and not has_function_privilege('anon', 'public.resolve_mobile_coordinator_contacts()', 'execute')
  and not has_function_privilege('service_role', 'public.resolve_mobile_coordinator_contacts()', 'execute'),
  'mobile coordinator-contact reads are limited to authenticated callers'
);
select ok(
  has_function_privilege('service_role', 'public.read_coordinator_contacts_for_actor(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.read_coordinator_contacts_for_actor(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.read_coordinator_contacts_for_actor(uuid)', 'execute'),
  'actor-derived coordinator-contact reads remain service-only'
);

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, banned_until,
  created_at, updated_at
)
values
  ('ca000000-0000-4000-8000-000000000001', 'contact-active@example.test', now(), false, false, null, now(), now()),
  ('ca000000-0000-4000-8000-000000000002', 'contact-recipient@example.test', now(), false, false, null, now(), now()),
  ('ca000000-0000-4000-8000-000000000003', 'contact-inactive@example.test', now(), false, false, null, now(), now()),
  ('ca000000-0000-4000-8000-000000000004', 'contact-disabled@example.test', now(), false, false, null, now(), now()),
  ('ca000000-0000-4000-8000-000000000005', 'contact-other-a@example.test', now(), false, false, null, now(), now()),
  ('ca000000-0000-4000-8000-000000000006', 'contact-other-b@example.test', now(), false, false, null, now(), now());

insert into public.user_profiles (user_id, display_name, disabled_at)
values
  ('ca000000-0000-4000-8000-000000000001', 'Active Contact Actor', null),
  ('ca000000-0000-4000-8000-000000000002', 'Active Contact Recipient', null),
  ('ca000000-0000-4000-8000-000000000003', 'Inactive Contact Actor', null),
  ('ca000000-0000-4000-8000-000000000004', 'Disabled Contact Actor', now()),
  ('ca000000-0000-4000-8000-000000000005', 'Other Group A', null),
  ('ca000000-0000-4000-8000-000000000006', 'Other Group B', null);

insert into public.groups (id, name, time_zone)
values
  ('cb000000-0000-4000-8000-000000000001', 'Contact Group A', 'UTC'),
  ('cb000000-0000-4000-8000-000000000002', 'Contact Group B', 'UTC');

insert into public.memberships (id, group_id, user_id, role, status, activated_at, inactivated_at)
values
  ('cc000000-0000-4000-8000-000000000001', 'cb000000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000001', 'member', 'active', now(), null),
  ('cc000000-0000-4000-8000-000000000002', 'cb000000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000002', 'member', 'active', now(), null),
  ('cc000000-0000-4000-8000-000000000003', 'cb000000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000003', 'member', 'inactive', null, now()),
  ('cc000000-0000-4000-8000-000000000004', 'cb000000-0000-4000-8000-000000000002', 'ca000000-0000-4000-8000-000000000004', 'member', 'active', now(), null),
  ('cc000000-0000-4000-8000-000000000005', 'cb000000-0000-4000-8000-000000000002', 'ca000000-0000-4000-8000-000000000005', 'member', 'active', now(), null),
  ('cc000000-0000-4000-8000-000000000006', 'cb000000-0000-4000-8000-000000000002', 'ca000000-0000-4000-8000-000000000006', 'member', 'active', now(), null);

insert into public.coordinator_contact_messages (
  id, group_id, sender_membership_id, recipient_membership_id,
  sender_user_id, recipient_user_id, sender_display_name,
  recipient_display_name, body, created_at
)
values
  ('cd000000-0000-4000-8000-000000000001', 'cb000000-0000-4000-8000-000000000001',
    'cc000000-0000-4000-8000-000000000001', 'cc000000-0000-4000-8000-000000000002',
    'ca000000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000002',
    'Active Contact Actor', 'Active Contact Recipient', 'Group A message', now()),
  ('cd000000-0000-4000-8000-000000000002', 'cb000000-0000-4000-8000-000000000001',
    'cc000000-0000-4000-8000-000000000003', 'cc000000-0000-4000-8000-000000000002',
    'ca000000-0000-4000-8000-000000000003', 'ca000000-0000-4000-8000-000000000002',
    'Inactive Contact Actor', 'Active Contact Recipient', 'Inactive message', now()),
  ('cd000000-0000-4000-8000-000000000003', 'cb000000-0000-4000-8000-000000000002',
    'cc000000-0000-4000-8000-000000000004', 'cc000000-0000-4000-8000-000000000005',
    'ca000000-0000-4000-8000-000000000004', 'ca000000-0000-4000-8000-000000000005',
    'Disabled Contact Actor', 'Other Group A', 'Disabled message', now()),
  ('cd000000-0000-4000-8000-000000000004', 'cb000000-0000-4000-8000-000000000002',
    'cc000000-0000-4000-8000-000000000005', 'cc000000-0000-4000-8000-000000000006',
    'ca000000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000006',
    'Cross-tenant sender', 'Other Group B', 'Cross-tenant message', now());

select pg_catalog.set_config('request.jwt.claim.sub', 'ca000000-0000-4000-8000-000000000001', true);
create temporary table contact_mobile_active on commit drop as
select * from public.resolve_mobile_coordinator_contacts();

select is(
  (select count(*)::integer from contact_mobile_active),
  1,
  'mobile reader returns only the active actor tenant message'
);
select is(
  (select group_id from contact_mobile_active),
  'cb000000-0000-4000-8000-000000000001'::uuid,
  'mobile reader derives the actor tenant from content context'
);
select is(
  (select message_id from contact_mobile_active),
  'cd000000-0000-4000-8000-000000000001'::uuid,
  'mobile reader excludes cross-tenant messages even when sender user ids match'
);
select ok(
  (select sent_by_actor from contact_mobile_active),
  'mobile reader marks messages sent by the authenticated actor'
);

select pg_catalog.set_config('request.jwt.claim.sub', 'ca000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$ select public.resolve_mobile_coordinator_contacts() $$,
  'P0003',
  'actor_not_authorized',
  'inactive memberships cannot read coordinator contacts'
);

select pg_catalog.set_config('request.jwt.claim.sub', 'ca000000-0000-4000-8000-000000000004', true);
select throws_ok(
  $$ select public.resolve_mobile_coordinator_contacts() $$,
  'P0003',
  'actor_not_authorized',
  'disabled profiles cannot read coordinator contacts'
);

select pg_catalog.set_config('request.jwt.claim.sub', '', true);

create temporary table contact_service_active on commit drop as
select * from public.read_coordinator_contacts_for_actor('ca000000-0000-4000-8000-000000000001');
select is(
  (select count(*)::integer from contact_service_active),
  1,
  'service-only reader applies the same tenant scope'
);
select is(
  (select message_id from contact_service_active),
  'cd000000-0000-4000-8000-000000000001'::uuid,
  'service-only reader excludes cross-tenant contacts'
);
select throws_ok(
  $$ select public.read_coordinator_contacts_for_actor('ca000000-0000-4000-8000-000000000003') $$,
  'P0003',
  'actor_not_authorized',
  'service-only reader rejects inactive memberships'
);
select throws_ok(
  $$ select public.read_coordinator_contacts_for_actor('ca000000-0000-4000-8000-000000000004') $$,
  'P0003',
  'actor_not_authorized',
  'service-only reader rejects disabled profiles'
);

select * from finish();
rollback;
