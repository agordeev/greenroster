begin;

create extension if not exists pgtap with schema extensions;

select plan(49);

select has_table(
  'public',
  'membership_quota_seed_totals',
  'ordered membership seed totals exist'
);
select has_table(
  'public',
  'membership_quota_projections',
  'one current membership quota projection exists'
);
select has_pk(
  'public',
  'membership_quota_seed_totals',
  'seed totals have immutable identifiers'
);
select has_pk(
  'public',
  'membership_quota_projections',
  'projections are keyed by membership'
);
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class
   where oid = 'public.membership_quota_seed_totals'::regclass),
  'seed totals force RLS'
);
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class
   where oid = 'public.membership_quota_projections'::regclass),
  'projections force RLS'
);
select ok(
  not has_table_privilege('authenticated', 'public.membership_quota_seed_totals', 'select,insert,update,delete'),
  'authenticated clients cannot read or write seed totals directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.membership_quota_projections', 'select,insert,update,delete'),
  'authenticated clients cannot read or write projections directly'
);
select ok(
  has_table_privilege('service_role', 'public.membership_quota_seed_totals', 'select'),
  'trusted server can read seed totals through an explicit grant'
);
select ok(
  has_table_privilege('service_role', 'public.membership_quota_projections', 'select'),
  'trusted server can read projections through an explicit grant'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.resolve_membership_quota_bootstrap_context(uuid,uuid)',
    'execute'
  ),
  'trusted server can resolve one membership context'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.resolve_membership_quota_bootstrap_context(uuid,uuid)',
    'execute'
  ),
  'authenticated clients cannot bypass the context boundary'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.configure_membership_quota_bootstrap(uuid,uuid,app.quota_value,boolean,jsonb,boolean,app.quota_value,jsonb,bigint,bigint,text,uuid,uuid)',
    'execute'
  ),
  'trusted server can configure member quota bootstrap'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.configure_membership_quota_bootstrap(uuid,uuid,app.quota_value,boolean,jsonb,boolean,app.quota_value,jsonb,bigint,bigint,text,uuid,uuid)',
    'execute'
  ),
  'authenticated clients cannot bypass the member quota boundary'
);

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at
)
values
  ('15000000-0000-4000-8000-000000000001', 'member-quota-admin@example.test', now(), false, false, now(), now()),
  ('15000000-0000-4000-8000-000000000002', 'member-quota-member@example.test', now(), false, false, now(), now()),
  ('15000000-0000-4000-8000-000000000003', 'member-quota-coordinator@example.test', now(), false, false, now(), now()),
  ('15000000-0000-4000-8000-000000000004', 'member-quota-cross-group@example.test', now(), false, false, now(), now());

insert into public.user_profiles (user_id)
values
  ('15000000-0000-4000-8000-000000000001'),
  ('15000000-0000-4000-8000-000000000002'),
  ('15000000-0000-4000-8000-000000000003'),
  ('15000000-0000-4000-8000-000000000004');

insert into public.groups (id, name, time_zone)
values
  ('55000000-0000-4000-8000-000000000001', 'Member quota group A', 'UTC'),
  ('55000000-0000-4000-8000-000000000002', 'Member quota group B', 'UTC');

insert into public.memberships (
  id, group_id, user_id, role, status, activated_at
)
values
  ('65000000-0000-4000-8000-000000000001', '55000000-0000-4000-8000-000000000001', '15000000-0000-4000-8000-000000000001', 'administrator', 'active', now()),
  ('65000000-0000-4000-8000-000000000002', '55000000-0000-4000-8000-000000000001', '15000000-0000-4000-8000-000000000002', 'member', 'active', now()),
  ('65000000-0000-4000-8000-000000000003', '55000000-0000-4000-8000-000000000001', '15000000-0000-4000-8000-000000000003', 'coordinator', 'active', now()),
  ('65000000-0000-4000-8000-000000000004', '55000000-0000-4000-8000-000000000002', '15000000-0000-4000-8000-000000000004', 'administrator', 'active', now()),
  ('65000000-0000-4000-8000-000000000005', '55000000-0000-4000-8000-000000000001', null, 'member', 'pending', null),
  ('65000000-0000-4000-8000-000000000006', '55000000-0000-4000-8000-000000000001', null, 'member', 'pending', null);

