begin;

create extension if not exists pgtap with schema extensions;

select plan(40);

select has_type('public', 'quota_method', 'quota methods have a database enum');
select has_type('public', 'quota_rounding_rule', 'quota rounding has an explicit database rule');
select has_table('public', 'group_quota_settings', 'group quota settings exist');
select has_table('public', 'quota_adjustment_bands', 'Method C adjustment bands exist');
select has_pk('public', 'group_quota_settings', 'one current settings row is keyed by group');
select has_pk('public', 'quota_adjustment_bands', 'adjustment bands have immutable identities');
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid = 'public.group_quota_settings'::regclass),
  'quota settings enable and force RLS'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid = 'public.quota_adjustment_bands'::regclass),
  'quota bands enable and force RLS'
);
select ok(
  not has_table_privilege('authenticated', 'public.group_quota_settings', 'insert,update,delete'),
  'authenticated users cannot write settings directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.quota_adjustment_bands', 'insert,update,delete'),
  'authenticated users cannot write bands directly'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.configure_group_quota_rules(uuid,public.quota_method,integer,integer,public.quota_rounding_rule,jsonb,bigint,text,uuid,uuid)',
    'execute'
  ),
  'authenticated clients cannot bypass the trusted settings boundary'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.configure_group_quota_rules(uuid,public.quota_method,integer,integer,public.quota_rounding_rule,jsonb,bigint,text,uuid,uuid)',
    'execute'
  ),
  'the trusted server can configure quota rules'
);
select ok(
  (select prosecdef from pg_catalog.pg_proc where oid = 'public.configure_group_quota_rules(uuid,public.quota_method,integer,integer,public.quota_rounding_rule,jsonb,bigint,text,uuid,uuid)'::regprocedure),
  'the settings mutation is a security definer'
);
select ok(
  (select proconfig = array['search_path=""'] from pg_catalog.pg_proc where oid = 'public.configure_group_quota_rules(uuid,public.quota_method,integer,integer,public.quota_rounding_rule,jsonb,bigint,text,uuid,uuid)'::regprocedure),
  'the settings mutation pins an empty search path'
);

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at
)
values
  ('14000000-0000-4000-8000-000000000001', 'quota-admin-a@example.test', now(), false, false, now(), now()),
  ('14000000-0000-4000-8000-000000000002', 'quota-member-a@example.test', now(), false, false, now(), now()),
  ('14000000-0000-4000-8000-000000000003', 'quota-coordinator-a@example.test', now(), false, false, now(), now()),
  ('14000000-0000-4000-8000-000000000004', 'quota-admin-b@example.test', now(), false, false, now(), now());

insert into public.user_profiles (user_id)
values
  ('14000000-0000-4000-8000-000000000001'),
  ('14000000-0000-4000-8000-000000000002'),
  ('14000000-0000-4000-8000-000000000003'),
  ('14000000-0000-4000-8000-000000000004');

insert into public.groups (id, name, time_zone)
values
  ('54000000-0000-4000-8000-000000000001', 'Quota Group A', 'UTC'),
  ('54000000-0000-4000-8000-000000000002', 'Quota Group B', 'UTC');

insert into public.memberships (id, group_id, user_id, role, status, activated_at)
values
  ('64000000-0000-4000-8000-000000000001', '54000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000001', 'administrator', 'active', now()),
  ('64000000-0000-4000-8000-000000000002', '54000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000002', 'member', 'active', now()),
  ('64000000-0000-4000-8000-000000000003', '54000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000003', 'coordinator', 'active', now()),
  ('64000000-0000-4000-8000-000000000004', '54000000-0000-4000-8000-000000000002', '14000000-0000-4000-8000-000000000004', 'administrator', 'active', now());

