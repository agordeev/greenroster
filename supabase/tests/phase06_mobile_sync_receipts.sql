begin;

create extension if not exists pgtap with schema extensions;

select plan(21);

select has_table('public', 'round_score_sync_receipts', 'mobile sync receipt table exists');
select has_function(
  'public',
  'acknowledge_mobile_round_score_sync',
  array['uuid', 'uuid', 'uuid', 'uuid'],
  'authenticated mobile sync acknowledgement exists'
);
select has_function(
  'app',
  'round_mobile_sync_readiness',
  array['app.entity_id', 'app.entity_id'],
  'private mobile sync readiness helper exists'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.acknowledge_mobile_round_score_sync(uuid,uuid,uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.acknowledge_mobile_round_score_sync(uuid,uuid,uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.acknowledge_mobile_round_score_sync(uuid,uuid,uuid,uuid)',
    'execute'
  ),
  'only authenticated actors can submit actor-derived mobile receipts'
);
select ok(
  has_function_privilege(
    'service_role',
    'app.round_mobile_sync_readiness(app.entity_id,app.entity_id)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'app.round_mobile_sync_readiness(app.entity_id,app.entity_id)',
    'execute'
  ),
  'only the trusted server can read mobile sync readiness'
);
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class
   where oid = 'public.round_score_sync_receipts'::regclass)
  and not has_table_privilege('authenticated', 'public.round_score_sync_receipts', 'select')
  and not has_table_privilege('service_role', 'public.round_score_sync_receipts', 'select'),
  'receipt storage is force-RLS with no direct table reads'
);
select ok(
  (select prosecdef and proconfig = array['search_path=""']
   from pg_catalog.pg_proc
   where oid = 'public.acknowledge_mobile_round_score_sync(uuid,uuid,uuid,uuid)'::regprocedure)
  and (select prosecdef and provolatile = 's' and proconfig = array['search_path=""']
       from pg_catalog.pg_proc
       where oid = 'app.round_mobile_sync_readiness(app.entity_id,app.entity_id)'::regprocedure),
  'receipt boundaries pin security-definer search paths and helper volatility'
);

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at
)
values
  ('9a000000-0000-4000-8000-000000000001', 'sync-admin-a@example.test', now(), false, false, now(), now()),
  ('9a000000-0000-4000-8000-000000000002', 'sync-member-a@example.test', now(), false, false, now(), now()),
  ('9a000000-0000-4000-8000-000000000003', 'sync-sponsor-a@example.test', now(), false, false, now(), now()),
  ('9a000000-0000-4000-8000-000000000004', 'sync-outsider@example.test', now(), false, false, now(), now());

insert into public.user_profiles (user_id, first_name, last_name)
values
  ('9a000000-0000-4000-8000-000000000001', 'Sync', 'Admin'),
  ('9a000000-0000-4000-8000-000000000002', 'Sync', 'Member'),
  ('9a000000-0000-4000-8000-000000000003', 'Sync', 'Sponsor'),
  ('9a000000-0000-4000-8000-000000000004', 'Sync', 'Outsider');

insert into public.groups (id, name, time_zone)
values
  ('9b000000-0000-4000-8000-000000000001', 'Sync Group A', 'UTC'),
  ('9b000000-0000-4000-8000-000000000002', 'Sync Group B', 'UTC');

insert into public.memberships (id, group_id, user_id, role, status, activated_at)
values
  ('9c000000-0000-4000-8000-000000000001', '9b000000-0000-4000-8000-000000000001', '9a000000-0000-4000-8000-000000000001', 'administrator', 'active', now()),
  ('9c000000-0000-4000-8000-000000000002', '9b000000-0000-4000-8000-000000000001', '9a000000-0000-4000-8000-000000000002', 'member', 'active', now()),
  ('9c000000-0000-4000-8000-000000000003', '9b000000-0000-4000-8000-000000000001', '9a000000-0000-4000-8000-000000000003', 'member', 'active', now()),
  ('9c000000-0000-4000-8000-000000000004', '9b000000-0000-4000-8000-000000000001', null, 'member', 'pending', null),
  ('9c000000-0000-4000-8000-000000000005', '9b000000-0000-4000-8000-000000000002', '9a000000-0000-4000-8000-000000000004', 'administrator', 'active', now());

