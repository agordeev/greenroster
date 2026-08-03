begin;

create extension if not exists pgtap with schema extensions;

select plan(26);

select has_function(
  'app',
  'round_completion_readiness',
  array['app.entity_id', 'app.entity_id'],
  'the private completion-readiness helper exists'
);
select ok(
  has_function_privilege(
    'service_role',
    'app.round_completion_readiness(app.entity_id,app.entity_id)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'app.round_completion_readiness(app.entity_id,app.entity_id)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'app.round_completion_readiness(app.entity_id,app.entity_id)',
    'execute'
  ),
  'only the trusted server can execute completion readiness'
);
select ok(
  (select prosecdef
      and provolatile = 's'
      and proconfig = array['search_path=""']
      and pg_catalog.pg_get_function_result(oid) =
        'TABLE(round_id app.entity_id, group_id app.entity_id, readiness_status text, blocker_code text, warning_code text, participant_id app.entity_id, participant_kind round_participant_kind, details jsonb)'
   from pg_catalog.pg_proc
   where oid = 'app.round_completion_readiness(app.entity_id,app.entity_id)'::regprocedure),
  'readiness is a stable security-definer boundary with a pinned result contract'
);

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at
)
values
  ('6a000000-0000-4000-8000-000000000001', 'readiness-admin-a@example.test', now(), false, false, now(), now()),
  ('6a000000-0000-4000-8000-000000000002', 'readiness-admin-b@example.test', now(), false, false, now(), now());

insert into public.groups (id, name, time_zone)
values
  ('6b000000-0000-4000-8000-000000000001', 'Readiness Group A', 'UTC'),
  ('6b000000-0000-4000-8000-000000000002', 'Readiness Group B', 'UTC');

insert into public.memberships (id, group_id, user_id, role, status, activated_at)
values
  ('6c000000-0000-4000-8000-000000000001', '6b000000-0000-4000-8000-000000000001', '6a000000-0000-4000-8000-000000000001', 'administrator', 'active', now()),
  ('6c000000-0000-4000-8000-000000000002', '6b000000-0000-4000-8000-000000000001', null, 'member', 'pending', null),
  ('6c000000-0000-4000-8000-000000000003', '6b000000-0000-4000-8000-000000000001', null, 'member', 'pending', null),
  ('6c000000-0000-4000-8000-000000000004', '6b000000-0000-4000-8000-000000000001', null, 'member', 'pending', null),
  ('6c000000-0000-4000-8000-000000000005', '6b000000-0000-4000-8000-000000000001', null, 'member', 'pending', null),
  ('6c000000-0000-4000-8000-000000000006', '6b000000-0000-4000-8000-000000000001', null, 'member', 'pending', null),
  ('6c000000-0000-4000-8000-000000000007', '6b000000-0000-4000-8000-000000000001', null, 'member', 'pending', null),
  ('6c000000-0000-4000-8000-000000000009', '6b000000-0000-4000-8000-000000000001', null, 'member', 'pending', null),
  ('6c000000-0000-4000-8000-000000000010', '6b000000-0000-4000-8000-000000000001', null, 'member', 'pending', null),
  ('6c000000-0000-4000-8000-000000000011', '6b000000-0000-4000-8000-000000000001', null, 'member', 'pending', null),
  ('6c000000-0000-4000-8000-000000000008', '6b000000-0000-4000-8000-000000000002', '6a000000-0000-4000-8000-000000000002', 'administrator', 'active', now());

insert into public.group_quota_settings (
  group_id, method, moving_average_history_length, precision, rounding_rule, version, updated_by
)
values (
  '6b000000-0000-4000-8000-000000000001',
  'moving_average',
  4,
  2,
  'half_away_from_zero',
  1,
  '6a000000-0000-4000-8000-000000000001'
);

