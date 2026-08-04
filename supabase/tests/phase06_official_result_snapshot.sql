begin;

create extension if not exists pgtap with schema extensions;

select plan(17);

select has_table('public', 'round_completion_runs', 'completion run history exists');
select has_table('public', 'round_official_results', 'immutable official result snapshots exist');
select has_function(
  'app',
  'round_official_result_snapshot',
  array['app.entity_id', 'app.entity_id'],
  'the private official-result calculator exists'
);
select ok(
  has_function_privilege(
    'service_role',
    'app.round_official_result_snapshot(app.entity_id,app.entity_id)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'app.round_official_result_snapshot(app.entity_id,app.entity_id)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'app.round_official_result_snapshot(app.entity_id,app.entity_id)',
    'execute'
  ),
  'only the trusted server can calculate official result snapshots'
);
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class
   where oid = 'public.round_official_results'::regclass),
  'official result snapshots are force-RLS with no direct table access'
);

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at
)
values
  ('b1000000-0000-4000-8000-000000000001', 'official-admin@example.test', now(), false, false, now(), now());

insert into public.groups (id, name, time_zone)
values
  ('b2000000-0000-4000-8000-000000000001', 'Official Group', 'UTC'),
  ('b2000000-0000-4000-8000-000000000002', 'Other Official Group', 'UTC');

