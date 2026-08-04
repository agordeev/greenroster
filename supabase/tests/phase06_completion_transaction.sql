begin;

create extension if not exists pgtap with schema extensions;

select plan(33);

select has_table(
  'public',
  'membership_standings_projections',
  'current standings projection exists'
);
select has_function(
  'public',
  'complete_live_round',
  array['uuid', 'uuid', 'bigint', 'boolean', 'uuid', 'uuid'],
  'the service-only completion transaction exists'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.complete_live_round(uuid,uuid,bigint,boolean,uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.complete_live_round(uuid,uuid,bigint,boolean,uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.complete_live_round(uuid,uuid,bigint,boolean,uuid,uuid)',
    'execute'
  ),
  'only the trusted server can complete a round'
);
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class
   where oid = 'public.membership_standings_projections'::regclass),
  'standings projections are force-RLS with no direct table access'
);

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at
)
values
  ('d1000000-0000-4000-8000-000000000001', 'completion-admin@example.test', now(), false, false, now(), now()),
  ('d1000000-0000-4000-8000-000000000002', 'completion-member@example.test', now(), false, false, now(), now());

insert into public.user_profiles (user_id, display_name, first_name, last_name)
values
  ('d1000000-0000-4000-8000-000000000001', 'Completion Admin', 'Completion', 'Admin'),
  ('d1000000-0000-4000-8000-000000000002', 'Completion Member', 'Completion', 'Member');

insert into public.groups (id, name, time_zone)
values
  ('d2000000-0000-4000-8000-000000000001', 'Completion Group', 'UTC'),
  ('d2000000-0000-4000-8000-000000000002', 'Other Completion Group', 'UTC');

