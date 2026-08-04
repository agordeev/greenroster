begin;

create extension if not exists pgtap with schema extensions;

select plan(11);

select has_function(
  'public',
  'read_mobile_round_summary',
  array['uuid'],
  'exact mobile round summary boundary exists'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.read_mobile_round_summary(uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.read_mobile_round_summary(uuid)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.read_mobile_round_summary(uuid)',
    'execute'
  ),
  'exact mobile round summary is authenticated-only'
);

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at
)
values
  ('6a000000-0000-4000-8000-000000000001', 'summary-member@example.test', now(), false, false, now(), now()),
  ('6a000000-0000-4000-8000-000000000002', 'summary-other@example.test', now(), false, false, now(), now()),
  ('6a000000-0000-4000-8000-000000000003', 'summary-coordinator@example.test', now(), false, false, now(), now()),
  ('6a000000-0000-4000-8000-000000000004', 'summary-recovery@example.test', now(), false, false, now(), now());

update auth.users
set raw_app_meta_data = '{"greenroster_password_recovery":true}'::jsonb
where id = '6a000000-0000-4000-8000-000000000004';

insert into public.user_profiles (user_id, first_name, last_name)
values
  ('6a000000-0000-4000-8000-000000000001', 'Summary', 'Member'),
  ('6a000000-0000-4000-8000-000000000002', 'Summary', 'Other'),
  ('6a000000-0000-4000-8000-000000000003', 'Summary', 'Coordinator'),
  ('6a000000-0000-4000-8000-000000000004', 'Summary', 'Recovery');

insert into public.groups (id, name, time_zone)
values
  ('6b000000-0000-4000-8000-000000000001', 'Summary Group', 'UTC'),
  ('6b000000-0000-4000-8000-000000000002', 'Summary Other Group', 'UTC');

insert into public.memberships (id, group_id, user_id, role, status, activated_at)
values
  ('6c000000-0000-4000-8000-000000000001', '6b000000-0000-4000-8000-000000000001', '6a000000-0000-4000-8000-000000000001', 'member', 'active', now()),
  ('6c000000-0000-4000-8000-000000000002', '6b000000-0000-4000-8000-000000000001', '6a000000-0000-4000-8000-000000000002', 'member', 'active', now()),
  ('6c000000-0000-4000-8000-000000000003', '6b000000-0000-4000-8000-000000000001', '6a000000-0000-4000-8000-000000000003', 'coordinator', 'active', now()),
  ('6c000000-0000-4000-8000-000000000004', '6b000000-0000-4000-8000-000000000001', '6a000000-0000-4000-8000-000000000004', 'member', 'active', now());

insert into public.rounds (
  id, group_id, description, scheduled_at, group_time_zone, format, state,
  version, published_at, created_by
)
values
  ('6d000000-0000-4000-8000-000000000001', '6b000000-0000-4000-8000-000000000001', 'Historical result', now() - interval '40 days', 'UTC', 'individual_net', 'completed', 4, now() - interval '39 days', '6a000000-0000-4000-8000-000000000003'),
  ('6d000000-0000-4000-8000-000000000002', '6b000000-0000-4000-8000-000000000001', 'Published result', now() + interval '2 days', 'UTC', 'individual_gross', 'published', 2, now(), '6a000000-0000-4000-8000-000000000003'),
  ('6d000000-0000-4000-8000-000000000003', '6b000000-0000-4000-8000-000000000001', 'Private draft', now() + interval '5 days', 'UTC', 'individual_net', 'draft', 1, null, '6a000000-0000-4000-8000-000000000003'),
  ('6d000000-0000-4000-8000-000000000004', '6b000000-0000-4000-8000-000000000002', 'Other tenant result', now() - interval '40 days', 'UTC', 'individual_net', 'completed', 4, now() - interval '39 days', '6a000000-0000-4000-8000-000000000002');

insert into public.round_participants (
  id, round_id, group_id, membership_id, rsvp_status, quota_snapshot
)
values
  ('6e000000-0000-4000-8000-000000000001', '6d000000-0000-4000-8000-000000000001', '6b000000-0000-4000-8000-000000000001', '6c000000-0000-4000-8000-000000000001', 'playing', 10.00),
  ('6e000000-0000-4000-8000-000000000002', '6d000000-0000-4000-8000-000000000001', '6b000000-0000-4000-8000-000000000001', '6c000000-0000-4000-8000-000000000003', 'playing', 10.00),
  ('6e000000-0000-4000-8000-000000000003', '6d000000-0000-4000-8000-000000000002', '6b000000-0000-4000-8000-000000000001', '6c000000-0000-4000-8000-000000000001', 'no_response', 10.00);

select pg_catalog.set_config('request.jwt.claim.sub', '6a000000-0000-4000-8000-000000000001', true);
select is(
  (select count(*) from public.read_mobile_round_summary('6d000000-0000-4000-8000-000000000001')),
  1::bigint,
  'member can resolve an older completed round outside the list page'
);
select is(
  (select description from public.read_mobile_round_summary('6d000000-0000-4000-8000-000000000001')),
  'Historical result',
  'summary returns the exact target round'
);
select is(
  (select participant_status from public.read_mobile_round_summary('6d000000-0000-4000-8000-000000000001')),
  'playing'::public.round_rsvp_status,
  'summary includes the actor RSVP state'
);
select is(
  (select participant_count from public.read_mobile_round_summary('6d000000-0000-4000-8000-000000000001')),
  2::bigint,
  'summary counts stay tenant-scoped'
);
select is(
  (select playing_count from public.read_mobile_round_summary('6d000000-0000-4000-8000-000000000001')),
  2::bigint,
  'summary exposes playing count'
);
select is(
  (select count(*) from public.read_mobile_round_summary('6d000000-0000-4000-8000-000000000002')),
  1::bigint,
  'participant can resolve a non-completed target'
);
select throws_ok(
  $$ select * from public.read_mobile_round_summary('6d000000-0000-4000-8000-000000000003') $$,
  'P0002',
  'round_not_found',
  'drafts are never exposed through the exact summary'
);
select throws_ok(
  $$ select * from public.read_mobile_round_summary('6d000000-0000-4000-8000-000000000004') $$,
  'P0002',
  'round_not_found',
  'cross-tenant targets remain indistinguishable from missing rounds'
);

select pg_catalog.set_config('request.jwt.claim.sub', '6a000000-0000-4000-8000-000000000004', true);
select throws_ok(
  $$ select * from public.read_mobile_round_summary('6d000000-0000-4000-8000-000000000001') $$,
  'P0003',
  'recovery_session_forbidden',
  'recovery sessions cannot resolve mobile summaries'
);

select * from finish();

rollback;