insert into public.rounds (
  id, group_id, description, scheduled_at, group_time_zone, format, state,
  published_at, created_by
)
values
  ('6d000000-0000-4000-8000-000000000001', '6b000000-0000-4000-8000-000000000001', 'Ready net', now(), 'UTC', 'individual_net', 'live', now(), '6a000000-0000-4000-8000-000000000001'),
  ('6d000000-0000-4000-8000-000000000002', '6b000000-0000-4000-8000-000000000001', 'Ready gross', now(), 'UTC', 'individual_gross', 'live', now(), '6a000000-0000-4000-8000-000000000001'),
  ('6d000000-0000-4000-8000-000000000003', '6b000000-0000-4000-8000-000000000001', 'Missing net inputs', now(), 'UTC', 'individual_net', 'live', now(), '6a000000-0000-4000-8000-000000000001'),
  ('6d000000-0000-4000-8000-000000000004', '6b000000-0000-4000-8000-000000000001', 'Missing snapshot', now(), 'UTC', 'individual_net', 'live', now(), '6a000000-0000-4000-8000-000000000001'),
  ('6d000000-0000-4000-8000-000000000005', '6b000000-0000-4000-8000-000000000001', 'Mismatched snapshot', now(), 'UTC', 'individual_gross', 'live', now(), '6a000000-0000-4000-8000-000000000001'),
  ('6d000000-0000-4000-8000-000000000006', '6b000000-0000-4000-8000-000000000001', 'Invalid bands', now(), 'UTC', 'individual_net', 'live', now(), '6a000000-0000-4000-8000-000000000001'),
  ('6d000000-0000-4000-8000-000000000007', '6b000000-0000-4000-8000-000000000001', 'Missing gross input', now(), 'UTC', 'individual_gross', 'live', now(), '6a000000-0000-4000-8000-000000000001'),
  ('6d000000-0000-4000-8000-000000000008', '6b000000-0000-4000-8000-000000000001', 'Not live', now(), 'UTC', 'individual_net', 'published', now(), '6a000000-0000-4000-8000-000000000001'),
  ('6d000000-0000-4000-8000-000000000010', '6b000000-0000-4000-8000-000000000001', 'Method C outcomes', now(), 'UTC', 'individual_gross', 'live', now(), '6a000000-0000-4000-8000-000000000001');

insert into public.rounds (
  id, group_id, description, scheduled_at, group_time_zone, format, state,
  published_at, created_by, enable_gross_score, enable_net_score
)
values (
  '6d000000-0000-4000-8000-000000000009',
  '6b000000-0000-4000-8000-000000000001',
  'Optional blanks',
  now(),
  'UTC',
  'individual_net',
  'live',
  now(),
  '6a000000-0000-4000-8000-000000000001',
  true,
  true
);

insert into public.round_rule_snapshots (
  round_id, group_id, format, quota_method, moving_average_history_length,
  quota_precision, quota_rounding_rule, adjustment_bands, settings_version
)
values
  ('6d000000-0000-4000-8000-000000000001', '6b000000-0000-4000-8000-000000000001', 'individual_net', 'moving_average', 4, 2, 'half_away_from_zero', '[]', 1),
  ('6d000000-0000-4000-8000-000000000002', '6b000000-0000-4000-8000-000000000001', 'individual_gross', 'moving_average', 4, 2, 'half_away_from_zero', '[]', 1),
  ('6d000000-0000-4000-8000-000000000003', '6b000000-0000-4000-8000-000000000001', 'individual_net', 'moving_average', 4, 2, 'half_away_from_zero', '[]', 1),
  ('6d000000-0000-4000-8000-000000000005', '6b000000-0000-4000-8000-000000000001', 'individual_net', 'moving_average', 4, 2, 'half_away_from_zero', '[]', 1),
  ('6d000000-0000-4000-8000-000000000006', '6b000000-0000-4000-8000-000000000001', 'individual_net', 'previous_plus_minus', null, 2, 'half_away_from_zero', '[{"lower_bound": -100, "lower_inclusive": true, "upper_bound": 0, "upper_inclusive": true, "adjustment": 0}, {"lower_bound": 1, "lower_inclusive": true, "upper_bound": 100, "upper_inclusive": true, "adjustment": 0}]', 1),
  ('6d000000-0000-4000-8000-000000000007', '6b000000-0000-4000-8000-000000000001', 'individual_gross', 'moving_average', 4, 2, 'half_away_from_zero', '[]', 1),
  ('6d000000-0000-4000-8000-000000000008', '6b000000-0000-4000-8000-000000000001', 'individual_net', 'moving_average', 4, 2, 'half_away_from_zero', '[]', 1),
  ('6d000000-0000-4000-8000-000000000009', '6b000000-0000-4000-8000-000000000001', 'individual_net', 'moving_average', 4, 2, 'half_away_from_zero', '[]', 1),
  ('6d000000-0000-4000-8000-000000000010', '6b000000-0000-4000-8000-000000000001', 'individual_gross', 'previous_plus_minus', null, 2, 'half_away_from_zero', '[{"lower_bound": -100, "lower_inclusive": true, "upper_bound": 100, "upper_inclusive": true, "adjustment": 10}]', 1);

