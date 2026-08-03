begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

select has_function(
  'public',
  'read_coordinator_round_detail',
  array['uuid', 'uuid'],
  'coordinator round-detail read RPC exists'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.read_coordinator_round_detail(uuid,uuid)',
    'execute'
  ),
  'trusted server can execute the round-detail read RPC'
);
select ok(
  not has_function_privilege(
    'public',
    'public.read_coordinator_round_detail(uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.read_coordinator_round_detail(uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.read_coordinator_round_detail(uuid,uuid)',
    'execute'
  ),
  'client roles have no direct round-detail RPC grant'
);
select ok(
  not has_table_privilege('service_role', 'public.rounds', 'select')
  and not has_table_privilege('service_role', 'public.round_rule_snapshots', 'select')
  and not has_table_privilege('service_role', 'public.round_participants', 'select'),
  'service role has no direct access to force-RLS round source tables'
);
select ok(
  (select prosecdef from pg_catalog.pg_proc where oid =
    'public.read_coordinator_round_detail(uuid,uuid)'::regprocedure)
  and (select proconfig = array['search_path=""'] from pg_catalog.pg_proc where oid =
    'public.read_coordinator_round_detail(uuid,uuid)'::regprocedure),
  'round-detail read is a pinned security-definer boundary'
);
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class where oid = 'public.rounds'::regclass)
  and (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class where oid = 'public.round_rule_snapshots'::regclass)
  and (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class where oid = 'public.round_participants'::regclass),
  'round-detail source tables remain force-RLS protected'
);

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at
)
values
  ('1d000000-0000-4000-8000-000000000001', 'detail-admin-a@example.test', now(), false, false, now(), now()),
  ('1d000000-0000-4000-8000-000000000002', 'detail-coordinator-a@example.test', now(), false, false, now(), now()),
  ('1d000000-0000-4000-8000-000000000003', 'detail-member-a@example.test', now(), false, false, now(), now()),
  ('1d000000-0000-4000-8000-000000000004', 'detail-admin-b@example.test', now(), false, false, now(), now()),
  ('1d000000-0000-4000-8000-000000000005', 'detail-recovery-a@example.test', now(), false, false, now(), now()),
  ('1d000000-0000-4000-8000-000000000006', 'detail-unverified-a@example.test', null, false, false, now(), now());

update auth.users
set raw_app_meta_data = '{"greenroster_password_recovery":true}'::jsonb
where id = '1d000000-0000-4000-8000-000000000005';

insert into public.user_profiles (user_id, first_name, last_name)
values
  ('1d000000-0000-4000-8000-000000000001', 'Detail', 'Admin'),
  ('1d000000-0000-4000-8000-000000000002', 'Detail', 'Coordinator'),
  ('1d000000-0000-4000-8000-000000000003', 'Detail', 'Member'),
  ('1d000000-0000-4000-8000-000000000004', 'Detail', 'Other Group'),
  ('1d000000-0000-4000-8000-000000000005', 'Detail', 'Recovery'),
  ('1d000000-0000-4000-8000-000000000006', 'Detail', 'Unverified');

insert into public.groups (id, name, time_zone)
values
  ('1e000000-0000-4000-8000-000000000001', 'Detail Group A', 'America/New_York'),
  ('1e000000-0000-4000-8000-000000000002', 'Detail Group B', 'UTC');

insert into public.memberships (id, group_id, user_id, role, status, activated_at)
values
  ('1f000000-0000-4000-8000-000000000001', '1e000000-0000-4000-8000-000000000001', '1d000000-0000-4000-8000-000000000001', 'administrator', 'active', now()),
  ('1f000000-0000-4000-8000-000000000002', '1e000000-0000-4000-8000-000000000001', '1d000000-0000-4000-8000-000000000002', 'coordinator', 'active', now()),
  ('1f000000-0000-4000-8000-000000000003', '1e000000-0000-4000-8000-000000000001', '1d000000-0000-4000-8000-000000000003', 'member', 'active', now()),
  ('1f000000-0000-4000-8000-000000000004', '1e000000-0000-4000-8000-000000000002', '1d000000-0000-4000-8000-000000000004', 'administrator', 'active', now()),
  ('1f000000-0000-4000-8000-000000000005', '1e000000-0000-4000-8000-000000000001', '1d000000-0000-4000-8000-000000000005', 'administrator', 'active', now()),
  ('1f000000-0000-4000-8000-000000000006', '1e000000-0000-4000-8000-000000000001', '1d000000-0000-4000-8000-000000000006', 'coordinator', 'active', now());