select throws_ok(
  $$ select * from public.configure_group_quota_rules(
    '14000000-0000-4000-8000-000000000002', 'moving_average', 10, 1,
    'half_away_from_zero', '[]', 0, 'Member attempt',
    '24000000-0000-4000-8000-000000000001', '34000000-0000-4000-8000-000000000001'
  ) $$,
  'P0003', 'actor_not_authorized', 'members cannot configure quota rules'
);
select throws_ok(
  $$ select * from public.configure_group_quota_rules(
    '14000000-0000-4000-8000-000000000003', 'moving_average', 10, 1,
    'half_away_from_zero', '[]', 0, 'Coordinator attempt',
    '24000000-0000-4000-8000-000000000002', '34000000-0000-4000-8000-000000000002'
  ) $$,
  'P0003', 'actor_not_authorized', 'coordinators cannot configure quota rules'
);
select throws_ok(
  $$ select * from public.configure_group_quota_rules(
    '14000000-0000-4000-8000-000000000001', 'moving_average', 3, 1,
    'half_away_from_zero', '[]', 0, 'Invalid history',
    '24000000-0000-4000-8000-000000000003', '34000000-0000-4000-8000-000000000003'
  ) $$,
  '22023', 'quota_history_length_invalid', 'Method A history length is constrained to 4 through 20'
);
select throws_ok(
  $$ select * from public.configure_group_quota_rules(
    '14000000-0000-4000-8000-000000000001', 'moving_average', null, 1,
    'half_away_from_zero', '[]', 0, 'Missing history',
    '24000000-0000-4000-8000-000000000030', '34000000-0000-4000-8000-000000000030'
  ) $$,
  '22023', 'quota_history_length_invalid', 'Method A cannot persist without a history length'
);

create temporary table first_configuration as
select * from public.configure_group_quota_rules(
  '14000000-0000-4000-8000-000000000001', 'moving_average', 10, 2,
  'half_away_from_zero', '[]', 0, 'Initial quota policy',
  '24000000-0000-4000-8000-000000000004', '34000000-0000-4000-8000-000000000004'
);

select is((select configured_group_id::uuid from first_configuration), '54000000-0000-4000-8000-000000000001'::uuid, 'the mutation derives the actor tenant');
select is((select settings_version from first_configuration), 1::bigint, 'the first settings version is one');
select is((select method from public.group_quota_settings where group_id = '54000000-0000-4000-8000-000000000001'), 'moving_average'::public.quota_method, 'Method A is stored');
select is((select moving_average_history_length from public.group_quota_settings where group_id = '54000000-0000-4000-8000-000000000001'), 10::smallint, 'Method A history length is stored');
select is((select count(*) from public.audit_events where action = 'group.quota_rules_configured'), 1::bigint, 'configuration writes one audit event');
select is((select reason from public.audit_events where action = 'group.quota_rules_configured'), 'Initial quota policy'::text, 'configuration stores its required reason');

select * from public.configure_group_quota_rules(
  '14000000-0000-4000-8000-000000000001', 'best_10_of_20', null, 0,
  'half_away_from_zero', '[]', 0, 'Ignored retry payload',
  '24000000-0000-4000-8000-000000000099', '34000000-0000-4000-8000-000000000004'
);
select is((select version from public.group_quota_settings where group_id = '54000000-0000-4000-8000-000000000001'), 1::bigint, 'an idempotent retry does not advance settings');
select is((select count(*) from public.audit_events where action = 'group.quota_rules_configured'), 1::bigint, 'an idempotent retry does not duplicate audit');

select throws_ok(
  $$ select * from public.configure_group_quota_rules(
    '14000000-0000-4000-8000-000000000001', 'best_10_of_20', null, 1,
    'half_away_from_zero', '[]', 2, 'Stale settings screen',
    '24000000-0000-4000-8000-000000000005', '34000000-0000-4000-8000-000000000005'
  ) $$,
  '40001', 'quota_settings_version_changed', 'stale settings versions are rejected'
);