insert into public.round_participants (
  id, round_id, group_id, membership_id, participant_kind, rsvp_status, quota_snapshot
)
values
  ('6e000000-0000-4000-8000-000000000001', '6d000000-0000-4000-8000-000000000001', '6b000000-0000-4000-8000-000000000001', '6c000000-0000-4000-8000-000000000002', 'member', 'playing', 10),
  ('6e000000-0000-4000-8000-000000000011', '6d000000-0000-4000-8000-000000000002', '6b000000-0000-4000-8000-000000000001', '6c000000-0000-4000-8000-000000000003', 'member', 'playing', null),
  ('6e000000-0000-4000-8000-000000000021', '6d000000-0000-4000-8000-000000000003', '6b000000-0000-4000-8000-000000000001', '6c000000-0000-4000-8000-000000000004', 'member', 'playing', 10),
  ('6e000000-0000-4000-8000-000000000022', '6d000000-0000-4000-8000-000000000003', '6b000000-0000-4000-8000-000000000001', '6c000000-0000-4000-8000-000000000005', 'member', 'playing', null),
  ('6e000000-0000-4000-8000-000000000023', '6d000000-0000-4000-8000-000000000003', '6b000000-0000-4000-8000-000000000001', '6c000000-0000-4000-8000-000000000006', 'member', 'playing', 10),
  ('6e000000-0000-4000-8000-000000000025', '6d000000-0000-4000-8000-000000000003', '6b000000-0000-4000-8000-000000000001', '6c000000-0000-4000-8000-000000000007', 'member', 'playing', 10),
  ('6e000000-0000-4000-8000-000000000026', '6d000000-0000-4000-8000-000000000003', '6b000000-0000-4000-8000-000000000001', '6c000000-0000-4000-8000-000000000009', 'member', 'playing', 10),
  ('6e000000-0000-4000-8000-000000000041', '6d000000-0000-4000-8000-000000000009', '6b000000-0000-4000-8000-000000000001', '6c000000-0000-4000-8000-000000000009', 'member', 'playing', 10),
  ('6e000000-0000-4000-8000-000000000042', '6d000000-0000-4000-8000-000000000010', '6b000000-0000-4000-8000-000000000001', '6c000000-0000-4000-8000-000000000010', 'member', 'playing', 95),
  ('6e000000-0000-4000-8000-000000000043', '6d000000-0000-4000-8000-000000000010', '6b000000-0000-4000-8000-000000000001', '6c000000-0000-4000-8000-000000000011', 'member', 'playing', null);

insert into public.round_participants (
  id, round_id, group_id, participant_kind, sponsor_membership_id,
  guest_first_name, guest_last_name, rsvp_status, quota_snapshot
)
values
  ('6e000000-0000-4000-8000-000000000002', '6d000000-0000-4000-8000-000000000001', '6b000000-0000-4000-8000-000000000001', 'guest', '6c000000-0000-4000-8000-000000000002', 'Ready', 'Guest', 'playing', 5),
  ('6e000000-0000-4000-8000-000000000024', '6d000000-0000-4000-8000-000000000003', '6b000000-0000-4000-8000-000000000001', 'guest', '6c000000-0000-4000-8000-000000000002', 'Missing', 'Guest', 'playing', 5),
  ('6e000000-0000-4000-8000-000000000031', '6d000000-0000-4000-8000-000000000007', '6b000000-0000-4000-8000-000000000001', 'guest', '6c000000-0000-4000-8000-000000000002', 'Missing', 'Gross', 'playing', null);