insert into public.rounds (
  id, group_id, description, scheduled_at, group_time_zone, format, state,
  published_at, created_by
)
values
  ('9d000000-0000-4000-8000-000000000001', '9b000000-0000-4000-8000-000000000001', 'Live sync round', now(), 'UTC', 'individual_gross', 'live', now(), '9a000000-0000-4000-8000-000000000001'),
  ('9d000000-0000-4000-8000-000000000002', '9b000000-0000-4000-8000-000000000001', 'Completed sync round', now(), 'UTC', 'individual_gross', 'completed', now(), '9a000000-0000-4000-8000-000000000001'),
  ('9d000000-0000-4000-8000-000000000003', '9b000000-0000-4000-8000-000000000002', 'Other tenant round', now(), 'UTC', 'individual_gross', 'live', now(), '9a000000-0000-4000-8000-000000000004');

insert into public.round_participants (
  id, round_id, group_id, membership_id, participant_kind, rsvp_status
)
values
  ('9e000000-0000-4000-8000-000000000001', '9d000000-0000-4000-8000-000000000001', '9b000000-0000-4000-8000-000000000001', '9c000000-0000-4000-8000-000000000002', 'member', 'playing'),
  ('9e000000-0000-4000-8000-000000000003', '9d000000-0000-4000-8000-000000000001', '9b000000-0000-4000-8000-000000000001', '9c000000-0000-4000-8000-000000000004', 'member', 'playing'),
  ('9e000000-0000-4000-8000-000000000004', '9d000000-0000-4000-8000-000000000002', '9b000000-0000-4000-8000-000000000001', '9c000000-0000-4000-8000-000000000002', 'member', 'playing'),
  ('9e000000-0000-4000-8000-000000000005', '9d000000-0000-4000-8000-000000000003', '9b000000-0000-4000-8000-000000000002', '9c000000-0000-4000-8000-000000000005', 'member', 'playing');

insert into public.round_participants (
  id, round_id, group_id, participant_kind, sponsor_membership_id,
  guest_first_name, guest_last_name, rsvp_status
)
values (
  '9e000000-0000-4000-8000-000000000002', '9d000000-0000-4000-8000-000000000001', '9b000000-0000-4000-8000-000000000001', 'guest', '9c000000-0000-4000-8000-000000000003', 'Sync', 'Guest', 'playing'
);

