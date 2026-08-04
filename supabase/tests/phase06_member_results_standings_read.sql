begin;

create extension if not exists pgtap with schema extensions;

select plan(27);

select has_function('public', 'read_member_standings', array['uuid'], 'member standings boundary exists');
select has_function('public', 'read_mobile_member_standings', array[]::text[], 'mobile standings boundary exists');
select has_function('public', 'read_member_quota_history', array['uuid'], 'member quota history boundary exists');
select has_function('public', 'read_mobile_member_quota_history', array[]::text[], 'mobile quota history boundary exists');
select ok(
  has_function_privilege('service_role', 'public.read_member_standings(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.read_member_standings(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.read_mobile_member_standings()', 'execute')
  and not has_function_privilege('anon', 'public.read_mobile_member_standings()', 'execute'),
  'standings boundaries expose only service explicit and authenticated actor-derived access'
);
select ok(
  has_function_privilege('service_role', 'public.read_member_quota_history(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.read_member_quota_history(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.read_mobile_member_quota_history()', 'execute')
  and not has_function_privilege('anon', 'public.read_mobile_member_quota_history()', 'execute'),
  'quota history boundaries expose only service explicit and authenticated actor-derived access'
);

insert into auth.users (id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at)
values
  ('a7000000-0000-4000-8000-000000000001', 'standings-one@example.test', now(), false, false, now(), now()),
  ('a7000000-0000-4000-8000-000000000002', 'standings-two@example.test', now(), false, false, now(), now()),
  ('a7000000-0000-4000-8000-000000000003', 'standings-three@example.test', now(), false, false, now(), now());
insert into public.user_profiles (user_id, display_name, first_name, last_name)
values
  ('a7000000-0000-4000-8000-000000000001', 'Standing One', 'Standing', 'One'),
  ('a7000000-0000-4000-8000-000000000002', 'Standing Two', 'Standing', 'Two'),
  ('a7000000-0000-4000-8000-000000000003', 'Standing Three', 'Standing', 'Three');
insert into public.groups (id, name, time_zone)
values ('a7100000-0000-4000-8000-000000000001', 'Read Group', 'UTC');
insert into public.memberships (id, group_id, user_id, role, status, activated_at, initial_quota, initial_quota_provenance)
values
  ('a7200000-0000-4000-8000-000000000001', 'a7100000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000001', 'member', 'active', now(), 20, 'test'),
  ('a7200000-0000-4000-8000-000000000002', 'a7100000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000002', 'member', 'active', now(), 18, 'test'),
  ('a7200000-0000-4000-8000-000000000003', 'a7100000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000003', 'member', 'active', now(), 17, 'test');
insert into public.membership_golfer_profiles (membership_id, group_id, first_name, last_name)
values
  ('a7200000-0000-4000-8000-000000000001', 'a7100000-0000-4000-8000-000000000001', 'Standing', 'One'),
  ('a7200000-0000-4000-8000-000000000002', 'a7100000-0000-4000-8000-000000000001', 'Standing', 'Two'),
  ('a7200000-0000-4000-8000-000000000003', 'a7100000-0000-4000-8000-000000000001', 'Standing', 'Three');

insert into public.group_quota_settings (
  group_id, method, moving_average_history_length, precision, updated_by
)
values ('a7100000-0000-4000-8000-000000000001', 'moving_average', 4, 1, 'a7000000-0000-4000-8000-000000000001');
insert into public.membership_quota_projections (
  membership_id, group_id, projection_ready, projected_quota, projection_source
)
values
  ('a7200000-0000-4000-8000-000000000001', 'a7100000-0000-4000-8000-000000000001', true, 19.5, '{"kind":"test"}'),
  ('a7200000-0000-4000-8000-000000000002', 'a7100000-0000-4000-8000-000000000001', true, 18.5, '{"kind":"test"}'),
  ('a7200000-0000-4000-8000-000000000003', 'a7100000-0000-4000-8000-000000000001', true, 17.5, '{"kind":"test"}');

