begin;

create extension if not exists pgtap with schema extensions;

select plan(18);

select has_table('public', 'membership_quota_history', 'eligible quota history exists');
select has_function(
  'app',
  'member_quota_projection',
  array['app.entity_id', 'app.entity_id'],
  'the private quota projection helper exists'
);
select ok(
  has_function_privilege(
    'service_role',
    'app.member_quota_projection(app.entity_id,app.entity_id)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'app.member_quota_projection(app.entity_id,app.entity_id)',
    'execute'
  ),
  'only the trusted server can calculate quota projections'
);
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class
   where oid = 'public.membership_quota_history'::regclass),
  'quota history is force-RLS with no direct table access'
);

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at
)
values
  ('c1000000-0000-4000-8000-000000000001', 'quota-admin@example.test', now(), false, false, now(), now());

insert into public.groups (id, name, time_zone)
values
  ('c2000000-0000-4000-8000-000000000001', 'Moving Group', 'UTC'),
  ('c2000000-0000-4000-8000-000000000002', 'Best Group', 'UTC'),
  ('c2000000-0000-4000-8000-000000000003', 'Method C Group', 'UTC');

insert into public.memberships (
  id, group_id, user_id, role, status, activated_at, initial_quota, uses_initial_quota,
  initial_quota_provenance
)
values
  ('c3000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', null, 'member', 'pending', null, null, false, null),
  ('c3000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000001', null, 'member', 'pending', null, 30, true, 'member_bootstrap'),
  ('c3000000-0000-4000-8000-000000000003', 'c2000000-0000-4000-8000-000000000002', null, 'member', 'pending', null, null, false, null),
  ('c3000000-0000-4000-8000-000000000004', 'c2000000-0000-4000-8000-000000000003', null, 'member', 'pending', null, 20, true, 'member_bootstrap');

insert into public.group_quota_settings (
  group_id, method, moving_average_history_length, precision, rounding_rule, version, updated_by
)
values
  ('c2000000-0000-4000-8000-000000000001', 'moving_average', 4, 2, 'half_away_from_zero', 1, 'c1000000-0000-4000-8000-000000000001'),
  ('c2000000-0000-4000-8000-000000000002', 'best_10_of_20', null, 2, 'half_away_from_zero', 1, 'c1000000-0000-4000-8000-000000000001'),
  ('c2000000-0000-4000-8000-000000000003', 'previous_plus_minus', null, 2, 'half_away_from_zero', 1, 'c1000000-0000-4000-8000-000000000001');

insert into public.quota_adjustment_bands (
  group_id, position, lower_bound, lower_inclusive, upper_bound, upper_inclusive, adjustment
)
values
  ('c2000000-0000-4000-8000-000000000003', 1, -100, true, 100, true, 2);

