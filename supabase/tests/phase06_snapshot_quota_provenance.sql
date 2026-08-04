begin;

create extension if not exists pgtap with schema extensions;

select plan(9);

select has_function(
  'app',
  'member_quota_projection_after_result',
  array['app.entity_id', 'app.entity_id', 'app.entity_id', 'app.entity_id', 'app.utc_instant', 'app.golf_points_value', 'app.plus_minus_value'],
  'candidate quota helper remains available'
);
select ok(
  has_function_privilege(
    'service_role',
    'app.member_quota_projection_after_result(app.entity_id,app.entity_id,app.entity_id,app.entity_id,app.utc_instant,app.golf_points_value,app.plus_minus_value)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'app.member_quota_projection_after_result(app.entity_id,app.entity_id,app.entity_id,app.entity_id,app.utc_instant,app.golf_points_value,app.plus_minus_value)',
    'execute'
  ),
  'candidate quota calculation remains service-only'
);

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at
)
values ('a1000000-0000-4000-8000-000000000001', 'snapshot-quota@example.test', now(), false, false, now(), now());
insert into public.user_profiles (user_id, display_name, first_name, last_name)
values ('a1000000-0000-4000-8000-000000000001', 'Snapshot Quota', 'Snapshot', 'Quota');
insert into public.groups (id, name, time_zone)
values ('a2000000-0000-4000-8000-000000000001', 'Snapshot Quota Group', 'UTC');
insert into public.memberships (
  id, group_id, user_id, role, status, activated_at,
  initial_quota, uses_initial_quota, initial_quota_provenance
)
values (
  'a3000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'administrator', 'active', now(), 20, false, 'member_bootstrap'
);
insert into public.group_quota_settings (
  group_id, method, moving_average_history_length, precision, rounding_rule,
  version, updated_by
)
values (
  'a2000000-0000-4000-8000-000000000001', 'best_10_of_20', null, 2,
  'half_away_from_zero', 9, 'a1000000-0000-4000-8000-000000000001'
);
insert into public.membership_quota_seed_totals (membership_id, group_id, position, point_total)
select
  'a3000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001',
  position,
  position::numeric
from generate_series(1, 12) as positions(position);
insert into public.rounds (
  id, group_id, description, scheduled_at, group_time_zone, format, state,
  published_at, created_by
)
values (
  'a4000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001',
  'Snapshot quota round', now(), 'UTC', 'individual_net', 'live', now(),
  'a1000000-0000-4000-8000-000000000001'
);
insert into public.round_rule_snapshots (
  round_id, group_id, format, quota_method, moving_average_history_length,
  quota_precision, quota_rounding_rule, adjustment_bands, settings_version
)
values (
  'a4000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001',
  'individual_net', 'moving_average', 4, 2, 'half_away_from_zero', '[]', 1
);

create temporary table snapshot_candidate as
select *
from app.member_quota_projection_after_result(
  'a3000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001',
  'a4000000-0000-4000-8000-000000000001',
  'a5000000-0000-4000-8000-000000000001',
  now(),
  100,
  80
);

select ok((select projection_ready from snapshot_candidate), 'snapshot policy produces a ready candidate');
select is((select quota_after::numeric from snapshot_candidate), 33.25::numeric, 'candidate quota uses snapshot moving-average length rather than current best-ten policy');
select is((select projection_source ->> 'method' from snapshot_candidate), 'moving_average', 'provenance records the snapshot method');
select is((select (projection_source ->> 'settings_version')::bigint from snapshot_candidate), 1::bigint, 'provenance records the immutable snapshot settings version');
select is((select projection_source ->> 'round_snapshot_id' from snapshot_candidate), 'a4000000-0000-4000-8000-000000000001', 'provenance identifies the published round snapshot');
select is((select (projection_source ->> 'precision')::integer from snapshot_candidate), 2, 'provenance records snapshot precision');
select is((select eligible_count from snapshot_candidate), 13::bigint, 'eligible count includes twelve seeds and the candidate result');

select * from finish();

rollback;