select throws_ok(
  $$ select * from public.configure_group_quota_rules(
    '14000000-0000-4000-8000-000000000001', 'previous_plus_minus', null, 1,
    'half_away_from_zero',
    '[{"lower_bound":-100,"lower_inclusive":true,"upper_bound":0,"upper_inclusive":false,"adjustment":1},{"lower_bound":1,"lower_inclusive":true,"upper_bound":100,"upper_inclusive":true,"adjustment":-1}]',
    1, 'Gap attempt', '24000000-0000-4000-8000-000000000006', '34000000-0000-4000-8000-000000000006'
  ) $$,
  '22023', 'quota_bands_incomplete_or_overlapping', 'a Method C gap cannot be saved'
);
select throws_ok(
  $$ select * from public.configure_group_quota_rules(
    '14000000-0000-4000-8000-000000000001', 'previous_plus_minus', null, 1,
    'half_away_from_zero',
    '[{"lower_bound":-100,"lower_inclusive":true,"upper_bound":0,"upper_inclusive":true,"adjustment":1},{"lower_bound":0,"lower_inclusive":true,"upper_bound":100,"upper_inclusive":true,"adjustment":-1}]',
    1, 'Overlap attempt', '24000000-0000-4000-8000-000000000007', '34000000-0000-4000-8000-000000000007'
  ) $$,
  '22023', 'quota_bands_incomplete_or_overlapping', 'a Method C overlap cannot be saved'
);
select is((select version from public.group_quota_settings where group_id = '54000000-0000-4000-8000-000000000001'), 1::bigint, 'rejected band sets leave settings unchanged');

create temporary table method_c_configuration as
select * from public.configure_group_quota_rules(
  '14000000-0000-4000-8000-000000000001', 'previous_plus_minus', null, 1,
  'half_away_from_zero',
  '[{"lower_bound":-100,"lower_inclusive":true,"upper_bound":0,"upper_inclusive":false,"adjustment":1.25},{"lower_bound":0,"lower_inclusive":true,"upper_bound":100,"upper_inclusive":true,"adjustment":-0.75}]',
  1, 'Adopt Method C', '24000000-0000-4000-8000-000000000008', '34000000-0000-4000-8000-000000000008'
);

select is((select settings_version from method_c_configuration), 2::bigint, 'a successful replacement advances settings once');
select is((select count(*) from public.quota_adjustment_bands where group_id = '54000000-0000-4000-8000-000000000001'), 2::bigint, 'the complete Method C set is stored atomically');
select is((select adjustment::numeric from public.quota_adjustment_bands where group_id = '54000000-0000-4000-8000-000000000001' and position = 1), 1.25::numeric, 'band adjustment preserves exact decimal input');
select is((select count(*) from public.audit_events where action = 'group.quota_rules_configured'), 2::bigint, 'the successful replacement appends one audit event');
select is((select before_state ->> 'method' from public.audit_events where action = 'group.quota_rules_configured' and target_version = 2), 'moving_average'::text, 'replacement audit captures prior settings');

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '14000000-0000-4000-8000-000000000001', true);
select is((select count(*) from public.group_quota_settings), 1::bigint, 'an administrator reads only their tenant settings');
select is((select count(*) from public.quota_adjustment_bands), 2::bigint, 'an administrator reads only their tenant bands');
select is((select quota_rules_configured from public.resolve_group_onboarding()), true, 'onboarding derives configured rules from the settings record');

select pg_catalog.set_config('request.jwt.claim.sub', '14000000-0000-4000-8000-000000000002', true);
select is((select count(*) from public.group_quota_settings), 0::bigint, 'members cannot read administrative quota settings');

select pg_catalog.set_config('request.jwt.claim.sub', '14000000-0000-4000-8000-000000000004', true);
select is((select count(*) from public.group_quota_settings), 0::bigint, 'another administrator cannot infer cross-tenant settings');

reset role;
select pg_catalog.set_config('request.jwt.claim.sub', '', true);

select * from finish();

rollback;