insert into public.membership_golfer_profiles (
  membership_id, group_id, first_name, last_name, tee_location
)
values
  ('1f000000-0000-4000-8000-000000000001', '1e000000-0000-4000-8000-000000000001', 'Detail', 'Admin', 'middle'),
  ('1f000000-0000-4000-8000-000000000002', '1e000000-0000-4000-8000-000000000001', 'Detail', 'Coordinator', 'back'),
  ('1f000000-0000-4000-8000-000000000003', '1e000000-0000-4000-8000-000000000001', 'Detail', 'Member', 'front'),
  ('1f000000-0000-4000-8000-000000000005', '1e000000-0000-4000-8000-000000000001', 'Detail', 'Recovery', 'middle');

insert into public.group_quota_settings (
  group_id, method, moving_average_history_length, precision, rounding_rule, version, updated_by
)
values (
  '1e000000-0000-4000-8000-000000000001', 'moving_average', 10, 1,
  'half_away_from_zero', 4, '1d000000-0000-4000-8000-000000000001'
);

insert into public.rounds (
  id, group_id, description, scheduled_at, group_time_zone, venue, round_url,
  notes, notes_visible_to_players, rsvp_deadline_at, format, state, version,
  published_at, created_by
)
values (
  '20000000-0000-4000-8000-000000000001',
  '1e000000-0000-4000-8000-000000000001',
  'Detail Round', '2026-08-15 13:30:00+00', 'America/New_York',
  'North Course', 'https://example.test/rounds/detail', 'Bring a cart.', true,
  '2026-08-14 13:30:00+00', 'individual_net', 'published', 7,
  '2026-08-03 12:00:00+00', '1d000000-0000-4000-8000-000000000001'
);

insert into public.round_rule_snapshots (
  round_id, group_id, format, quota_method, moving_average_history_length,
  quota_precision, quota_rounding_rule, adjustment_bands, settings_version
)
values (
  '20000000-0000-4000-8000-000000000001',
  '1e000000-0000-4000-8000-000000000001',
  'individual_net', 'moving_average', 10, 1, 'half_away_from_zero', '[]'::jsonb, 4
);

insert into public.round_participants (
  id, round_id, group_id, membership_id, rsvp_status, version,
  quota_snapshot, quota_snapshot_source, handicap_snapshot,
  handicap_snapshot_source, handicap_snapshot_as_of, tee_snapshot
)
values
  (
    '21000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '1e000000-0000-4000-8000-000000000001',
    '1f000000-0000-4000-8000-000000000001', 'playing', 2,
    12.3, '{"method":"moving_average"}'::jsonb, 8.7, 'manual', '2026-08-01', 'middle'
  ),
  (
    '21000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000001',
    '1e000000-0000-4000-8000-000000000001',
    '1f000000-0000-4000-8000-000000000002', 'not_playing', 3,
    11.0, '{"method":"moving_average"}'::jsonb, null, null, null, 'back'
  ),
  (
    '21000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000001',
    '1e000000-0000-4000-8000-000000000001',
    '1f000000-0000-4000-8000-000000000003', 'no_response', 1,
    10.5, '{"method":"moving_average"}'::jsonb, null, null, null, 'front'
  );

create temporary table coordinator_detail as
select public.read_coordinator_round_detail(
  '1d000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000001'
) as payload;

select is(
  (select payload -> 'round' ->> 'description' from coordinator_detail),
  'Detail Round',
  'same-tenant coordinator can read round configuration'
);
select is(
  (select payload -> 'round' ->> 'state' from coordinator_detail),
  'published',
  'round state is included in the envelope'
);
select is(
  (select payload -> 'round' ->> 'version' from coordinator_detail),
  '7',
  'round version is included in the envelope'
);
select is(
  (select payload -> 'round' ->> 'published_at' from coordinator_detail),
  '2026-08-03T12:00:00+00:00',
  'published timestamp is included in the envelope'
);
select is(
  (select payload -> 'rule_snapshot' ->> 'quota_method' from coordinator_detail),
  'moving_average',
  'immutable quota rule snapshot is included'
);
select is(
  (select payload -> 'rule_snapshot' ->> 'round_id' from coordinator_detail),
  '20000000-0000-4000-8000-000000000001',
  'rule snapshot identifies its round'
);
select is(
  (select payload -> 'rule_snapshot' ->> 'group_id' from coordinator_detail),
  '1e000000-0000-4000-8000-000000000001',
  'rule snapshot identifies its tenant'
);
select is(
  (select payload -> 'rule_snapshot' ->> 'settings_version' from coordinator_detail),
  '4',
  'immutable settings version is included'
);
select is(
  (select jsonb_array_length(payload -> 'participants') from coordinator_detail),
  3,
  'coordinator receives every member participant row'
);
select is(
  (select payload -> 'participants' -> 0 ->> 'quota_snapshot' from coordinator_detail),
  '12.3',
  'participant quota snapshot retains exact value'
);
select is(
  (select payload -> 'participants' -> 0 ->> 'handicap_snapshot' from coordinator_detail),
  '8.7',
  'participant handicap snapshot retains exact value'
);
select is(
  (select payload -> 'participants' -> 0 ->> 'version' from coordinator_detail),
  '2',
  'participant version is included'
);
select is(
  (select payload -> 'counts' from coordinator_detail),
  '{"guest_count": 0, "playing_count": 1, "no_response_count": 1, "not_playing_count": 1}'::jsonb,
  'counts are server-derived and guests are explicitly zero until guest rows exist'
);

