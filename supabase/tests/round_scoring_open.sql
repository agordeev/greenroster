begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

select has_function(
  'public',
  'open_round_scoring',
  array['uuid', 'uuid', 'bigint', 'boolean', 'uuid', 'uuid'],
  'the Published-to-Live scoring transition exists'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.open_round_scoring(uuid,uuid,bigint,boolean,uuid,uuid)',
    'execute'
  ),
  'the trusted server can open scoring'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.open_round_scoring(uuid,uuid,bigint,boolean,uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.open_round_scoring(uuid,uuid,bigint,boolean,uuid,uuid)',
    'execute'
  ),
  'client roles cannot open scoring directly'
);
select ok(
  (select prosecdef
   from pg_catalog.pg_proc
   where oid = 'public.open_round_scoring(uuid,uuid,bigint,boolean,uuid,uuid)'::regprocedure),
  'the scoring transition is a security-definer boundary'
);

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at
)
values
  ('c1700000-0000-4000-8000-000000000001', 'scoring-admin-a@example.test', now(), false, false, now(), now()),
  ('c1700000-0000-4000-8000-000000000002', 'scoring-coordinator-a@example.test', now(), false, false, now(), now()),
  ('c1700000-0000-4000-8000-000000000003', 'scoring-member-a@example.test', now(), false, false, now(), now()),
  ('c1700000-0000-4000-8000-000000000004', 'scoring-admin-b@example.test', now(), false, false, now(), now()),
  ('c1700000-0000-4000-8000-000000000005', 'scoring-recovery-a@example.test', now(), false, false, now(), now());

update auth.users
set raw_app_meta_data = jsonb_build_object(
  'greenroster_password_recovery', jsonb_build_object('session_id', 'c2700000-0000-4000-8000-000000000001')
)
where id = 'c1700000-0000-4000-8000-000000000005';

insert into public.user_profiles (user_id, first_name, last_name)
values
  ('c1700000-0000-4000-8000-000000000001', 'Scoring', 'Admin A'),
  ('c1700000-0000-4000-8000-000000000002', 'Scoring', 'Coordinator A'),
  ('c1700000-0000-4000-8000-000000000003', 'Scoring', 'Member A'),
  ('c1700000-0000-4000-8000-000000000004', 'Scoring', 'Admin B'),
  ('c1700000-0000-4000-8000-000000000005', 'Scoring', 'Recovery A');

insert into public.groups (id, name, time_zone)
values
  ('c5700000-0000-4000-8000-000000000001', 'Scoring Group A', 'UTC'),
  ('c5700000-0000-4000-8000-000000000002', 'Scoring Group B', 'UTC');

insert into public.memberships (id, group_id, user_id, role, status, activated_at)
values
  ('c6700000-0000-4000-8000-000000000001', 'c5700000-0000-4000-8000-000000000001', 'c1700000-0000-4000-8000-000000000001', 'administrator', 'active', now()),
  ('c6700000-0000-4000-8000-000000000002', 'c5700000-0000-4000-8000-000000000001', 'c1700000-0000-4000-8000-000000000002', 'coordinator', 'active', now()),
  ('c6700000-0000-4000-8000-000000000003', 'c5700000-0000-4000-8000-000000000001', 'c1700000-0000-4000-8000-000000000003', 'member', 'active', now()),
  ('c6700000-0000-4000-8000-000000000004', 'c5700000-0000-4000-8000-000000000002', 'c1700000-0000-4000-8000-000000000004', 'administrator', 'active', now()),
  ('c6700000-0000-4000-8000-000000000005', 'c5700000-0000-4000-8000-000000000001', 'c1700000-0000-4000-8000-000000000005', 'administrator', 'active', now());

insert into public.rounds (
  id, group_id, description, scheduled_at, group_time_zone, format, state,
  version, published_at, cancelled_at, cancellation_reason, created_by
)
values
  ('c8700000-0000-4000-8000-000000000001', 'c5700000-0000-4000-8000-000000000001', 'Published open', now() + interval '1 day', 'UTC', 'individual_gross', 'published', 1, now(), null, null, 'c1700000-0000-4000-8000-000000000001'),
  ('c8700000-0000-4000-8000-000000000002', 'c5700000-0000-4000-8000-000000000001', 'Draft blocked', now() + interval '2 days', 'UTC', 'individual_gross', 'draft', 1, null, null, null, 'c1700000-0000-4000-8000-000000000001'),
  ('c8700000-0000-4000-8000-000000000003', 'c5700000-0000-4000-8000-000000000001', 'Live blocked', now() - interval '1 hour', 'UTC', 'individual_gross', 'live', 1, now() - interval '1 day', null, null, 'c1700000-0000-4000-8000-000000000001'),
  ('c8700000-0000-4000-8000-000000000004', 'c5700000-0000-4000-8000-000000000002', 'Cross tenant', now() + interval '1 day', 'UTC', 'individual_gross', 'published', 1, now(), null, null, 'c1700000-0000-4000-8000-000000000004'),
  ('c8700000-0000-4000-8000-000000000005', 'c5700000-0000-4000-8000-000000000001', 'Cancelled blocked', now() + interval '1 day', 'UTC', 'individual_gross', 'cancelled', 1, now() - interval '1 day', now() - interval '1 hour', 'already cancelled', 'c1700000-0000-4000-8000-000000000001'),
  ('c8700000-0000-4000-8000-000000000006', 'c5700000-0000-4000-8000-000000000001', 'Stale published', now() + interval '3 days', 'UTC', 'individual_gross', 'published', 2, now(), null, null, 'c1700000-0000-4000-8000-000000000001');

