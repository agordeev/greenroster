begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

select has_table(
  'public',
  'scoreboard_access_grants',
  'scoreboard grants are persisted separately from round and member data'
);
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class
   where oid = 'public.scoreboard_access_grants'::regclass)
  and not has_table_privilege('anon', 'public.scoreboard_access_grants', 'select')
  and not has_table_privilege('authenticated', 'public.scoreboard_access_grants', 'select')
  and not has_table_privilege('service_role', 'public.scoreboard_access_grants', 'select'),
  'grant storage is force-RLS and has no direct table reads'
);
select has_function(
  'public',
  'create_scoreboard_access',
  array['uuid', 'uuid', 'uuid', 'text', 'integer', 'timestamptz', 'uuid', 'uuid'],
  'coordinator/admin issuance RPC exists'
);
select has_function(
  'public',
  'revoke_scoreboard_access',
  array['uuid', 'uuid', 'text', 'uuid', 'uuid'],
  'coordinator/admin revocation RPC exists'
);
select has_function(
  'public',
  'read_public_scoreboard',
  array['text'],
  'anonymous scoreboard read RPC exists'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.create_scoreboard_access(uuid,uuid,uuid,text,integer,timestamptz,uuid,uuid)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.revoke_scoreboard_access(uuid,uuid,text,uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.create_scoreboard_access(uuid,uuid,uuid,text,integer,timestamptz,uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.revoke_scoreboard_access(uuid,uuid,text,uuid,uuid)',
    'execute'
  ),
  'only the trusted server can issue or revoke a grant'
);
select ok(
  has_function_privilege('anon', 'public.read_public_scoreboard(text)', 'execute')
  and has_function_privilege('authenticated', 'public.read_public_scoreboard(text)', 'execute'),
  'anonymous and signed-in displays can read through the token RPC'
);
select ok(
  (select prosecdef and proconfig = array['search_path=""']
   from pg_catalog.pg_proc
   where oid = 'public.read_public_scoreboard(text)'::regprocedure),
  'public scoreboard reads pin a security-definer search path'
);
select ok(
  pg_catalog.pg_get_function_result(
    'public.read_public_scoreboard(text)'::regprocedure
  ) !~* 'token|quota|membership|role|email|phone|address',
  'public scoreboard result type excludes raw token, private contacts, roles, and quotas'
);

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at
)
values
  ('d1100000-0000-4000-8000-000000000001', 'scoreboard-admin-a@example.test', now(), false, false, now(), now()),
  ('d1100000-0000-4000-8000-000000000002', 'scoreboard-coordinator-a@example.test', now(), false, false, now(), now()),
  ('d1100000-0000-4000-8000-000000000003', 'scoreboard-member-a@example.test', now(), false, false, now(), now()),
  ('d1100000-0000-4000-8000-000000000004', 'scoreboard-admin-b@example.test', now(), false, false, now(), now());

insert into public.user_profiles (user_id, first_name, last_name)
values
  ('d1100000-0000-4000-8000-000000000001', 'Scoreboard', 'Admin'),
  ('d1100000-0000-4000-8000-000000000002', 'Scoreboard', 'Coordinator'),
  ('d1100000-0000-4000-8000-000000000003', 'Scoreboard', 'Member'),
  ('d1100000-0000-4000-8000-000000000004', 'Scoreboard', 'Other Group');

insert into public.groups (id, name, time_zone)
values
  ('d1200000-0000-4000-8000-000000000001', 'Scoreboard Group A', 'UTC'),
  ('d1200000-0000-4000-8000-000000000002', 'Scoreboard Group B', 'UTC');

insert into public.memberships (id, group_id, user_id, role, status, activated_at)
values
  ('d1300000-0000-4000-8000-000000000001', 'd1200000-0000-4000-8000-000000000001', 'd1100000-0000-4000-8000-000000000001', 'administrator', 'active', now()),
  ('d1300000-0000-4000-8000-000000000002', 'd1200000-0000-4000-8000-000000000001', 'd1100000-0000-4000-8000-000000000002', 'coordinator', 'active', now()),
  ('d1300000-0000-4000-8000-000000000003', 'd1200000-0000-4000-8000-000000000001', 'd1100000-0000-4000-8000-000000000003', 'member', 'active', now()),
  ('d1300000-0000-4000-8000-000000000004', 'd1200000-0000-4000-8000-000000000002', 'd1100000-0000-4000-8000-000000000004', 'administrator', 'active', now());

insert into public.rounds (
  id, group_id, description, scheduled_at, group_time_zone, format, state,
  published_at, created_by
)
values
  ('d1400000-0000-4000-8000-000000000001', 'd1200000-0000-4000-8000-000000000001', 'Scoreboard live round', now(), 'UTC', 'individual_gross', 'live', now(), 'd1100000-0000-4000-8000-000000000001'),
  ('d1400000-0000-4000-8000-000000000002', 'd1200000-0000-4000-8000-000000000002', 'Other tenant live round', now(), 'UTC', 'individual_gross', 'live', now(), 'd1100000-0000-4000-8000-000000000004');

insert into public.round_participants (
  id, round_id, group_id, membership_id, participant_kind, rsvp_status
)
values (
  'd1500000-0000-4000-8000-000000000001',
  'd1400000-0000-4000-8000-000000000001',
  'd1200000-0000-4000-8000-000000000001',
  'd1300000-0000-4000-8000-000000000003',
  'member',
  'playing'
);

insert into public.participant_score_projections (
  participant_id, group_id, round_id, golf_points, ranking_value, version
)
values (
  'd1500000-0000-4000-8000-000000000001',
  'd1200000-0000-4000-8000-000000000001',
  'd1400000-0000-4000-8000-000000000001',
  32,
  32,
  1
);