insert into public.memberships (
  id, group_id, user_id, role, status, activated_at,
  initial_quota, uses_initial_quota, initial_quota_provenance
)
values
  ('d3000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'administrator', 'active', now(), null, false, null),
  ('d3000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002', 'member', 'active', now(), 20, true, 'member_bootstrap');

insert into public.group_quota_settings (
  group_id, method, moving_average_history_length, precision, rounding_rule,
  version, updated_by, participation_merit
)
values (
  'd2000000-0000-4000-8000-000000000001', 'moving_average', 4, 2,
  'half_away_from_zero', 1, 'd1000000-0000-4000-8000-000000000001', 2
);

insert into public.placement_merit_rows (group_id, rank, merit_points)
values ('d2000000-0000-4000-8000-000000000001', 1, 10);

insert into public.membership_quota_seed_totals (membership_id, group_id, position, point_total)
values
  ('d3000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000001', 1, 10),
  ('d3000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000001', 2, 20),
  ('d3000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000001', 3, 30);

insert into public.rounds (
  id, group_id, description, scheduled_at, group_time_zone, format, state,
  published_at, created_by
)
values
  ('d4000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 'Completion round', now(), 'UTC', 'individual_net', 'live', now(), 'd1000000-0000-4000-8000-000000000001'),
  ('d4000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000002', 'Other tenant round', now(), 'UTC', 'individual_net', 'live', now(), 'd1000000-0000-4000-8000-000000000001'),
  ('d4000000-0000-4000-8000-000000000003', 'd2000000-0000-4000-8000-000000000001', 'Mobile blocked round', now(), 'UTC', 'individual_net', 'live', now(), 'd1000000-0000-4000-8000-000000000001');

insert into public.round_rule_snapshots (
  round_id, group_id, format, quota_method, moving_average_history_length,
  quota_precision, quota_rounding_rule, adjustment_bands, settings_version
)
values
  ('d4000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 'individual_net', 'moving_average', 4, 2, 'half_away_from_zero', '[]', 1),
  ('d4000000-0000-4000-8000-000000000003', 'd2000000-0000-4000-8000-000000000001', 'individual_net', 'moving_average', 4, 2, 'half_away_from_zero', '[]', 1);

insert into public.round_participants (
  id, round_id, group_id, membership_id, participant_kind, sponsor_membership_id,
  guest_first_name, guest_last_name, rsvp_status, quota_snapshot
)
values
  ('d5000000-0000-4000-8000-000000000001', 'd4000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000002', 'member', null, null, null, 'playing', 20),
  ('d5000000-0000-4000-8000-000000000002', 'd4000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', null, 'guest', 'd3000000-0000-4000-8000-000000000001', 'Mobile', 'Guest', 'playing', 5),
  ('d5000000-0000-4000-8000-000000000003', 'd4000000-0000-4000-8000-000000000003', 'd2000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000002', 'member', null, null, null, 'playing', 20);

insert into public.score_revisions (
  id, group_id, round_id, participant_id, revision_number, base_version,
  device_operation_id, actor_user_id, source, client_changed_at, correlation_id,
  operation_id, changed_fields, golf_points, manual_merit, plus_minus, ranking_value,
  request_fingerprint
)
values
  ('d6000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 'd4000000-0000-4000-8000-000000000001', 'd5000000-0000-4000-8000-000000000001', 1, 0, 'd7000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'portal', now(), 'd8000000-0000-4000-8000-000000000001', 'd9000000-0000-4000-8000-000000000001', '{"golf_points": true}', 40, 1, 20, 20, repeat('1', 64)),
  ('d6000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000001', 'd4000000-0000-4000-8000-000000000001', 'd5000000-0000-4000-8000-000000000002', 1, 0, 'd7000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000001', 'portal', now(), 'd8000000-0000-4000-8000-000000000002', 'd9000000-0000-4000-8000-000000000002', '{"golf_points": true}', 15, 99, 10, 10, repeat('2', 64)),
  ('d6000000-0000-4000-8000-000000000003', 'd2000000-0000-4000-8000-000000000001', 'd4000000-0000-4000-8000-000000000003', 'd5000000-0000-4000-8000-000000000003', 1, 0, 'd7000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000001', 'mobile', now(), 'd8000000-0000-4000-8000-000000000003', 'd9000000-0000-4000-8000-000000000003', '{"golf_points": true}', 40, 0, 20, 20, repeat('3', 64));

insert into public.participant_score_projections (
  participant_id, group_id, round_id, golf_points, manual_merit,
  plus_minus, ranking_value, version, last_revision_id
)
values
  ('d5000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 'd4000000-0000-4000-8000-000000000001', 40, 1, 20, 20, 1, 'd6000000-0000-4000-8000-000000000001'),
  ('d5000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000001', 'd4000000-0000-4000-8000-000000000001', 15, 99, 10, 10, 1, 'd6000000-0000-4000-8000-000000000002'),
  ('d5000000-0000-4000-8000-000000000003', 'd2000000-0000-4000-8000-000000000001', 'd4000000-0000-4000-8000-000000000003', 40, 0, 20, 20, 1, 'd6000000-0000-4000-8000-000000000003');

create temporary table completion_result as
select *
from public.complete_live_round(
  'd1000000-0000-4000-8000-000000000001',
  'd4000000-0000-4000-8000-000000000001',
  1,
  true,
  'da000000-0000-4000-8000-000000000001',
  'db000000-0000-4000-8000-000000000001'
);

select is((select state from completion_result), 'completed'::public.round_state, 'completion returns Completed state');
select is((select version from completion_result), 2::bigint, 'completion advances the round version');
select is((select state from public.rounds where id = 'd4000000-0000-4000-8000-000000000001'), 'completed'::public.round_state, 'round scoring is locked by completion');
select is((select count(*) from public.round_completion_runs where round_id = 'd4000000-0000-4000-8000-000000000001'), 1::bigint, 'one official completion run is retained');
select is((select count(*) from public.round_official_results where round_id = 'd4000000-0000-4000-8000-000000000001'), 2::bigint, 'member and guest official result snapshots are retained');
select is((select total_merit from public.round_official_results where participant_id = 'd5000000-0000-4000-8000-000000000001'), 13::numeric, 'member merit freezes participation placement and manual components');
select is((select total_merit from public.round_official_results where participant_id = 'd5000000-0000-4000-8000-000000000002'), 0::numeric, 'guest receives no permanent merit');
select is((select count(*) from public.membership_quota_history where group_id = 'd2000000-0000-4000-8000-000000000001'), 1::bigint, 'only the permanent member enters quota history');
select is((select quota_after::numeric from public.membership_quota_history where membership_id = 'd3000000-0000-4000-8000-000000000002'), 25::numeric, 'completion persists the candidate-aware moving-average quota');
select ok(not (select uses_initial_quota from public.memberships where id = 'd3000000-0000-4000-8000-000000000002'), 'bootstrap quota use deactivates at the configured threshold');
select is((select projected_quota::numeric from public.membership_quota_projections where membership_id = 'd3000000-0000-4000-8000-000000000002'), 25::numeric, 'current quota projection is updated atomically');
select is((select merit_total from public.membership_standings_projections where membership_id = 'd3000000-0000-4000-8000-000000000002'), 13::numeric, 'standings projection includes member merit');
select is((select rounds_played from public.membership_standings_projections where membership_id = 'd3000000-0000-4000-8000-000000000002'), 1::bigint, 'standings projection counts the official member round');
select is((select standing_rank from public.membership_standings_projections where membership_id = 'd3000000-0000-4000-8000-000000000002'), 1::bigint, 'standings projection assigns the competition rank');
select is((select count(*) from public.notification_outbox_jobs where event_type = 'results_published'), 1::bigint, 'completion queues one results-published outbox job');
select is((select idempotency_key from public.notification_outbox_jobs where event_type = 'results_published'), 'results_published:' || (select completion_id::text from completion_result), 'results outbox is keyed by the completion run');
select is((select count(*) from public.audit_events where action = 'round.completed' and target_id = 'd4000000-0000-4000-8000-000000000001'), 1::bigint, 'completion writes one audited lifecycle event');

create temporary table completion_replay as
select *
from public.complete_live_round(
  'd1000000-0000-4000-8000-000000000001',
  'd4000000-0000-4000-8000-000000000001',
  1,
  true,
  'da000000-0000-4000-8000-000000000001',
  'db000000-0000-4000-8000-000000000001'
);
select is((select completion_id from completion_replay), (select completion_id from completion_result), 'same operation replays the committed completion');
select is((select count(*) from public.round_completion_runs where round_id = 'd4000000-0000-4000-8000-000000000001'), 1::bigint, 'exact replay does not duplicate completion runs');
select is((select count(*) from public.notification_outbox_jobs where event_type = 'results_published'), 1::bigint, 'exact replay does not duplicate results notifications');
select is((select count(*) from public.audit_events where action = 'round.completed' and target_id = 'd4000000-0000-4000-8000-000000000001'), 1::bigint, 'exact replay does not duplicate completion audit');
select throws_ok(
  $$ select * from public.complete_live_round(
    'd1000000-0000-4000-8000-000000000001',
    'd4000000-0000-4000-8000-000000000001',
    2, true,
    'da000000-0000-4000-8000-000000000001',
    'db000000-0000-4000-8000-000000000001'
  ) $$,
  '23505',
  'operation_id_reused',
  'same operation cannot be replayed with changed inputs'
);
select throws_ok(
  $$ select * from public.set_round_participant_score(
    'd1000000-0000-4000-8000-000000000001',
    'd5000000-0000-4000-8000-000000000001',
    '{"golf_points": 41}', 1,
    'dc000000-0000-4000-8000-000000000001', 'portal', null, now(),
    'dd000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000001'
  ) $$,
  'P0001',
  'round_scoring_locked',
  'completed scoring cannot be edited without reopen'
);
select throws_ok(
  $$ select * from public.complete_live_round(
    'd1000000-0000-4000-8000-000000000001',
    'd4000000-0000-4000-8000-000000000002',
    1, true,
    'df000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001'
  ) $$,
  'P0002',
  'round_not_found',
  'cross-tenant rounds are indistinguishable from missing rounds'
);

select throws_ok(
  $$ select * from public.complete_live_round(
    'd1000000-0000-4000-8000-000000000001',
    'd4000000-0000-4000-8000-000000000003',
    1, true,
    'e1000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001'
  ) $$,
  'P0001',
  'completion_not_ready',
  'a current mobile score without a receipt blocks completion'
);
select is((select state from public.rounds where id = 'd4000000-0000-4000-8000-000000000003'), 'live'::public.round_state, 'blocked completion leaves the round Live');
select is((select count(*) from public.round_completion_runs where round_id = 'd4000000-0000-4000-8000-000000000003'), 0::bigint, 'blocked completion leaves no partial completion run');
select is((select count(*) from public.notification_outbox_jobs where aggregate_type = 'round_completion'), 1::bigint, 'blocked completion leaves no additional outbox work');
select throws_ok(
  $$ select * from public.complete_live_round(
    'd1000000-0000-4000-8000-000000000001',
    'd4000000-0000-4000-8000-000000000003',
    1, false,
    'e3000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001'
  ) $$,
  '22023',
  'round_completion_confirmation_required',
  'completion requires explicit confirmation'
);

select * from finish();

rollback;