insert into public.score_revisions (
  id, group_id, round_id, participant_id, revision_number, base_version,
  device_operation_id, actor_user_id, source, client_changed_at, correlation_id,
  operation_id, changed_fields, golf_points, plus_minus, ranking_value,
  request_fingerprint
)
values
  ('6f000000-0000-4000-8000-000000000001', '6b000000-0000-4000-8000-000000000001', '6d000000-0000-4000-8000-000000000001', '6e000000-0000-4000-8000-000000000001', 1, 0, '70000000-0000-4000-8000-000000000001', '6a000000-0000-4000-8000-000000000001', 'portal', now(), '71000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', '{"golf_points": true}', 20, 10, 10, repeat('a', 64)),
  ('6f000000-0000-4000-8000-000000000002', '6b000000-0000-4000-8000-000000000001', '6d000000-0000-4000-8000-000000000001', '6e000000-0000-4000-8000-000000000002', 1, 0, '70000000-0000-4000-8000-000000000002', '6a000000-0000-4000-8000-000000000001', 'portal', now(), '71000000-0000-4000-8000-000000000002', '72000000-0000-4000-8000-000000000002', '{"golf_points": true}', 15, 10, 10, repeat('b', 64)),
  ('6f000000-0000-4000-8000-000000000003', '6b000000-0000-4000-8000-000000000001', '6d000000-0000-4000-8000-000000000002', '6e000000-0000-4000-8000-000000000011', 1, 0, '70000000-0000-4000-8000-000000000003', '6a000000-0000-4000-8000-000000000001', 'portal', now(), '71000000-0000-4000-8000-000000000003', '72000000-0000-4000-8000-000000000003', '{"golf_points": true}', 30, null, 30, repeat('c', 64)),
  ('6f000000-0000-4000-8000-000000000004', '6b000000-0000-4000-8000-000000000001', '6d000000-0000-4000-8000-000000000003', '6e000000-0000-4000-8000-000000000021', 1, 0, '70000000-0000-4000-8000-000000000004', '6a000000-0000-4000-8000-000000000001', 'portal', now(), '71000000-0000-4000-8000-000000000004', '72000000-0000-4000-8000-000000000004', '{"golf_points": true}', 20, 5, 5, repeat('d', 64)),
  ('6f000000-0000-4000-8000-000000000005', '6b000000-0000-4000-8000-000000000001', '6d000000-0000-4000-8000-000000000003', '6e000000-0000-4000-8000-000000000022', 1, 0, '70000000-0000-4000-8000-000000000005', '6a000000-0000-4000-8000-000000000001', 'portal', now(), '71000000-0000-4000-8000-000000000005', '72000000-0000-4000-8000-000000000005', '{"golf_points": true}', 20, null, 20, repeat('e', 64)),
  ('6f000000-0000-4000-8000-000000000006', '6b000000-0000-4000-8000-000000000001', '6d000000-0000-4000-8000-000000000003', '6e000000-0000-4000-8000-000000000025', 1, 0, '70000000-0000-4000-8000-000000000006', '6a000000-0000-4000-8000-000000000001', 'portal', now(), '71000000-0000-4000-8000-000000000006', '72000000-0000-4000-8000-000000000006', '{"golf_points": true}', 20, 10, 10, repeat('f', 64)),
  ('6f000000-0000-4000-8000-000000000007', '6b000000-0000-4000-8000-000000000001', '6d000000-0000-4000-8000-000000000003', '6e000000-0000-4000-8000-000000000026', 1, 0, '70000000-0000-4000-8000-000000000007', '6a000000-0000-4000-8000-000000000001', 'portal', now(), '71000000-0000-4000-8000-000000000007', '72000000-0000-4000-8000-000000000007', '{"golf_points": true}', 20, 10, 10, repeat('1', 64)),
  ('6f000000-0000-4000-8000-000000000008', '6b000000-0000-4000-8000-000000000001', '6d000000-0000-4000-8000-000000000009', '6e000000-0000-4000-8000-000000000041', 1, 0, '70000000-0000-4000-8000-000000000008', '6a000000-0000-4000-8000-000000000001', 'portal', now(), '71000000-0000-4000-8000-000000000008', '72000000-0000-4000-8000-000000000008', '{"golf_points": true}', 20, 10, 10, repeat('2', 64)),
  ('6f000000-0000-4000-8000-000000000009', '6b000000-0000-4000-8000-000000000001', '6d000000-0000-4000-8000-000000000010', '6e000000-0000-4000-8000-000000000042', 1, 0, '70000000-0000-4000-8000-000000000009', '6a000000-0000-4000-8000-000000000001', 'portal', now(), '71000000-0000-4000-8000-000000000009', '72000000-0000-4000-8000-000000000009', '{"golf_points": true}', 100, 5, 100, repeat('3', 64)),
  ('6f000000-0000-4000-8000-000000000010', '6b000000-0000-4000-8000-000000000001', '6d000000-0000-4000-8000-000000000010', '6e000000-0000-4000-8000-000000000043', 1, 0, '70000000-0000-4000-8000-000000000010', '6a000000-0000-4000-8000-000000000001', 'portal', now(), '71000000-0000-4000-8000-000000000010', '72000000-0000-4000-8000-000000000010', '{"golf_points": true}', 30, null, 30, repeat('4', 64));