insert into public.score_revisions (
  id, group_id, round_id, participant_id, revision_number, base_version,
  device_operation_id, actor_user_id, source, client_changed_at, correlation_id,
  operation_id, changed_fields, golf_points, ranking_value, request_fingerprint
)
values
  ('9f000000-0000-4000-8000-000000000001', '9b000000-0000-4000-8000-000000000001', '9d000000-0000-4000-8000-000000000001', '9e000000-0000-4000-8000-000000000001', 1, 0, 'a0000000-0000-4000-8000-000000000001', '9a000000-0000-4000-8000-000000000002', 'mobile', now(), 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', '{"golf_points": true}', 30, 30, repeat('1', 64)),
  ('9f000000-0000-4000-8000-000000000002', '9b000000-0000-4000-8000-000000000001', '9d000000-0000-4000-8000-000000000001', '9e000000-0000-4000-8000-000000000002', 1, 0, 'a0000000-0000-4000-8000-000000000002', '9a000000-0000-4000-8000-000000000003', 'mobile', now(), 'a1000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000002', '{"golf_points": true}', 25, 25, repeat('2', 64)),
  ('9f000000-0000-4000-8000-000000000003', '9b000000-0000-4000-8000-000000000001', '9d000000-0000-4000-8000-000000000001', '9e000000-0000-4000-8000-000000000003', 1, 0, 'a0000000-0000-4000-8000-000000000003', '9a000000-0000-4000-8000-000000000001', 'portal', now(), 'a1000000-0000-4000-8000-000000000003', 'a2000000-0000-4000-8000-000000000003', '{"golf_points": true}', 20, 20, repeat('3', 64)),
  ('9f000000-0000-4000-8000-000000000004', '9b000000-0000-4000-8000-000000000001', '9d000000-0000-4000-8000-000000000002', '9e000000-0000-4000-8000-000000000004', 1, 0, 'a0000000-0000-4000-8000-000000000004', '9a000000-0000-4000-8000-000000000002', 'mobile', now(), 'a1000000-0000-4000-8000-000000000004', 'a2000000-0000-4000-8000-000000000004', '{"golf_points": true}', 20, 20, repeat('4', 64)),
  ('9f000000-0000-4000-8000-000000000005', '9b000000-0000-4000-8000-000000000002', '9d000000-0000-4000-8000-000000000003', '9e000000-0000-4000-8000-000000000005', 1, 0, 'a0000000-0000-4000-8000-000000000005', '9a000000-0000-4000-8000-000000000004', 'mobile', now(), 'a1000000-0000-4000-8000-000000000005', 'a2000000-0000-4000-8000-000000000005', '{"golf_points": true}', 20, 20, repeat('5', 64));

insert into public.participant_score_projections (
  participant_id, group_id, round_id, golf_points, ranking_value, version, last_revision_id
)
values
  ('9e000000-0000-4000-8000-000000000001', '9b000000-0000-4000-8000-000000000001', '9d000000-0000-4000-8000-000000000001', 30, 30, 1, '9f000000-0000-4000-8000-000000000001'),
  ('9e000000-0000-4000-8000-000000000002', '9b000000-0000-4000-8000-000000000001', '9d000000-0000-4000-8000-000000000001', 25, 25, 1, '9f000000-0000-4000-8000-000000000002'),
  ('9e000000-0000-4000-8000-000000000003', '9b000000-0000-4000-8000-000000000001', '9d000000-0000-4000-8000-000000000001', 20, 20, 1, '9f000000-0000-4000-8000-000000000003'),
  ('9e000000-0000-4000-8000-000000000004', '9b000000-0000-4000-8000-000000000001', '9d000000-0000-4000-8000-000000000002', 20, 20, 1, '9f000000-0000-4000-8000-000000000004'),
  ('9e000000-0000-4000-8000-000000000005', '9b000000-0000-4000-8000-000000000002', '9d000000-0000-4000-8000-000000000003', 20, 20, 1, '9f000000-0000-4000-8000-000000000005');

set local role authenticated;
select set_config('request.jwt.claim.sub', '9a000000-0000-4000-8000-000000000002', true);
select is(
  (select score_revision_id from public.acknowledge_mobile_round_score_sync(
    '9e000000-0000-4000-8000-000000000001',
    '9f000000-0000-4000-8000-000000000001',
    'a3000000-0000-4000-8000-000000000001',
    'a4000000-0000-4000-8000-000000000001'
  )),
  '9f000000-0000-4000-8000-000000000001'::app.entity_id,
  'a member can acknowledge their current mobile score'
);
select is(
  (select receipt_version from public.acknowledge_mobile_round_score_sync(
    '9e000000-0000-4000-8000-000000000001',
    '9f000000-0000-4000-8000-000000000001',
    'a3000000-0000-4000-8000-000000000001',
    'a4000000-0000-4000-8000-000000000001'
  )),
  1::bigint,
  'replaying the same operation is idempotent'
);
reset role;
select is(
  (select count(*) from public.audit_events
   where action = 'round.score_sync_acknowledged'
     and operation_id = 'a4000000-0000-4000-8000-000000000001'),
  1::bigint,
  'idempotent replay does not duplicate the audit event'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '9a000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$ select * from public.acknowledge_mobile_round_score_sync(
    '9e000000-0000-4000-8000-000000000001',
    '9f000000-0000-4000-8000-000000000099',
    'a3000000-0000-4000-8000-000000000099',
    'a4000000-0000-4000-8000-000000000099'
  ) $$,
  '40001',
  'score_revision_changed',
  'a stale mobile revision cannot be acknowledged'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '9a000000-0000-4000-8000-000000000003', true);
