begin;

create extension if not exists pgtap with schema extensions;

select plan(31);

select has_table('public', 'placement_merit_rows', 'placement merit rows exist');
select has_column('public', 'group_quota_settings', 'participation_merit', 'settings store participation merit');
select has_column('public', 'group_quota_settings', 'standings_reset_date', 'settings store the reset date');
select has_column('public', 'round_rule_snapshots', 'participation_merit', 'snapshots store participation merit');
select has_column('public', 'round_rule_snapshots', 'placement_merit', 'snapshots store placement merit');
select has_column('public', 'round_rule_snapshots', 'standings_reset_date', 'snapshots store the reset date');
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid = 'public.placement_merit_rows'::regclass),
  'placement merit rows enable and force RLS'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.configure_group_quota_rules(uuid,public.quota_method,integer,integer,public.quota_rounding_rule,jsonb,bigint,text,uuid,uuid,numeric,jsonb,date)',
    'execute'
  ),
  'the trusted server can configure merit and standings settings'
);

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at
)
values
  ('15000000-0000-4000-8000-000000000001', 'merit-admin-a@example.test', now(), false, false, now(), now()),
  ('15000000-0000-4000-8000-000000000002', 'merit-member-a@example.test', now(), false, false, now(), now()),
  ('15000000-0000-4000-8000-000000000003', 'merit-coordinator-a@example.test', now(), false, false, now(), now()),
  ('15000000-0000-4000-8000-000000000004', 'merit-admin-b@example.test', now(), false, false, now(), now());

insert into public.user_profiles (user_id)
values
  ('15000000-0000-4000-8000-000000000001'),
  ('15000000-0000-4000-8000-000000000002'),
  ('15000000-0000-4000-8000-000000000003'),
  ('15000000-0000-4000-8000-000000000004');

insert into public.groups (id, name, time_zone)
values
  ('55000000-0000-4000-8000-000000000001', 'Merit Group A', 'America/New_York'),
  ('55000000-0000-4000-8000-000000000002', 'Merit Group B', 'UTC');

insert into public.memberships (id, group_id, user_id, role, status, activated_at)
values
  ('65000000-0000-4000-8000-000000000001', '55000000-0000-4000-8000-000000000001', '15000000-0000-4000-8000-000000000001', 'administrator', 'active', now()),
  ('65000000-0000-4000-8000-000000000002', '55000000-0000-4000-8000-000000000001', '15000000-0000-4000-8000-000000000002', 'member', 'active', now()),
  ('65000000-0000-4000-8000-000000000003', '55000000-0000-4000-8000-000000000001', '15000000-0000-4000-8000-000000000003', 'coordinator', 'active', now()),
  ('65000000-0000-4000-8000-000000000004', '55000000-0000-4000-8000-000000000002', '15000000-0000-4000-8000-000000000004', 'administrator', 'active', now());

select throws_ok(
  $$ select * from public.configure_group_quota_rules(
    '15000000-0000-4000-8000-000000000001', 'moving_average', 10, 1,
    'half_away_from_zero', '[]', 0, 'Invalid participation',
    '25000000-0000-4000-8000-000000000001', '35000000-0000-4000-8000-000000000001',
    -1, '[]', null
  ) $$,
  '22023', 'quota_settings_input_invalid', 'participation merit is constrained to 0 through 100'
);
select throws_ok(
  $$ select * from public.configure_group_quota_rules(
    '15000000-0000-4000-8000-000000000001', 'moving_average', 10, 1,
    'half_away_from_zero', '[]', 0, 'Invalid placement',
    '25000000-0000-4000-8000-000000000002', '35000000-0000-4000-8000-000000000002',
    10, '[{"rank":2,"points":"5"},{"rank":1,"points":"10"}]', null
  ) $$,
  '22023', 'quota_settings_input_invalid', 'placement rows must be strictly rank ordered'
);
select throws_ok(
  $$ select * from public.configure_group_quota_rules(
    '15000000-0000-4000-8000-000000000003', 'moving_average', 10, 1,
    'half_away_from_zero', '[]', 0, 'Coordinator attempt',
    '25000000-0000-4000-8000-000000000003', '35000000-0000-4000-8000-000000000003',
    10, '[]', null
  ) $$,
  'P0003', 'actor_not_authorized', 'coordinators cannot change merit settings'
);