insert into public.participant_score_projections (
  participant_id, group_id, round_id, golf_points, plus_minus, ranking_value, version, last_revision_id
)
values
  ('6e000000-0000-4000-8000-000000000001', '6b000000-0000-4000-8000-000000000001', '6d000000-0000-4000-8000-000000000001', 20, 10, 10, 1, '6f000000-0000-4000-8000-000000000001'),
  ('6e000000-0000-4000-8000-000000000002', '6b000000-0000-4000-8000-000000000001', '6d000000-0000-4000-8000-000000000001', 15, 10, 10, 1, '6f000000-0000-4000-8000-000000000002'),
  ('6e000000-0000-4000-8000-000000000011', '6b000000-0000-4000-8000-000000000001', '6d000000-0000-4000-8000-000000000002', 30, null, 30, 1, '6f000000-0000-4000-8000-000000000003'),
  ('6e000000-0000-4000-8000-000000000021', '6b000000-0000-4000-8000-000000000001', '6d000000-0000-4000-8000-000000000003', 20, 5, 5, 1, '6f000000-0000-4000-8000-000000000004'),
  ('6e000000-0000-4000-8000-000000000022', '6b000000-0000-4000-8000-000000000001', '6d000000-0000-4000-8000-000000000003', 20, null, 20, 1, '6f000000-0000-4000-8000-000000000005'),
  ('6e000000-0000-4000-8000-000000000025', '6b000000-0000-4000-8000-000000000001', '6d000000-0000-4000-8000-000000000003', 20, 10, 10, 1, null),
  ('6e000000-0000-4000-8000-000000000026', '6b000000-0000-4000-8000-000000000001', '6d000000-0000-4000-8000-000000000003', 20, 10, 9, 1, '6f000000-0000-4000-8000-000000000007'),
  ('6e000000-0000-4000-8000-000000000041', '6b000000-0000-4000-8000-000000000001', '6d000000-0000-4000-8000-000000000009', 20, 10, 10, 1, '6f000000-0000-4000-8000-000000000008'),
  ('6e000000-0000-4000-8000-000000000042', '6b000000-0000-4000-8000-000000000001', '6d000000-0000-4000-8000-000000000010', 100, 5, 100, 1, '6f000000-0000-4000-8000-000000000009'),
  ('6e000000-0000-4000-8000-000000000043', '6b000000-0000-4000-8000-000000000001', '6d000000-0000-4000-8000-000000000010', 30, null, 30, 1, '6f000000-0000-4000-8000-000000000010');

create temporary table ready_net as
select *
from app.round_completion_readiness(
  '6d000000-0000-4000-8000-000000000001',
  '6b000000-0000-4000-8000-000000000001'
);
select is((select count(*) from ready_net), 1::bigint, 'complete Net member and guest inputs are ready');
select is((select readiness_status from ready_net), 'server_ready', 'server-ready Net round returns server-ready status');

set local role service_role;
select is(
  (select readiness_status
   from app.round_completion_readiness(
     '6d000000-0000-4000-8000-000000000001',
     '6b000000-0000-4000-8000-000000000001'
   )),
  'server_ready',
  'trusted service role can execute readiness against protected tables'
);
reset role;

create temporary table ready_gross as
select *
from app.round_completion_readiness(
  '6d000000-0000-4000-8000-000000000002',
  '6b000000-0000-4000-8000-000000000001'
);
select is((select count(*) from ready_gross), 1::bigint, 'Gross readiness does not require an informational quota');
select is((select readiness_status from ready_gross), 'server_ready', 'Gross round with points and no quota is server-ready');