-- A completed round gives two members the same negative merit. The active
-- zero-round member must remain unranked and must not create a rank gap.
insert into public.rounds (
  id, group_id, description, scheduled_at, group_time_zone, format, state,
  published_at, created_by, version
)
values (
  'a7300000-0000-4000-8000-000000000001',
  'a7100000-0000-4000-8000-000000000001',
  'Negative merit fixture',
  '2026-08-02T12:00:00Z',
  'UTC',
  'individual_net',
  'completed',
  '2026-08-02T12:00:00Z',
  'a7000000-0000-4000-8000-000000000001',
  1
);
insert into public.round_completion_runs (
  id, round_id, group_id, completion_number, state, completed_at,
  completed_by, round_version, correlation_id, operation_id
)
values (
  'a7400000-0000-4000-8000-000000000001',
  'a7300000-0000-4000-8000-000000000001',
  'a7100000-0000-4000-8000-000000000001',
  1,
  'official',
  '2026-08-02T13:00:00Z',
  'a7000000-0000-4000-8000-000000000001',
  1,
  'a7700000-0000-4000-8000-000000000001',
  'a7800000-0000-4000-8000-000000000001'
);
insert into public.round_participants (
  id, round_id, group_id, membership_id, participant_kind, rsvp_status,
  quota_snapshot
)
values
  ('a7500000-0000-4000-8000-000000000001', 'a7300000-0000-4000-8000-000000000001', 'a7100000-0000-4000-8000-000000000001', 'a7200000-0000-4000-8000-000000000001', 'member', 'playing', 20),
  ('a7500000-0000-4000-8000-000000000002', 'a7300000-0000-4000-8000-000000000001', 'a7100000-0000-4000-8000-000000000001', 'a7200000-0000-4000-8000-000000000003', 'member', 'playing', 17);
insert into public.score_revisions (
  id, group_id, round_id, participant_id, revision_number, base_version,
  device_operation_id, actor_user_id, source, client_changed_at,
  correlation_id, operation_id, changed_fields, gross_score, net_score,
  golf_points, manual_merit, plus_minus, ranking_value, request_fingerprint
)
values
  ('a7600000-0000-4000-8000-000000000001', 'a7100000-0000-4000-8000-000000000001', 'a7300000-0000-4000-8000-000000000001', 'a7500000-0000-4000-8000-000000000001', 1, 0, 'a7900000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000001', 'portal', '2026-08-02T12:30:00Z', 'a7a00000-0000-4000-8000-000000000001', 'a7b00000-0000-4000-8000-000000000001', '{"golf_points":10,"manual_merit":-5,"plus_minus":-5,"ranking_value":-5}', 100, 100, 10, -5, -5, -5, repeat('a', 64)),
  ('a7600000-0000-4000-8000-000000000002', 'a7100000-0000-4000-8000-000000000001', 'a7300000-0000-4000-8000-000000000001', 'a7500000-0000-4000-8000-000000000002', 1, 0, 'a7900000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000003', 'portal', '2026-08-02T12:31:00Z', 'a7a00000-0000-4000-8000-000000000002', 'a7b00000-0000-4000-8000-000000000002', '{"golf_points":10,"manual_merit":-5,"plus_minus":-5,"ranking_value":-5}', 100, 100, 10, -5, -5, -5, repeat('b', 64));
insert into public.round_official_results (
  completion_id, round_id, group_id, participant_id, participant_kind,
  membership_id, score_revision_id, golf_points, gross_score, net_score,
  quota_snapshot, plus_minus, ranking_value, competition_rank,
  participation_merit, placement_merit, manual_merit, generated_merit,
  total_merit
)
values
  ('a7400000-0000-4000-8000-000000000001', 'a7300000-0000-4000-8000-000000000001', 'a7100000-0000-4000-8000-000000000001', 'a7500000-0000-4000-8000-000000000001', 'member', 'a7200000-0000-4000-8000-000000000001', 'a7600000-0000-4000-8000-000000000001', 10, 100, 100, 20, -5, -5, 1, 0, 0, -5, 0, -5),
  ('a7400000-0000-4000-8000-000000000001', 'a7300000-0000-4000-8000-000000000001', 'a7100000-0000-4000-8000-000000000001', 'a7500000-0000-4000-8000-000000000002', 'member', 'a7200000-0000-4000-8000-000000000003', 'a7600000-0000-4000-8000-000000000002', 10, 100, 100, 17, -5, -5, 1, 0, 0, -5, 0, -5);