create temporary table first_merit_settings as
select * from public.configure_group_quota_rules(
  '15000000-0000-4000-8000-000000000001', 'moving_average', 10, 2,
  'half_away_from_zero', '[]', 0, 'Initial merit settings',
  '25000000-0000-4000-8000-000000000004', '35000000-0000-4000-8000-000000000004',
  12.5, '[{"rank":1,"points":"10"},{"rank":3,"points":"4.00"}]', '2026-04-01'
);

select is((select settings_version from first_merit_settings), 1::bigint, 'first merit settings version is one');
select is((select configured_participation_merit::numeric from first_merit_settings), 12.5::numeric, 'participation merit is stored exactly');
select is((select configured_standings_reset_date from first_merit_settings), '2026-04-01'::date, 'standings reset date is stored as a group-local date');
select is((select count(*) from public.placement_merit_rows where group_id = '55000000-0000-4000-8000-000000000001'), 2::bigint, 'placement rows are replaced atomically');
select is((select merit_points::numeric from public.placement_merit_rows where group_id = '55000000-0000-4000-8000-000000000001' and rank = 3), 4::numeric, 'placement points preserve exact decimals');
select is((select count(*) from public.audit_events where action = 'group.quota_rules_configured' and group_id = '55000000-0000-4000-8000-000000000001'), 1::bigint, 'merit settings append one audit event');

insert into public.membership_golfer_profiles (
  id, membership_id, group_id, first_name, last_name
)
values
  ('66000000-0000-4000-8000-000000000001', '65000000-0000-4000-8000-000000000001', '55000000-0000-4000-8000-000000000001', 'Admin', 'Golfer'),
  ('66000000-0000-4000-8000-000000000002', '65000000-0000-4000-8000-000000000002', '55000000-0000-4000-8000-000000000001', 'Member', 'Golfer'),
  ('66000000-0000-4000-8000-000000000003', '65000000-0000-4000-8000-000000000003', '55000000-0000-4000-8000-000000000001', 'Coordinator', 'Golfer');
insert into public.membership_quota_projections (
  membership_id, group_id, projection_version, settings_version,
  projection_ready, projected_quota, projection_source
)
select
  membership.id,
  membership.group_id,
  1,
  1,
  true,
  20,
  '{"kind":"manual_override","settings_version":1}'::jsonb
from public.memberships as membership
where membership.group_id = '55000000-0000-4000-8000-000000000001';

select * from public.configure_group_quota_rules(
  '15000000-0000-4000-8000-000000000001', 'moving_average', 10, 2,
  'half_away_from_zero', '[]', 0, 'Initial merit settings',
  '25000000-0000-4000-8000-000000000004', '35000000-0000-4000-8000-000000000004',
  12.5, '[{"rank":1,"points":"10"},{"rank":3,"points":"4.00"}]', '2026-04-01'
);
select is((select version from public.group_quota_settings where group_id = '55000000-0000-4000-8000-000000000001'), 1::bigint, 'idempotent merit retry does not advance settings');
select is((select participation_merit::numeric from public.group_quota_settings where group_id = '55000000-0000-4000-8000-000000000001'), 12.5::numeric, 'idempotent retry keeps the original merit policy');

select throws_ok(
  $$ select * from public.configure_group_quota_rules(
    '15000000-0000-4000-8000-000000000001', 'moving_average', 10, 2,
    'half_away_from_zero', '[]', 0, 'Reused operation',
    '25000000-0000-4000-8000-000000000099', '35000000-0000-4000-8000-000000000004',
    100, '[]', null
  ) $$,
  '23505', 'operation_id_reused', 'an operation id cannot be reused for different merit settings'
);