select is(
  (select state from public.open_round_scoring(
    'c1700000-0000-4000-8000-000000000002',
    'c8700000-0000-4000-8000-000000000001',
    1, true,
    'c2700000-0000-4000-8000-000000000001',
    'c3700000-0000-4000-8000-000000000001'
  )),
  'live'::public.round_state,
  'a coordinator opens a Published round'
);
select is(
  (select version from public.rounds where id = 'c8700000-0000-4000-8000-000000000001'),
  2::bigint,
  'opening scoring increments the round version'
);
select is(
  (select count(*) from public.audit_events
   where action = 'round.scoring_opened'
     and target_id = 'c8700000-0000-4000-8000-000000000001'),
  1::bigint,
  'opening scoring writes one audit event'
);
select ok(
  (select after_state ? 'opened_at'
   from public.audit_events
   where action = 'round.scoring_opened'
     and target_id = 'c8700000-0000-4000-8000-000000000001'),
  'the audit records the server opening instant'
);

select is(
  (select version from public.open_round_scoring(
    'c1700000-0000-4000-8000-000000000002',
    'c8700000-0000-4000-8000-000000000001',
    1, true,
    'c2700000-0000-4000-8000-000000000099',
    'c3700000-0000-4000-8000-000000000001'
  )),
  2::bigint,
  'an exact retry returns the original Live version'
);
select is(
  (select count(*) from public.audit_events
   where action = 'round.scoring_opened'
     and target_id = 'c8700000-0000-4000-8000-000000000001'),
  1::bigint,
  'an exact retry does not duplicate the audit event'
);

select throws_ok(
  $$ select * from public.open_round_scoring(
    'c1700000-0000-4000-8000-000000000002',
    'c8700000-0000-4000-8000-000000000001',
    2, true,
    'c2700000-0000-4000-8000-000000000099',
    'c3700000-0000-4000-8000-000000000001'
  ) $$,
  '23505', 'operation_id_reused',
  'an operation id cannot be reused with different transition input'
);

select throws_ok(
  $$ select * from public.open_round_scoring(
    'c1700000-0000-4000-8000-000000000001',
    'c8700000-0000-4000-8000-000000000002',
    1, true,
    'c2700000-0000-4000-8000-000000000002',
    'c3700000-0000-4000-8000-000000000002'
  ) $$,
  'P0001', 'round_state_locked',
  'Draft rounds cannot open scoring'
);
select throws_ok(
  $$ select * from public.open_round_scoring(
    'c1700000-0000-4000-8000-000000000001',
    'c8700000-0000-4000-8000-000000000003',
    1, true,
    'c2700000-0000-4000-8000-000000000003',
    'c3700000-0000-4000-8000-000000000003'
  ) $$,
  'P0001', 'round_state_locked',
  'Live rounds cannot be opened twice'
);
select throws_ok(
  $$ select * from public.open_round_scoring(
    'c1700000-0000-4000-8000-000000000001',
    'c8700000-0000-4000-8000-000000000005',
    1, true,
    'c2700000-0000-4000-8000-000000000004',
    'c3700000-0000-4000-8000-000000000004'
  ) $$,
  'P0001', 'round_state_locked',
  'Cancelled rounds cannot open scoring'
);
select throws_ok(
  $$ select * from public.open_round_scoring(
    'c1700000-0000-4000-8000-000000000001',
    'c8700000-0000-4000-8000-000000000004',
    1, true,
    'c2700000-0000-4000-8000-000000000005',
    'c3700000-0000-4000-8000-000000000005'
  ) $$,
  'P0002', 'round_not_found',
  'cross-group rounds are indistinguishable from missing rounds'
);
select is(
  (select state from public.open_round_scoring(
    'c1700000-0000-4000-8000-000000000004',
    'c8700000-0000-4000-8000-000000000004',
    1, true,
    'c2700000-0000-4000-8000-000000000010',
    'c3700000-0000-4000-8000-000000000010'
  )),
  'live'::public.round_state,
  'an administrator can open a Published round in their own group'
);
select throws_ok(
  $$ select * from public.open_round_scoring(
    'c1700000-0000-4000-8000-000000000003',
    'c8700000-0000-4000-8000-000000000004',
    1, true,
    'c2700000-0000-4000-8000-000000000006',
    'c3700000-0000-4000-8000-000000000006'
  ) $$,
  'P0003', 'actor_not_authorized',
  'members cannot open scoring'
);
select throws_ok(
  $$ select * from public.open_round_scoring(
    'c1700000-0000-4000-8000-000000000002',
    'c8700000-0000-4000-8000-000000000006',
    1, true,
    'c2700000-0000-4000-8000-000000000007',
    'c3700000-0000-4000-8000-000000000007'
  ) $$,
  '40001', 'round_version_changed',
  'a stale Published round version is rejected'
);
select throws_ok(
  $$ select * from public.open_round_scoring(
    'c1700000-0000-4000-8000-000000000002',
    'c8700000-0000-4000-8000-000000000002',
    1, false,
    'c2700000-0000-4000-8000-000000000008',
    'c3700000-0000-4000-8000-000000000008'
  ) $$,
  '22023', 'scoring_open_confirmation_required',
  'opening scoring requires explicit confirmation'
);
select throws_ok(
  $$ select * from public.open_round_scoring(
    'c1700000-0000-4000-8000-000000000005',
    'c8700000-0000-4000-8000-000000000002',
    1, true,
    'c2700000-0000-4000-8000-000000000009',
    'c3700000-0000-4000-8000-000000000009'
  ) $$,
  'P0003', 'recovery_session_forbidden',
  'recovery identities cannot open scoring'
);

select * from finish();
rollback;