update public.memberships
set initial_quota = 30.00,
    uses_initial_quota = true,
    initial_quota_provenance = 'legacy_import'
where id = '65000000-0000-4000-8000-000000000006';

select throws_ok(
  $$ select * from public.resolve_membership_quota_bootstrap_context(
    '15000000-0000-4000-8000-000000000002',
    '65000000-0000-4000-8000-000000000002'
  ) $$,
  'P0003',
  'actor_not_authorized',
  'a member cannot resolve the administrator quota context'
);
select throws_ok(
  $$ select * from public.resolve_membership_quota_bootstrap_context(
    '15000000-0000-4000-8000-000000000001',
    '65000000-0000-4000-8000-000000000004'
  ) $$,
  'P0002',
  'membership_unavailable',
  'an administrator cannot resolve a guessed cross-group target'
);
select throws_ok(
  $$ select * from public.configure_membership_quota_bootstrap(
    '15000000-0000-4000-8000-000000000002',
    '65000000-0000-4000-8000-000000000005',
    24.50, true, '["10.00"]', false, null,
    '{"kind":"not_ready","settings_version":0,"method":"moving_average","history_length":10,"precision":1,"rounding_rule":"half_away_from_zero"}',
    0, 0, 'Member attempt',
    '25000000-0000-4000-8000-000000000001',
    '35000000-0000-4000-8000-000000000001'
  ) $$,
  'P0003',
  'actor_not_authorized',
  'a member cannot configure another membership'
);

select * from public.configure_group_quota_rules(
  '15000000-0000-4000-8000-000000000001',
  'moving_average',
  10,
  1,
  'half_away_from_zero',
  '[]',
  0,
  'Member quota setup policy',
  '25000000-0000-4000-8000-000000000002',
  '35000000-0000-4000-8000-000000000002'
);

select throws_ok(
  $$ select * from public.configure_membership_quota_bootstrap(
    '15000000-0000-4000-8000-000000000001',
    '65000000-0000-4000-8000-000000000002',
    24.50, true, '["10.00"]', true, 24.5,
    '{"kind":"seed_history","settings_version":1,"method":"moving_average","history_length":10,"precision":2,"rounding_rule":"half_away_from_zero"}',
    0, 2, 'Stale settings',
    '25000000-0000-4000-8000-000000000003',
    '35000000-0000-4000-8000-000000000003'
  ) $$,
  '40001',
  'quota_settings_version_changed',
  'a stale settings version is rejected before persistence'
);
select throws_ok(
  $$ select * from public.configure_membership_quota_bootstrap(
    '15000000-0000-4000-8000-000000000001',
    '65000000-0000-4000-8000-000000000002',
    24.50, true, '["10.00"]', true, 24.5,
    '{"kind":"seed_history","settings_version":1,"method":"moving_average","history_length":10,"precision":2,"rounding_rule":"half_away_from_zero"}',
    0, 1, 'Precision mismatch',
    '25000000-0000-4000-8000-000000000004',
    '35000000-0000-4000-8000-000000000004'
  ) $$,
  '22023',
  'quota_projection_precision_invalid',
  'a projection source precision must match current settings'
);
select throws_ok(
  $$ select * from public.configure_membership_quota_bootstrap(
    '15000000-0000-4000-8000-000000000001',
    '65000000-0000-4000-8000-000000000002',
    24.50, true, '["10.00"]', true, 24.5,
    '{"kind":"initial_quota","settings_version":1,"method":"best_10_of_20","history_length":null,"precision":1,"rounding_rule":"half_away_from_zero"}',
    0, 1, 'Rule snapshot mismatch',
    '25000000-0000-4000-8000-000000000014',
    '35000000-0000-4000-8000-000000000014'
  ) $$,
  '22023',
  'quota_projection_rules_mismatch',
  'a projection rule snapshot must match current settings'
);
select throws_ok(
  $$ select * from public.configure_membership_quota_bootstrap(
    '15000000-0000-4000-8000-000000000001',
    '65000000-0000-4000-8000-000000000002',
    24.50, true, '["10.001"]', false, null,
    '{"kind":"not_ready","settings_version":1,"method":"moving_average","history_length":10,"precision":1,"rounding_rule":"half_away_from_zero"}',
    0, 1, 'Invalid seed',
    '25000000-0000-4000-8000-000000000005',
    '35000000-0000-4000-8000-000000000005'
  ) $$,
  '22023',
  'quota_seed_invalid',
  'a seed with more than two decimal places is rejected'
);
select throws_ok(
  $$ select * from public.configure_membership_quota_bootstrap(
    '15000000-0000-4000-8000-000000000001',
    '65000000-0000-4000-8000-000000000002',
    24.50, true, '[10.00]', false, null,
    '{"kind":"not_ready","settings_version":1,"method":"moving_average","history_length":10,"precision":1,"rounding_rule":"half_away_from_zero"}',
    0, 1, 'Invalid seed',
    '25000000-0000-4000-8000-000000000006',
    '35000000-0000-4000-8000-000000000006'
  ) $$,
  '22023',
  'quota_seed_invalid',
  'a non-string seed is rejected by the exact decimal boundary'
);