create temporary table blocked_net as
select *
from app.round_completion_readiness(
  '6d000000-0000-4000-8000-000000000003',
  '6b000000-0000-4000-8000-000000000001'
);
select ok(exists (select 1 from blocked_net where blocker_code = 'golf_points_missing' and participant_id = '6e000000-0000-4000-8000-000000000023'), 'missing Net points block completion');
select ok(exists (select 1 from blocked_net where blocker_code = 'golf_points_missing' and participant_kind = 'guest'), 'missing guest points are returned as a participant blocker');
select ok(exists (select 1 from blocked_net where blocker_code = 'net_quota_missing' and participant_id = '6e000000-0000-4000-8000-000000000022'), 'Net quota is required');
select ok(exists (select 1 from blocked_net where blocker_code = 'plus_minus_invalid' and participant_id = '6e000000-0000-4000-8000-000000000021'), 'invalid Net plus/minus blocks completion');
select ok(exists (select 1 from blocked_net where blocker_code = 'ranking_value_invalid' and participant_id = '6e000000-0000-4000-8000-000000000021'), 'invalid Net ranking value blocks completion');
select ok(exists (select 1 from blocked_net where blocker_code = 'score_revision_missing' and participant_id = '6e000000-0000-4000-8000-000000000025'), 'missing current score revision provenance blocks completion');
select ok(exists (select 1 from blocked_net where blocker_code = 'score_revision_mismatch' and participant_id = '6e000000-0000-4000-8000-000000000026'), 'mismatched score revision provenance blocks completion');

select ok(exists (
  select 1
  from app.round_completion_readiness(
    '6d000000-0000-4000-8000-000000000004',
    '6b000000-0000-4000-8000-000000000001'
  )
  where blocker_code = 'rule_snapshot_missing'
), 'an absent immutable rule snapshot blocks completion');
select ok(exists (
  select 1
  from app.round_completion_readiness(
    '6d000000-0000-4000-8000-000000000005',
    '6b000000-0000-4000-8000-000000000001'
  )
  where blocker_code = 'rule_snapshot_mismatch'
), 'a snapshot/round format mismatch blocks completion');
select ok(exists (
  select 1
  from app.round_completion_readiness(
    '6d000000-0000-4000-8000-000000000006',
    '6b000000-0000-4000-8000-000000000001'
  )
  where blocker_code = 'rule_configuration_invalid'
), 'a nondeterministic Method C snapshot blocks completion');
select ok(exists (
  select 1
  from app.round_completion_readiness(
    '6d000000-0000-4000-8000-000000000007',
    '6b000000-0000-4000-8000-000000000001'
  )
  where blocker_code = 'golf_points_missing'
    and participant_kind = 'guest'
), 'Gross also requires points and includes missing guests');

select ok(exists (
  select 1
  from app.round_completion_readiness(
    '6d000000-0000-4000-8000-000000000009',
    '6b000000-0000-4000-8000-000000000001'
  )
  where readiness_status = 'warning'
    and warning_code = 'optional_score_field_blank'
    and participant_id = '6e000000-0000-4000-8000-000000000041'
    and details ->> 'field' = 'gross_score'
), 'blank optional Gross score is surfaced as a warning');
select is((
  select count(*)
  from app.round_completion_readiness(
    '6d000000-0000-4000-8000-000000000009',
    '6b000000-0000-4000-8000-000000000001'
  )
  where readiness_status = 'warning'
), 2::bigint, 'blank optional score fields produce one warning per enabled field');
select ok(exists (
  select 1
  from app.round_completion_readiness(
    '6d000000-0000-4000-8000-000000000008',
    '6b000000-0000-4000-8000-000000000001'
  )
  where blocker_code = 'round_state_invalid'
), 'a non-live round blocks completion');
select ok(exists (
  select 1
  from app.round_completion_readiness(
    '6d000000-0000-4000-8000-000000000010',
    '6b000000-0000-4000-8000-000000000001'
  )
  where blocker_code = 'quota_result_invalid'
    and participant_id = '6e000000-0000-4000-8000-000000000042'
), 'Method C blocks an out-of-range next quota');
select ok(exists (
  select 1
  from app.round_completion_readiness(
    '6d000000-0000-4000-8000-000000000010',
    '6b000000-0000-4000-8000-000000000001'
  )
  where blocker_code = 'quota_calculation_input_missing'
    and participant_id = '6e000000-0000-4000-8000-000000000043'
), 'Method C blocks when prior quota inputs are missing');

select throws_ok(
  $$ select * from app.round_completion_readiness(
    '6d000000-0000-4000-8000-000000000001',
    '6b000000-0000-4000-8000-000000000002'
  ) $$,
  'P0002',
  'round_not_found',
  'cross-tenant round/group keys do not reveal readiness'
);
select throws_ok(
  $$ select * from app.round_completion_readiness(null, '6b000000-0000-4000-8000-000000000001') $$,
  '22004',
  'round_completion_context_required',
  'readiness requires explicit round and group keys'
);

select * from finish();

rollback;