insert into public.membership_quota_seed_totals (membership_id, group_id, position, point_total)
values
  ('c3000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 1, 10),
  ('c3000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 2, 20),
  ('c3000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 3, 30),
  ('c3000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 4, 40),
  ('c3000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000001', 1, 10),
  ('c3000000-0000-4000-8000-000000000003', 'c2000000-0000-4000-8000-000000000002', 1, 10),
  ('c3000000-0000-4000-8000-000000000003', 'c2000000-0000-4000-8000-000000000002', 2, 20),
  ('c3000000-0000-4000-8000-000000000003', 'c2000000-0000-4000-8000-000000000002', 3, 30),
  ('c3000000-0000-4000-8000-000000000003', 'c2000000-0000-4000-8000-000000000002', 4, 40),
  ('c3000000-0000-4000-8000-000000000003', 'c2000000-0000-4000-8000-000000000002', 5, 50);

select is(
  (select projected_quota::numeric from app.member_quota_projection(
    'c3000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001'
  )),
  25::numeric,
  'moving average uses all four seed totals'
);
select is(
  (select projection_source ->> 'kind' from app.member_quota_projection(
    'c3000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001'
  )),
  'seed_history',
  'seed-only moving average records seed provenance'
);
select is(
  (select projected_quota::numeric from app.member_quota_projection(
    'c3000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000001'
  )),
  30::numeric,
  'bootstrap use keeps the initial quota before the method threshold'
);
select ok(
  (select uses_initial_quota_next from app.member_quota_projection(
    'c3000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000001'
  )),
  'bootstrap remains active below the moving-average threshold'
);

insert into public.rounds (
  id, group_id, description, scheduled_at, group_time_zone, format, state,
  published_at, created_by
)
values
  ('c4000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 'Quota history round', now(), 'UTC', 'individual_net', 'completed', now(), 'c1000000-0000-4000-8000-000000000001'),
  ('c4000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000003', 'Method C round', now(), 'UTC', 'individual_net', 'completed', now(), 'c1000000-0000-4000-8000-000000000001');

insert into public.round_rule_snapshots (
  round_id, group_id, format, quota_method, moving_average_history_length,
  quota_precision, quota_rounding_rule, adjustment_bands, settings_version
)
values
  ('c4000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 'individual_net', 'moving_average', 4, 2, 'half_away_from_zero', '[]', 1),
  ('c4000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000003', 'individual_net', 'previous_plus_minus', null, 2, 'half_away_from_zero', '[{"lower_bound": -100, "lower_inclusive": true, "upper_bound": 100, "upper_inclusive": true, "adjustment": 2}]', 1);

insert into public.round_completion_runs (
  id, round_id, group_id, completion_number, state, completed_at,
  completed_by, round_version, correlation_id, operation_id
)
values
  ('c5000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 1, 'official', now(), 'c1000000-0000-4000-8000-000000000001', 2, 'c6000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000001'),
  ('c5000000-0000-4000-8000-000000000002', 'c4000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000003', 1, 'official', now(), 'c1000000-0000-4000-8000-000000000001', 2, 'c6000000-0000-4000-8000-000000000002', 'c7000000-0000-4000-8000-000000000002');

insert into public.membership_quota_history (
  membership_id, group_id, completion_id, round_id, completed_at,
  point_total, plus_minus, quota_before, quota_after, method, source
)
values
  ('c3000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001', now(), 50, 5, 25, 35, 'moving_average', '{"kind":"official_history"}'),
  ('c3000000-0000-4000-8000-000000000004', 'c2000000-0000-4000-8000-000000000003', 'c5000000-0000-4000-8000-000000000002', 'c4000000-0000-4000-8000-000000000002', now(), 50, 5, 20, 22, 'previous_plus_minus', '{"kind":"method_c_chain"}');

select is(
  (select projected_quota::numeric from app.member_quota_projection(
    'c3000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001'
  )),
  35::numeric,
  'moving average appends official totals and keeps the latest four'
);
select is(
  (select eligible_count from app.member_quota_projection(
    'c3000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001'
  )),
  5::bigint,
  'eligible quota count includes seeds and active official rounds'
);

insert into public.membership_quota_seed_totals (membership_id, group_id, position, point_total)
values
  ('c3000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000001', 2, 20),
  ('c3000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000001', 3, 30),
  ('c3000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000001', 4, 40);
select is(
  (select projected_quota::numeric from app.member_quota_projection(
    'c3000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000001'
  )),
  25::numeric,
  'moving average deactivates bootstrap at the configured threshold'
);
select ok(
  not (select uses_initial_quota_next from app.member_quota_projection(
    'c3000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000001'
  )),
  'bootstrap is no longer active after the threshold'
);

select is(
  (select projected_quota::numeric from app.member_quota_projection(
    'c3000000-0000-4000-8000-000000000003', 'c2000000-0000-4000-8000-000000000002'
  )),
  30::numeric,
  'best ten of twenty averages all five available seed totals'
);
select is(
  (select projected_quota::numeric from app.member_quota_projection(
    'c3000000-0000-4000-8000-000000000004', 'c2000000-0000-4000-8000-000000000003'
  )),
  22::numeric,
  'Method C applies the snapshotted adjustment band to the prior quota'
);
select is(
  (select projection_source ->> 'kind' from app.member_quota_projection(
    'c3000000-0000-4000-8000-000000000004', 'c2000000-0000-4000-8000-000000000003'
  )),
  'method_c_chain',
  'Method C records chain provenance'
);

update public.round_completion_runs
set state = 'reopened', reopened_at = now(), reopened_by = 'c1000000-0000-4000-8000-000000000001', reopen_reason = 'test reopen'
where id = 'c5000000-0000-4000-8000-000000000002';
select is(
  (select projected_quota::numeric from app.member_quota_projection(
    'c3000000-0000-4000-8000-000000000004', 'c2000000-0000-4000-8000-000000000003'
  )),
  20::numeric,
  'reopened completion history is excluded from current quota'
);

select throws_ok(
  $$ select * from app.member_quota_projection(
    'c3000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000002'
  ) $$,
  'P0002',
  'membership_unavailable',
  'cross-tenant quota keys reveal no membership state'
);
select throws_ok(
  $$ select * from app.member_quota_projection(null, 'c2000000-0000-4000-8000-000000000001') $$,
  '22004',
  'quota_projection_context_required',
  'quota projection requires explicit tenant keys'
);

select * from finish();

rollback;