set local role service_role;
create temporary table standings_rows as
select * from public.read_member_standings('a7000000-0000-4000-8000-000000000001');
create temporary table history_rows as
select * from public.read_member_quota_history('a7000000-0000-4000-8000-000000000001');
reset role;

select is((select count(*) from standings_rows), 3::bigint, 'standings returns every active member in the actor group');
select is((select group_name from standings_rows limit 1), 'Read Group', 'standings includes group orientation');
select is((select membership_id::uuid from standings_rows order by membership_id limit 1), 'a7200000-0000-4000-8000-000000000001'::uuid, 'standings returns membership identity');
select is((select projected_quota::numeric from standings_rows where membership_id = 'a7200000-0000-4000-8000-000000000001'), 19.5::numeric, 'standings includes current quota projection');
select is((select merit_total from standings_rows where membership_id = 'a7200000-0000-4000-8000-000000000001'), -5::numeric, 'standings includes negative manual merit in the total');
select is((select rounds_played from standings_rows where membership_id = 'a7200000-0000-4000-8000-000000000001'), 1::bigint, 'standings counts an official round once');
select is((select standing_rank from standings_rows where membership_id = 'a7200000-0000-4000-8000-000000000001'), 1::bigint, 'a played member keeps rank one even with negative merit');
select is((select standing_rank from standings_rows where membership_id = 'a7200000-0000-4000-8000-000000000002'), null::bigint, 'zero-round members do not consume a standings rank');
select is((select standing_rank from standings_rows where membership_id = 'a7200000-0000-4000-8000-000000000003'), 1::bigint, 'equal negative merit receives the same competition rank');
select is((select quota_projection_ready from standings_rows where membership_id = 'a7200000-0000-4000-8000-000000000001'), true, 'standings exposes projection readiness');
select is((select eligible_quota_count from standings_rows where membership_id = 'a7200000-0000-4000-8000-000000000001'), 0::bigint, 'standings exposes quota eligibility count');
select is((select count(*) from history_rows), 0::bigint, 'quota history excludes seed-only inputs');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a7000000-0000-4000-8000-000000000001', true);
select ok((select count(*) from public.read_mobile_member_standings()) = 3, 'mobile standings derives actor identity from auth.uid');
select is((select count(*) from public.read_mobile_member_quota_history()), 0::bigint, 'mobile quota history derives actor identity from auth.uid');
reset role;

select throws_ok(
  $$ select * from public.read_member_standings('a7000000-0000-4000-8000-000000000004') $$,
  'P0002', 'member_standings_not_available',
  'service boundary rejects an identity without an active group membership'
);
select throws_ok(
  $$ select * from public.read_member_quota_history('a7000000-0000-4000-8000-000000000004') $$,
  'P0002', 'member_quota_history_not_available',
  'quota history boundary rejects an identity without an active group membership'
);
select throws_ok(
  $$ select * from public.read_member_standings(null) $$,
  '22004', 'member_standings_context_required',
  'standings boundary rejects a missing actor'
);
select throws_ok(
  $$ select * from public.read_member_quota_history(null) $$,
  '22004', 'member_quota_history_context_required',
  'quota history boundary rejects a missing actor'
);
update auth.users
set raw_app_meta_data = '{"greenroster_password_recovery":true}'::jsonb
where id = 'a7000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok(
  $$ select * from public.read_mobile_member_standings() $$,
  'P0003', 'recovery_session_forbidden',
  'mobile standings rejects recovery sessions'
);
select throws_ok(
  $$ select * from public.read_mobile_member_quota_history() $$,
  'P0003', 'recovery_session_forbidden',
  'mobile quota history rejects recovery sessions'
);
reset role;
select ok(
  not exists (
    select 1 from pg_proc as proc
    join pg_namespace as namespace on namespace.oid = proc.pronamespace
    where namespace.nspname = 'public'
      and proc.proname in ('read_member_standings', 'read_member_quota_history')
      and has_function_privilege('authenticated', proc.oid, 'execute')
  ),
  'authenticated cannot supply an arbitrary actor identity'
);

select * from finish();

rollback;