create temporary table first_member_quota_configuration as
select * from public.configure_membership_quota_bootstrap(
  '15000000-0000-4000-8000-000000000001',
  '65000000-0000-4000-8000-000000000002',
  24.50,
  true,
  '["10.00","20.50","30.00"]',
  true,
  24.5,
  '{"kind":"initial_quota","settings_version":1,"method":"moving_average","history_length":10,"precision":1,"rounding_rule":"half_away_from_zero","seed_positions":[]}',
  0,
  1,
  'Set initial quota and seed history',
  '25000000-0000-4000-8000-000000000007',
  '35000000-0000-4000-8000-000000000007'
);

select is(
  (select configured_membership_id::uuid from first_member_quota_configuration),
  '65000000-0000-4000-8000-000000000002'::uuid,
  'the mutation returns the requested membership'
);
select is(
  (select projection_version from first_member_quota_configuration),
  1::bigint,
  'the first projection version is one'
);
select is(
  (select initial_quota::numeric from public.memberships where id = '65000000-0000-4000-8000-000000000002'),
  24.50::numeric,
  'the initial quota is stored on the membership'
);
select is(
  (select uses_initial_quota from public.memberships where id = '65000000-0000-4000-8000-000000000002'),
  true,
  'bootstrap remains active below the Method A threshold'
);
select is(
  (select array_agg(point_total::numeric order by position)::text from public.membership_quota_seed_totals where membership_id = '65000000-0000-4000-8000-000000000002'),
  '{10.00,20.50,30.00}',
  'seed values retain oldest-first order and exact decimals'
);
select is(
  (select projection_source ->> 'kind' from public.membership_quota_projections where membership_id = '65000000-0000-4000-8000-000000000002'),
  'initial_quota',
  'projection provenance is persisted as safe JSON metadata'
);
select is(
  (select projection_source ->> 'method' from public.membership_quota_projections where membership_id = '65000000-0000-4000-8000-000000000002'),
  'moving_average',
  'projection provenance snapshots the quota method used'
);
select is(
  (select count(*) from public.audit_events where action = 'membership.quota_bootstrap_configured'),
  1::bigint,
  'the bootstrap writes exactly one audit event'
);
select is(
  (select reason from public.audit_events where action = 'membership.quota_bootstrap_configured'),
  'Set initial quota and seed history',
  'the required reason is audited'
);
select is(
  (select context_group_id::uuid from public.resolve_membership_quota_bootstrap_context(
    '15000000-0000-4000-8000-000000000001',
    '65000000-0000-4000-8000-000000000002'
  )),
  '55000000-0000-4000-8000-000000000001'::uuid,
  'context resolves the target tenant from the administrator'
);
select is(
  (select projection_version from public.resolve_membership_quota_bootstrap_context(
    '15000000-0000-4000-8000-000000000001',
    '65000000-0000-4000-8000-000000000002'
  )),
  1::bigint,
  'context returns the current projection version'
);
select is(
  (select settings_version from public.resolve_membership_quota_bootstrap_context(
    '15000000-0000-4000-8000-000000000001',
    '65000000-0000-4000-8000-000000000002'
  )),
  1::bigint,
  'context returns the current quota-settings version'
);