select is(
  (select participant_id from public.acknowledge_mobile_round_score_sync(
    '9e000000-0000-4000-8000-000000000002',
    '9f000000-0000-4000-8000-000000000002',
    'a3000000-0000-4000-8000-000000000002',
    'a4000000-0000-4000-8000-000000000002'
  )),
  '9e000000-0000-4000-8000-000000000002'::app.entity_id,
  'a sponsoring member can acknowledge their guest score'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '9a000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$ select * from public.acknowledge_mobile_round_score_sync(
    '9e000000-0000-4000-8000-000000000002',
    '9f000000-0000-4000-8000-000000000002',
    'a3000000-0000-4000-8000-000000000003',
    'a4000000-0000-4000-8000-000000000003'
  ) $$,
  'P0003',
  'score_actor_not_authorized',
  'a different member cannot acknowledge another member guest score'
);
select set_config('request.jwt.claim.sub', '9a000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$ select * from public.acknowledge_mobile_round_score_sync(
    '9e000000-0000-4000-8000-000000000003',
    '9f000000-0000-4000-8000-000000000003',
    'a3000000-0000-4000-8000-000000000004',
    'a4000000-0000-4000-8000-000000000004'
  ) $$,
  '22023',
  'mobile_sync_source_invalid',
  'portal revisions do not need a mobile receipt'
);
reset role;

select ok(exists (
  select 1
  from app.round_mobile_sync_readiness(
    '9d000000-0000-4000-8000-000000000001',
    '9b000000-0000-4000-8000-000000000001'
  )
  where participant_id = '9e000000-0000-4000-8000-000000000001'
    and sync_status = 'mobile_confirmed'
), 'the helper recognizes an acknowledged mobile revision');
select ok(exists (
  select 1
  from app.round_mobile_sync_readiness(
    '9d000000-0000-4000-8000-000000000001',
    '9b000000-0000-4000-8000-000000000001'
  )
  where participant_id = '9e000000-0000-4000-8000-000000000002'
    and sync_status = 'mobile_confirmed'
), 'guest receipt is included in sync readiness');
select ok(exists (
  select 1
  from app.round_mobile_sync_readiness(
    '9d000000-0000-4000-8000-000000000001',
    '9b000000-0000-4000-8000-000000000001'
  )
  where participant_id = '9e000000-0000-4000-8000-000000000003'
    and sync_status = 'server_confirmed'
), 'portal revisions are server-confirmed without a mobile receipt');
select is(
  (select sync_status from app.round_mobile_sync_readiness(
    '9d000000-0000-4000-8000-000000000002',
    '9b000000-0000-4000-8000-000000000001'
  ) where participant_id = '9e000000-0000-4000-8000-000000000004'),
  'mobile_receipt_missing',
  'a current mobile revision without a receipt remains a completion blocker'
);
select throws_ok(
  $$ select * from app.round_mobile_sync_readiness(
    '9d000000-0000-4000-8000-000000000001',
    '9b000000-0000-4000-8000-000000000002'
  ) $$,
  'P0002',
  'round_not_found',
  'cross-tenant helper keys reveal no sync state'
);
select throws_ok(
  $$ select * from app.round_mobile_sync_readiness(null, '9b000000-0000-4000-8000-000000000001') $$,
  '22004',
  'round_completion_context_required',
  'sync helper requires explicit round and group keys'
);

set local role service_role;
select is(
  (select count(*) from app.round_mobile_sync_readiness(
    '9d000000-0000-4000-8000-000000000001',
    '9b000000-0000-4000-8000-000000000001'
  )),
  3::bigint,
  'trusted service role can read tenant-scoped sync readiness'
);
reset role;

select * from finish();

rollback;