select throws_ok(
  $$ select * from public.create_scoreboard_access(
    'd1100000-0000-4000-8000-000000000003',
    'd1600000-0000-4000-8000-000000000001',
    'd1400000-0000-4000-8000-000000000001',
    repeat('a', 64), 1, now() + interval '1 hour',
    'd1700000-0000-4000-8000-000000000001',
    'd1800000-0000-4000-8000-000000000001'
  ) $$,
  'P0003',
  'actor_not_authorized',
  'a member cannot issue a public scoreboard link'
);
select throws_ok(
  $$ select * from public.create_scoreboard_access(
    'd1100000-0000-4000-8000-000000000004',
    'd1600000-0000-4000-8000-000000000002',
    'd1400000-0000-4000-8000-000000000001',
    repeat('b', 64), 1, now() + interval '1 hour',
    'd1700000-0000-4000-8000-000000000002',
    'd1800000-0000-4000-8000-000000000002'
  ) $$,
  'P0002',
  'scoreboard_round_unavailable',
  'a different group cannot issue a link for this round'
);

select is(
  (select access_id from public.create_scoreboard_access(
    'd1100000-0000-4000-8000-000000000002',
    'd1600000-0000-4000-8000-000000000003',
    'd1400000-0000-4000-8000-000000000001',
    encode(extensions.digest(convert_to(repeat('a', 43), 'UTF8'), 'sha256'), 'hex'),
    1, now() + interval '1 hour',
    'd1700000-0000-4000-8000-000000000003',
    'd1800000-0000-4000-8000-000000000003'
  )),
  'd1600000-0000-4000-8000-000000000003'::uuid,
  'a coordinator can issue a link in their own group'
);
select is(
  (select access_id from public.create_scoreboard_access(
    'd1100000-0000-4000-8000-000000000002',
    'd1600000-0000-4000-8000-000000000003',
    'd1400000-0000-4000-8000-000000000001',
    encode(extensions.digest(convert_to(repeat('a', 43), 'UTF8'), 'sha256'), 'hex'),
    1, now() + interval '1 hour',
    'd1700000-0000-4000-8000-000000000003',
    'd1800000-0000-4000-8000-000000000003'
  )),
  'd1600000-0000-4000-8000-000000000003'::uuid,
  'a create retry converges to the original grant'
);
select throws_ok(
  $$ select * from public.create_scoreboard_access(
    'd1100000-0000-4000-8000-000000000002',
    'd1600000-0000-4000-8000-000000000003',
    'd1400000-0000-4000-8000-000000000001',
    repeat('c', 64), 1, now() + interval '1 hour',
    'd1700000-0000-4000-8000-000000000003',
    'd1800000-0000-4000-8000-000000000003'
  ) $$,
  '40001',
  'operation_reused',
  'a create operation cannot be reused with a different token or expiry'
);

set local role anon;
select is(
  (select player_name from public.read_public_scoreboard(repeat('a', 43))),
  'Scoreboard Member',
  'anonymous readers receive the player display name'
);
select is(
  (select golf_points from public.read_public_scoreboard(repeat('a', 43))),
  32::numeric,
  'anonymous readers receive the current public score'
);
select is(
  (select count(*) from public.read_public_scoreboard('wrong-token')),
  0::bigint,
  'a guessed token does not reveal a scoreboard'
);
reset role;

select is(
  (select access_id from public.create_scoreboard_access(
    'd1100000-0000-4000-8000-000000000001',
    'd1600000-0000-4000-8000-000000000004',
    'd1400000-0000-4000-8000-000000000001',
    repeat('d', 64),
    1,
    now() + interval '1 hour',
    'd1700000-0000-4000-8000-000000000004',
    'd1800000-0000-4000-8000-000000000004'
  )),
  'd1600000-0000-4000-8000-000000000004'::uuid,
  'an administrator can issue a second grant for revocation-boundary coverage'
);
select throws_ok(
  $$ select * from public.revoke_scoreboard_access(
    'd1100000-0000-4000-8000-000000000004',
    'd1600000-0000-4000-8000-000000000004',
    'Cross-group attempt',
    'd1900000-0000-4000-8000-000000000002',
    'd1a00000-0000-4000-8000-000000000002'
  ) $$,
  'P0002',
  'scoreboard_access_not_found',
  'a different group cannot revoke this grant'
);

select is(
  (select state from public.revoke_scoreboard_access(
    'd1100000-0000-4000-8000-000000000002',
    'd1600000-0000-4000-8000-000000000003',
    'Link no longer needed',
    'd1900000-0000-4000-8000-000000000001',
    'd1a00000-0000-4000-8000-000000000001'
  )),
  'revoked'::public.scoreboard_access_state,
  'a coordinator can revoke the link'
);
set local role anon;
select is(
  (select count(*) from public.read_public_scoreboard(repeat('a', 43))),
  0::bigint,
  'revocation immediately removes anonymous read access'
);
reset role;
select is(
  (select state from public.revoke_scoreboard_access(
    'd1100000-0000-4000-8000-000000000002',
    'd1600000-0000-4000-8000-000000000003',
    'Link no longer needed',
    'd1900000-0000-4000-8000-000000000001',
    'd1a00000-0000-4000-8000-000000000001'
  )),
  'revoked'::public.scoreboard_access_state,
  'a revoke retry converges without a duplicate audit event'
);
select is(
  (select count(*) from public.audit_events
   where action = 'scoreboard_access.revoked'
     and operation_id = 'd1a00000-0000-4000-8000-000000000001'),
  1::bigint,
  'a revoke retry does not duplicate the audit event'
);

select * from finish();
rollback;