select * from public.configure_membership_quota_bootstrap(
  '15000000-0000-4000-8000-000000000001',
  '65000000-0000-4000-8000-000000000002',
  null,
  false,
  '["99.99"]',
  false,
  null,
  '{"kind":"not_ready","settings_version":1,"method":"moving_average","history_length":10,"precision":1,"rounding_rule":"half_away_from_zero"}',
  0,
  1,
  'Ignored retry payload',
  '25000000-0000-4000-8000-000000000099',
  '35000000-0000-4000-8000-000000000007'
);
select is(
  (select projection_version from public.membership_quota_projections where membership_id = '65000000-0000-4000-8000-000000000002'),
  1::bigint,
  'an idempotent retry does not advance projection version'
);
select is(
  (select count(*) from public.audit_events where action = 'membership.quota_bootstrap_configured'),
  1::bigint,
  'an idempotent retry does not duplicate the audit event'
);
select is(
  (select count(*) from public.membership_quota_seed_totals where membership_id = '65000000-0000-4000-8000-000000000002'),
  3::bigint,
  'an idempotent retry does not replace seed history'
);

select throws_ok(
  $$ select * from public.configure_membership_quota_bootstrap(
    '15000000-0000-4000-8000-000000000001',
    '65000000-0000-4000-8000-000000000002',
    24.50, true, '["10.00"]', true, 24.5,
    '{"kind":"initial_quota","settings_version":1,"method":"moving_average","history_length":10,"precision":1,"rounding_rule":"half_away_from_zero"}',
    7, 1, 'Stale projection',
    '25000000-0000-4000-8000-000000000008',
    '35000000-0000-4000-8000-000000000008'
  ) $$,
  '40001',
  'quota_projection_version_changed',
  'a stale projection version is rejected'
);

select * from public.configure_membership_quota_bootstrap(
  '15000000-0000-4000-8000-000000000001',
  '65000000-0000-4000-8000-000000000006',
  24.50,
  false,
  '["10","20","30"]',
  true,
  20.0,
  '{"kind":"seed_history","settings_version":1,"method":"moving_average","history_length":10,"precision":1,"rounding_rule":"half_away_from_zero","seed_positions":[1,2,3]}',
  0,
  1,
  'Disable the initial freeze with projected impact',
  '25000000-0000-4000-8000-000000000013',
  '35000000-0000-4000-8000-000000000013'
);
select is(
  (select uses_initial_quota from public.memberships where id = '65000000-0000-4000-8000-000000000006'),
  false,
  'an administrator can explicitly disable the initial freeze before the Method A threshold'
);
select is(
  (select projected_quota::numeric from public.membership_quota_projections where membership_id = '65000000-0000-4000-8000-000000000006'),
  20.0::numeric,
  'early freeze disable stores the reviewed seed-history projection'
);
select is(
  (select initial_quota_provenance from public.memberships where id = '65000000-0000-4000-8000-000000000006'),
  'member_bootstrap',
  'replacing an initial quota attributes the new value to the current bootstrap operation'
);
select is(
  (select before_state ->> 'initial_quota' from public.audit_events where operation_id = '35000000-0000-4000-8000-000000000013'),
  '30.00',
  'the first projection audit retains a pre-existing initial quota value'
);