insert into public.memberships (id, group_id, user_id, role, status, activated_at)
values
  ('b3000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'administrator', 'active', now()),
  ('b3000000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000001', null, 'member', 'pending', null),
  ('b3000000-0000-4000-8000-000000000003', 'b2000000-0000-4000-8000-000000000001', null, 'member', 'pending', null);

insert into public.group_quota_settings (
  group_id, method, moving_average_history_length, precision, rounding_rule,
  version, updated_by, participation_merit
)
values (
  'b2000000-0000-4000-8000-000000000001', 'moving_average', 4, 2,
  'half_away_from_zero', 1, 'b1000000-0000-4000-8000-000000000001', 2
);

insert into public.placement_merit_rows (group_id, rank, merit_points)
values
  ('b2000000-0000-4000-8000-000000000001', 1, 10),
  ('b2000000-0000-4000-8000-000000000001', 3, 5);

insert into public.rounds (
  id, group_id, description, scheduled_at, group_time_zone, format, state,
  published_at, created_by
)
values
  ('b4000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 'Official snapshot round', now(), 'UTC', 'individual_net', 'live', now(), 'b1000000-0000-4000-8000-000000000001'),
  ('b4000000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000002', 'Other tenant round', now(), 'UTC', 'individual_net', 'live', now(), 'b1000000-0000-4000-8000-000000000001');

insert into public.round_rule_snapshots (
  round_id, group_id, format, quota_method, moving_average_history_length,
  quota_precision, quota_rounding_rule, adjustment_bands, settings_version
)
values (
  'b4000000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000001',
  'individual_net', 'moving_average', 4, 2, 'half_away_from_zero', '[]', 1
), (
  'b4000000-0000-4000-8000-000000000002',
  'b2000000-0000-4000-8000-000000000002',
  'individual_net', 'moving_average', 4, 2, 'half_away_from_zero', '[]', 1
);

insert into public.round_participants (
  id, round_id, group_id, membership_id, participant_kind, rsvp_status, quota_snapshot
)
values
  ('b5000000-0000-4000-8000-000000000001', 'b4000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 'b3000000-0000-4000-8000-000000000002', 'member', 'playing', 10),
  ('b5000000-0000-4000-8000-000000000002', 'b4000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 'b3000000-0000-4000-8000-000000000003', 'member', 'playing', 10);

insert into public.round_participants (
  id, round_id, group_id, participant_kind, sponsor_membership_id,
  guest_first_name, guest_last_name, rsvp_status, quota_snapshot
)
values (
  'b5000000-0000-4000-8000-000000000003',
  'b4000000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000001',
  'guest', 'b3000000-0000-4000-8000-000000000001',
  'Official', 'Guest', 'playing', 5
);

insert into public.score_revisions (
  id, group_id, round_id, participant_id, revision_number, base_version,
  device_operation_id, actor_user_id, source, client_changed_at, correlation_id,
  operation_id, changed_fields, golf_points, plus_minus, ranking_value,
  request_fingerprint
)
values
  ('b6000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 'b4000000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000001', 1, 0, 'b7000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'portal', now(), 'b8000000-0000-4000-8000-000000000001', 'b9000000-0000-4000-8000-000000000001', '{"golf_points": true}', 20, 8, 8, repeat('1', 64)),
  ('b6000000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000001', 'b4000000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000002', 1, 0, 'b7000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000001', 'portal', now(), 'b8000000-0000-4000-8000-000000000002', 'b9000000-0000-4000-8000-000000000002', '{"golf_points": true}', 20, 8, 8, repeat('2', 64)),
  ('b6000000-0000-4000-8000-000000000003', 'b2000000-0000-4000-8000-000000000001', 'b4000000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000003', 1, 0, 'b7000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000001', 'portal', now(), 'b8000000-0000-4000-8000-000000000003', 'b9000000-0000-4000-8000-000000000003', '{"golf_points": true}', 15, 3, 3, repeat('3', 64));

insert into public.participant_score_projections (
  participant_id, group_id, round_id, golf_points, manual_merit,
  plus_minus, ranking_value, version, last_revision_id
)
values
  ('b5000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 'b4000000-0000-4000-8000-000000000001', 20, 1.50, 8, 8, 1, 'b6000000-0000-4000-8000-000000000001'),
  ('b5000000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000001', 'b4000000-0000-4000-8000-000000000001', 20, null, 8, 8, 1, 'b6000000-0000-4000-8000-000000000002'),
  ('b5000000-0000-4000-8000-000000000003', 'b2000000-0000-4000-8000-000000000001', 'b4000000-0000-4000-8000-000000000001', 15, 99, 3, 3, 1, 'b6000000-0000-4000-8000-000000000003');

create temporary table official_rows as
select *
from app.round_official_result_snapshot(
  'b4000000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000001'
);

select is((select count(*) from official_rows), 3::bigint, 'all Playing members and guests become result snapshots');
select is((select competition_rank from official_rows where participant_id = 'b5000000-0000-4000-8000-000000000001'), 1::bigint, 'first tied member keeps competition rank one');
select is((select competition_rank from official_rows where participant_id = 'b5000000-0000-4000-8000-000000000002'), 1::bigint, 'second tied member keeps the same competition rank');
select is((select competition_rank from official_rows where participant_id = 'b5000000-0000-4000-8000-000000000003'), 3::bigint, 'guest receives the next competition rank');
select is((select total_merit from official_rows where participant_id = 'b5000000-0000-4000-8000-000000000001'), 13.50::numeric, 'member total freezes participation, placement, and manual merit');
select is((select generated_merit::numeric from official_rows where participant_id = 'b5000000-0000-4000-8000-000000000002'), 12::numeric, 'tied members receive the full placement amount');
select is((select total_merit from official_rows where participant_id = 'b5000000-0000-4000-8000-000000000003'), 0::numeric, 'guests receive no merit even with a projection value');
select is((select score_revision_id from official_rows where participant_id = 'b5000000-0000-4000-8000-000000000001'), 'b6000000-0000-4000-8000-000000000001'::app.entity_id, 'result snapshots retain score revision provenance');
select is((select quota_snapshot::numeric from official_rows where participant_id = 'b5000000-0000-4000-8000-000000000001'), 10::numeric, 'result snapshots retain the played quota');
create temporary table official_rows_repeat as
select *
from app.round_official_result_snapshot(
  'b4000000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000001'
);
select is(
  (select jsonb_agg(to_jsonb(official_rows) order by participant_id) from official_rows),
  (select jsonb_agg(to_jsonb(official_rows_repeat) order by participant_id) from official_rows_repeat),
  'repeated reads are deterministic'
);
select throws_ok(
  $$ select * from app.round_official_result_snapshot(
    'b4000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000002'
  ) $$,
  'P0002',
  'round_not_found',
  'a mismatched tenant key cannot read result rows'
);
select throws_ok(
  $$ select * from app.round_official_result_snapshot(null, 'b2000000-0000-4000-8000-000000000001') $$,
  '22004',
  'round_completion_context_required',
  'snapshot calculation requires explicit tenant keys'
);

select * from finish();

rollback;