create temporary table administrator_detail as
select public.read_coordinator_round_detail(
  '1d000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001'
) as payload;
select is(
  (select payload from administrator_detail),
  (select payload from coordinator_detail),
  'same-tenant administrator receives the same complete detail envelope'
);

select throws_ok(
  $$ select public.read_coordinator_round_detail(
    '1d000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000001'
  ) $$,
  'P0003',
  'actor_not_authorized',
  'ordinary members cannot read the coordinator round-detail projection'
);
select throws_ok(
  $$ select public.read_coordinator_round_detail(
    '1d000000-0000-4000-8000-000000000004',
    '20000000-0000-4000-8000-000000000001'
  ) $$,
  'P0002',
  'round_not_found',
  'cross-tenant administrators cannot read another group round'
);
select throws_ok(
  $$ select public.read_coordinator_round_detail(
    '1d000000-0000-4000-8000-000000000005',
    '20000000-0000-4000-8000-000000000001'
  ) $$,
  'P0003',
  'recovery_session_forbidden',
  'password-recovery sessions cannot read the round detail'
);
select throws_ok(
  $$ select public.read_coordinator_round_detail(
    '1d000000-0000-4000-8000-000000000006',
    '20000000-0000-4000-8000-000000000001'
  ) $$,
  'P0003',
  'actor_not_authorized',
  'unverified coordinators cannot read the round detail'
);
update public.memberships
set status = 'inactive', inactivated_at = now()
where id = '1f000000-0000-4000-8000-000000000002';
select throws_ok(
  $$ select public.read_coordinator_round_detail(
    '1d000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000001'
  ) $$,
  'P0003',
  'actor_not_authorized',
  'inactive coordinators cannot read the round detail'
);
update public.memberships
set status = 'active', inactivated_at = null, activated_at = now()
where id = '1f000000-0000-4000-8000-000000000002';

update public.group_quota_settings
set method = 'best_10_of_20',
    moving_average_history_length = null,
    precision = 2,
    version = 5
where group_id = '1e000000-0000-4000-8000-000000000001';

create temporary table detail_after_settings_change as
select public.read_coordinator_round_detail(
  '1d000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000001'
) as payload;
select is(
  (select payload -> 'rule_snapshot' from detail_after_settings_change),
  (select payload -> 'rule_snapshot' from coordinator_detail),
  'changing mutable group quota settings does not rewrite the round rule snapshot'
);
select is(
  (select payload -> 'participants' -> 0 ->> 'quota_snapshot' from detail_after_settings_change),
  '12.3',
  'changing mutable group settings does not rewrite participant quota snapshots'
);

insert into public.rounds (
  id, group_id, description, group_time_zone, format, state, version, created_by
)
values (
  '20000000-0000-4000-8000-000000000002',
  '1e000000-0000-4000-8000-000000000001',
  'Empty Draft', 'America/New_York', 'individual_gross', 'draft', 1,
  '1d000000-0000-4000-8000-000000000001'
);
create temporary table empty_detail as
select public.read_coordinator_round_detail(
  '1d000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000002'
) as payload;
select is(
  (select payload -> 'participants' from empty_detail),
  '[]'::jsonb,
  'zero-participant rounds return an empty participant array'
);
select is(
  (select payload -> 'rule_snapshot' from empty_detail),
  'null'::jsonb,
  'drafts without a published snapshot return a null rule snapshot'
);
select is(
  (select payload -> 'counts' from empty_detail),
  '{"guest_count": 0, "playing_count": 0, "no_response_count": 0, "not_playing_count": 0}'::jsonb,
  'zero-participant rounds return zero for every server-derived count'
);

select * from finish();
rollback;