select * from public.configure_membership_quota_bootstrap(
  '15000000-0000-4000-8000-000000000001',
  '65000000-0000-4000-8000-000000000002',
  24.50,
  true,
  '["1","2","3","4","5","6","7","8","9","10"]',
  true,
  5.5,
  '{"kind":"seed_history","settings_version":1,"method":"moving_average","history_length":10,"precision":1,"rounding_rule":"half_away_from_zero","seed_positions":[1,2,3,4,5,6,7,8,9,10]}',
  1,
  1,
  'Complete Method A bootstrap history',
  '25000000-0000-4000-8000-000000000009',
  '35000000-0000-4000-8000-000000000009'
);
select is(
  (select uses_initial_quota from public.memberships where id = '65000000-0000-4000-8000-000000000002'),
  false,
  'Method A automatically deactivates initial quota at N seed totals'
);
select is(
  (select projection_version from public.membership_quota_projections where membership_id = '65000000-0000-4000-8000-000000000002'),
  2::bigint,
  'a successful replacement advances projection version once'
);
select is(
  (select count(*) from public.membership_quota_seed_totals where membership_id = '65000000-0000-4000-8000-000000000002'),
  10::bigint,
  'the ordered seed set is replaced atomically'
);

select * from public.configure_group_quota_rules(
  '15000000-0000-4000-8000-000000000001',
  'previous_plus_minus',
  null,
  1,
  'half_away_from_zero',
  '[{"lower_bound":-100,"lower_inclusive":true,"upper_bound":0,"upper_inclusive":false,"adjustment":1},{"lower_bound":0,"lower_inclusive":true,"upper_bound":100,"upper_inclusive":true,"adjustment":-1}]',
  1,
  'Switch to Method C',
  '25000000-0000-4000-8000-000000000010',
  '35000000-0000-4000-8000-000000000010'
);
select is(
  (select projection_source ->> 'method' from public.membership_quota_projections where membership_id = '65000000-0000-4000-8000-000000000002'),
  'moving_average',
  'a later settings change does not rewrite the rule snapshot on an existing projection'
);
select * from public.configure_membership_quota_bootstrap(
  '15000000-0000-4000-8000-000000000001',
  '65000000-0000-4000-8000-000000000005',
  24.50,
  true,
  '["1","2","3","4","5","6","7","8","9","10"]',
  true,
  24.5,
  '{"kind":"initial_quota","settings_version":2,"method":"previous_plus_minus","history_length":null,"precision":1,"rounding_rule":"half_away_from_zero"}',
  0,
  2,
  'Configure Method C member bootstrap',
  '25000000-0000-4000-8000-000000000011',
  '35000000-0000-4000-8000-000000000011'
);
select is(
  (select uses_initial_quota from public.memberships where id = '65000000-0000-4000-8000-000000000005'),
  true,
  'Method C seed totals do not deactivate the initial quota freeze'
);
select is(
  (select projection_source ->> 'kind' from public.membership_quota_projections where membership_id = '65000000-0000-4000-8000-000000000005'),
  'initial_quota',
  'Method C bootstrap provenance remains initial quota until an official round'
);

select throws_ok(
  $$ select * from public.configure_membership_quota_bootstrap(
    '15000000-0000-4000-8000-000000000001',
    '65000000-0000-4000-8000-000000000005',
    24.50, true,
    '["1","2","3","4","5","6","7","8","9","10","11","12","13","14","15","16","17","18","19","20","21"]',
    true, 24.5,
    '{"kind":"initial_quota","settings_version":2,"method":"previous_plus_minus","history_length":null,"precision":1,"rounding_rule":"half_away_from_zero"}',
    1, 2, 'Too many seeds',
    '25000000-0000-4000-8000-000000000012',
    '35000000-0000-4000-8000-000000000012'
  ) $$,
  '22023',
  'quota_seed_limit_exceeded',
  'more than twenty seed totals are rejected'
);

select * from finish();

rollback;