select throws_ok(
  $$ select * from public.configure_group_quota_rules(
    '15000000-0000-4000-8000-000000000001', 'best_10_of_20', null, 0,
    'half_away_from_zero', '[]', 0, 'Stale settings',
    '25000000-0000-4000-8000-000000000005', '35000000-0000-4000-8000-000000000005',
    12.5, '[]', null
  ) $$,
  '40001', 'quota_settings_version_changed', 'stale merit settings versions are rejected'
);

insert into public.rounds (
  id, group_id, description, scheduled_at, group_time_zone, format, created_by
)
values (
  '75000000-0000-4000-8000-000000000001', '55000000-0000-4000-8000-000000000001',
  'Merit snapshot round', now(), 'America/New_York', 'individual_net',
  '15000000-0000-4000-8000-000000000001'
);
insert into public.round_rule_snapshots (
  round_id, group_id, format, quota_method, moving_average_history_length,
  quota_precision, quota_rounding_rule, adjustment_bands, settings_version
)
values (
  '75000000-0000-4000-8000-000000000001', '55000000-0000-4000-8000-000000000001',
  'individual_net', 'moving_average', 10, 2, 'half_away_from_zero', '[]', 1
);
select is((select participation_merit::numeric from public.round_rule_snapshots where round_id = '75000000-0000-4000-8000-000000000001'), 12.5::numeric, 'publication snapshot trigger carries participation merit');
select is((select placement_merit from public.round_rule_snapshots where round_id = '75000000-0000-4000-8000-000000000001'), '[{"rank":1,"points":10},{"rank":3,"points":4.00}]'::jsonb, 'publication snapshot trigger carries ordered placement merit');
select is((select standings_reset_date from public.round_rule_snapshots where round_id = '75000000-0000-4000-8000-000000000001'), '2026-04-01'::date, 'publication snapshot trigger carries the reset date');

create temporary table review_before as
select * from app.round_publication_review_state(
  '75000000-0000-4000-8000-000000000001',
  '55000000-0000-4000-8000-000000000001',
  '{}'
);
select * from public.configure_group_quota_rules(
  '15000000-0000-4000-8000-000000000001', 'moving_average', 10, 2,
  'half_away_from_zero', '[]', 1, 'Remove placement policy',
  '25000000-0000-4000-8000-000000000006', '35000000-0000-4000-8000-000000000006',
  100, '[]', null
);
select is((select count(*) from public.membership_quota_projections where group_id = '55000000-0000-4000-8000-000000000001' and settings_version = 2), 3::bigint, 'merit-only changes carry ready quota projections to the new settings version');
select is((select count(*) from public.membership_quota_projections where group_id = '55000000-0000-4000-8000-000000000001' and projection_source ->> 'settings_version' = '2'), 3::bigint, 'projection provenance carries the new settings version');
select isnt(
  (select review_fingerprint from review_before),
  (select review_fingerprint from app.round_publication_review_state(
    '75000000-0000-4000-8000-000000000001',
    '55000000-0000-4000-8000-000000000001',
    '{}'
  )),
  'publication review fingerprint changes when merit settings change'
);
create temporary table preview_after_merit as
select * from public.preview_round_publication(
  '15000000-0000-4000-8000-000000000001',
  '75000000-0000-4000-8000-000000000001',
  '{}'
);
select is((select count(*) from preview_after_merit where eligibility_state = 'eligible'), 3::bigint, 'publication preview remains ready after merit-only settings change');

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '15000000-0000-4000-8000-000000000001', true);
select is((select count(*) from public.placement_merit_rows), 0::bigint, 'administrator reads only their tenant placement rows after the empty policy is saved');
select pg_catalog.set_config('request.jwt.claim.sub', '15000000-0000-4000-8000-000000000002', true);
select is((select count(*) from public.placement_merit_rows), 0::bigint, 'members cannot read administrative placement rows');
select ok(
  not has_table_privilege('authenticated', 'public.placement_merit_rows', 'insert,update,delete'),
  'authenticated clients cannot write placement rows directly'
);
reset role;
select pg_catalog.set_config('request.jwt.claim.sub', '', true);

select * from finish();

rollback;
