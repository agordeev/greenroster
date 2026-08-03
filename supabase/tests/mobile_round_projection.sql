begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

select has_function(
  'public',
  'list_mobile_rounds',
  array['app.utc_instant', 'integer'],
  'actor-derived mobile round list exists'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.list_mobile_rounds(app.utc_instant,integer)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.list_mobile_rounds(app.utc_instant,integer)',
    'execute'
  ),
  'only authenticated callers can list mobile rounds'
);

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at
)
values
  ('4a000000-0000-4000-8000-000000000001', 'round-list-member@example.test', now(), false, false, now(), now()),
  ('4a000000-0000-4000-8000-000000000002', 'round-list-coordinator@example.test', now(), false, false, now(), now()),
  ('4a000000-0000-4000-8000-000000000003', 'round-list-other@example.test', now(), false, false, now(), now()),
  ('4a000000-0000-4000-8000-000000000004', 'round-list-recovery@example.test', now(), false, false, now(), now());

update auth.users
set raw_app_meta_data = '{"greenroster_password_recovery":true}'::jsonb
where id = '4a000000-0000-4000-8000-000000000004';

insert into public.user_profiles (user_id, first_name, last_name)
values
  ('4a000000-0000-4000-8000-000000000001', 'Round', 'Member'),
  ('4a000000-0000-4000-8000-000000000002', 'Round', 'Coordinator'),
  ('4a000000-0000-4000-8000-000000000003', 'Round', 'Other'),
  ('4a000000-0000-4000-8000-000000000004', 'Round', 'Recovery');

insert into public.groups (id, name, time_zone)
values
  ('4b000000-0000-4000-8000-000000000001', 'Round List A', 'UTC'),
  ('4b000000-0000-4000-8000-000000000002', 'Round List B', 'UTC');

insert into public.memberships (id, group_id, user_id, role, status, activated_at)
values
  ('4c000000-0000-4000-8000-000000000001', '4b000000-0000-4000-8000-000000000001', '4a000000-0000-4000-8000-000000000001', 'member', 'active', now()),
  ('4c000000-0000-4000-8000-000000000002', '4b000000-0000-4000-8000-000000000001', '4a000000-0000-4000-8000-000000000002', 'coordinator', 'active', now()),
  ('4c000000-0000-4000-8000-000000000003', '4b000000-0000-4000-8000-000000000002', '4a000000-0000-4000-8000-000000000003', 'member', 'active', now()),
  ('4c000000-0000-4000-8000-000000000004', '4b000000-0000-4000-8000-000000000001', '4a000000-0000-4000-8000-000000000004', 'member', 'active', now());

insert into public.rounds (
  id, group_id, description, scheduled_at, group_time_zone, format, state,
  version, published_at, created_by
)
values
  ('4d000000-0000-4000-8000-000000000001', '4b000000-0000-4000-8000-000000000001', 'Live round', now() + interval '1 hour', 'UTC', 'individual_net', 'live', 2, now(), '4a000000-0000-4000-8000-000000000002'),
  ('4d000000-0000-4000-8000-000000000002', '4b000000-0000-4000-8000-000000000001', 'Upcoming round', now() + interval '2 days', 'UTC', 'individual_gross', 'published', 1, now(), '4a000000-0000-4000-8000-000000000002'),
  ('4d000000-0000-4000-8000-000000000003', '4b000000-0000-4000-8000-000000000001', 'Old result', now() - interval '3 days', 'UTC', 'individual_net', 'completed', 4, now() - interval '2 days', '4a000000-0000-4000-8000-000000000002'),
  ('4d000000-0000-4000-8000-000000000004', '4b000000-0000-4000-8000-000000000001', 'Private draft', now() + interval '5 days', 'UTC', 'individual_net', 'draft', 1, null, '4a000000-0000-4000-8000-000000000002'),
  ('4d000000-0000-4000-8000-000000000005', '4b000000-0000-4000-8000-000000000002', 'Other tenant live', now() + interval '1 hour', 'UTC', 'individual_net', 'live', 1, now(), '4a000000-0000-4000-8000-000000000003');

insert into public.round_participants (
  id, round_id, group_id, membership_id, rsvp_status, quota_snapshot
)
values
  ('4e000000-0000-4000-8000-000000000001', '4d000000-0000-4000-8000-000000000001', '4b000000-0000-4000-8000-000000000001', '4c000000-0000-4000-8000-000000000001', 'playing', 10.00),
  ('4e000000-0000-4000-8000-000000000002', '4d000000-0000-4000-8000-000000000002', '4b000000-0000-4000-8000-000000000001', '4c000000-0000-4000-8000-000000000001', 'no_response', 10.00),
  ('4e000000-0000-4000-8000-000000000003', '4d000000-0000-4000-8000-000000000003', '4b000000-0000-4000-8000-000000000001', '4c000000-0000-4000-8000-000000000001', 'playing', 10.00),
  ('4e000000-0000-4000-8000-000000000004', '4d000000-0000-4000-8000-000000000001', '4b000000-0000-4000-8000-000000000001', '4c000000-0000-4000-8000-000000000002', 'playing', 10.00),
  ('4e000000-0000-4000-8000-000000000005', '4d000000-0000-4000-8000-000000000002', '4b000000-0000-4000-8000-000000000001', '4c000000-0000-4000-8000-000000000002', 'playing', 10.00),
  ('4e000000-0000-4000-8000-000000000006', '4d000000-0000-4000-8000-000000000003', '4b000000-0000-4000-8000-000000000001', '4c000000-0000-4000-8000-000000000002', 'playing', 10.00);

select pg_catalog.set_config('request.jwt.claim.sub', '4a000000-0000-4000-8000-000000000001', true);
create temporary table member_rounds on commit drop as
select * from public.list_mobile_rounds(null, 1);
select is((select count(*) from member_rounds), 3::bigint, 'member receives live, published, and paged completed participant rounds');
select is((select state from member_rounds limit 1), 'live'::public.round_state, 'live rounds sort before upcoming rounds');
select is((select participant_status from member_rounds where round_id = '4d000000-0000-4000-8000-000000000001'), 'playing'::public.round_rsvp_status, 'member RSVP status is included');
select is((select participant_count from member_rounds where round_id = '4d000000-0000-4000-8000-000000000001'), 2::bigint, 'participant count is tenant-derived');
select is((select playing_count from member_rounds where round_id = '4d000000-0000-4000-8000-000000000001'), 2::bigint, 'playing count is tenant-derived');
select throws_ok(
  $$ select * from public.list_mobile_rounds(null, 0) $$,
  '22023',
  'round_list_limit_invalid',
  'invalid zero limit is rejected'
);

select pg_catalog.set_config('request.jwt.claim.sub', '4a000000-0000-4000-8000-000000000002', true);
select is((select count(*) from public.list_mobile_rounds(null, 1)), 3::bigint, 'coordinator sees tenant rounds including rounds without a participant row');
select is((select count(*) from public.list_mobile_rounds(null, 1) where state = 'draft'), 0::bigint, 'drafts never enter the mobile list');

select pg_catalog.set_config('request.jwt.claim.sub', '4a000000-0000-4000-8000-000000000004', true);
select throws_ok(
  $$ select * from public.list_mobile_rounds(null, 25) $$,
  'P0003',
  'recovery_session_forbidden',
  'recovery sessions cannot list mobile rounds'
);

select * from finish();

rollback;
