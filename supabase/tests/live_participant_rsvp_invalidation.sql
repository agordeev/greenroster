begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

select has_function(
  'public',
  'set_live_round_participant_not_playing',
  array['uuid','uuid','uuid','bigint','bigint','uuid','boolean','text','text','uuid','uuid'],
  'Live scored participant RSVP invalidation RPC exists'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.set_live_round_participant_not_playing(uuid,uuid,uuid,bigint,bigint,uuid,boolean,text,text,uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.set_live_round_participant_not_playing(uuid,uuid,uuid,bigint,bigint,uuid,boolean,text,text,uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.set_live_round_participant_not_playing(uuid,uuid,uuid,bigint,bigint,uuid,boolean,text,text,uuid,uuid)',
    'execute'
  ),
  'only the trusted server can call Live RSVP invalidation'
);
select ok(
  (select prosecdef
   from pg_catalog.pg_proc
   where oid = 'public.set_live_round_participant_not_playing(uuid,uuid,uuid,bigint,bigint,uuid,boolean,text,text,uuid,uuid)'::regprocedure),
  'Live RSVP invalidation is security definer'
);
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class
   where oid = 'public.round_participants'::regclass)
  and (select relrowsecurity and relforcerowsecurity
       from pg_catalog.pg_class
       where oid = 'public.participant_score_projections'::regclass)
  and (select relrowsecurity and relforcerowsecurity
       from pg_catalog.pg_class
       where oid = 'public.score_revisions'::regclass),
  'participant and score state remain force-RLS protected'
);
select ok(
  not has_table_privilege('authenticated', 'public.participant_score_projections', 'insert')
  and not has_table_privilege('authenticated', 'public.participant_score_projections', 'update')
  and not has_table_privilege('authenticated', 'public.participant_score_projections', 'delete')
  and not has_table_privilege('authenticated', 'public.score_revisions', 'select')
  and not has_table_privilege('authenticated', 'public.score_revisions', 'insert')
  and not has_table_privilege('authenticated', 'public.score_revisions', 'update')
  and not has_table_privilege('authenticated', 'public.score_revisions', 'delete'),
  'clients cannot bypass the atomic mutation through score tables'
);

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, banned_until,
  created_at, updated_at
)
values
  ('9a000000-0000-4000-8000-000000000001', 'rsvp-invalidation-admin@example.test', now(), false, false, null, now(), now()),
  ('9a000000-0000-4000-8000-000000000002', 'rsvp-invalidation-coordinator@example.test', now(), false, false, null, now(), now()),
  ('9a000000-0000-4000-8000-000000000003', 'rsvp-invalidation-member@example.test', now(), false, false, null, now(), now()),
  ('9a000000-0000-4000-8000-000000000004', 'rsvp-invalidation-recovery@example.test', now(), false, false, null, now(), now()),
  ('9a000000-0000-4000-8000-000000000005', 'rsvp-invalidation-banned@example.test', now(), false, false, now() + interval '1 day', now(), now()),
  ('9a000000-0000-4000-8000-000000000006', 'rsvp-invalidation-inactive@example.test', now(), false, false, null, now(), now()),
  ('9a000000-0000-4000-8000-000000000007', 'rsvp-invalidation-cross-tenant@example.test', now(), false, false, null, now(), now()),
  ('9a000000-0000-4000-8000-000000000008', 'rsvp-invalidation-cross-member@example.test', now(), false, false, null, now(), now());

update auth.users
set raw_app_meta_data = '{"greenroster_password_recovery":true}'::jsonb
where id = '9a000000-0000-4000-8000-000000000004';

insert into public.user_profiles (user_id, first_name, last_name)
values
  ('9a000000-0000-4000-8000-000000000001', 'RSVP', 'Admin'),
  ('9a000000-0000-4000-8000-000000000002', 'RSVP', 'Coordinator'),
  ('9a000000-0000-4000-8000-000000000003', 'RSVP', 'Member'),
  ('9a000000-0000-4000-8000-000000000004', 'RSVP', 'Recovery'),
  ('9a000000-0000-4000-8000-000000000005', 'RSVP', 'Banned'),
  ('9a000000-0000-4000-8000-000000000006', 'RSVP', 'Inactive'),
  ('9a000000-0000-4000-8000-000000000007', 'RSVP', 'Cross Tenant'),
  ('9a000000-0000-4000-8000-000000000008', 'RSVP', 'Cross Member');

insert into public.groups (id, name, time_zone)
values
  ('9b000000-0000-4000-8000-000000000001', 'RSVP Invalidation Group A', 'America/New_York'),
  ('9b000000-0000-4000-8000-000000000002', 'RSVP Invalidation Group B', 'UTC');

insert into public.memberships (
  id, group_id, user_id, role, status, activated_at, inactivated_at
)
values
  ('9c000000-0000-4000-8000-000000000001', '9b000000-0000-4000-8000-000000000001', '9a000000-0000-4000-8000-000000000001', 'administrator', 'active', now(), null),
  ('9c000000-0000-4000-8000-000000000002', '9b000000-0000-4000-8000-000000000001', '9a000000-0000-4000-8000-000000000002', 'coordinator', 'active', now(), null),
  ('9c000000-0000-4000-8000-000000000003', '9b000000-0000-4000-8000-000000000001', '9a000000-0000-4000-8000-000000000003', 'member', 'active', now(), null),
  ('9c000000-0000-4000-8000-000000000004', '9b000000-0000-4000-8000-000000000001', '9a000000-0000-4000-8000-000000000004', 'coordinator', 'active', now(), null),
  ('9c000000-0000-4000-8000-000000000005', '9b000000-0000-4000-8000-000000000001', '9a000000-0000-4000-8000-000000000005', 'coordinator', 'active', now(), null),
  ('9c000000-0000-4000-8000-000000000006', '9b000000-0000-4000-8000-000000000001', '9a000000-0000-4000-8000-000000000006', 'coordinator', 'inactive', null, now()),
  ('9c000000-0000-4000-8000-000000000007', '9b000000-0000-4000-8000-000000000002', '9a000000-0000-4000-8000-000000000007', 'coordinator', 'active', now(), null),
  ('9c000000-0000-4000-8000-000000000008', '9b000000-0000-4000-8000-000000000002', '9a000000-0000-4000-8000-000000000008', 'member', 'active', now(), null);

insert into public.rounds (
  id, group_id, description, scheduled_at, group_time_zone, format, state,
  enable_gross_score, enable_net_score, version, published_at, created_by
)
values
  ('9d000000-0000-4000-8000-000000000001', '9b000000-0000-4000-8000-000000000001', 'Live RSVP invalidation', now(), 'America/New_York', 'individual_net', 'live', true, true, 1, now(), '9a000000-0000-4000-8000-000000000001'),
  ('9d000000-0000-4000-8000-000000000002', '9b000000-0000-4000-8000-000000000002', 'Cross tenant live round', now(), 'UTC', 'individual_net', 'live', true, true, 1, now(), '9a000000-0000-4000-8000-000000000007');

insert into public.round_rule_snapshots (round_id, group_id, format, settings_version)
values
  ('9d000000-0000-4000-8000-000000000001', '9b000000-0000-4000-8000-000000000001', 'individual_net', 0),
  ('9d000000-0000-4000-8000-000000000002', '9b000000-0000-4000-8000-000000000002', 'individual_net', 0);

insert into public.round_participants (
  id, round_id, group_id, membership_id, rsvp_status, quota_snapshot
)
values
  ('9e000000-0000-4000-8000-000000000001', '9d000000-0000-4000-8000-000000000001', '9b000000-0000-4000-8000-000000000001', '9c000000-0000-4000-8000-000000000003', 'playing', 10.00),
  ('9e000000-0000-4000-8000-000000000002', '9d000000-0000-4000-8000-000000000001', '9b000000-0000-4000-8000-000000000001', '9c000000-0000-4000-8000-000000000002', 'playing', 11.00),
  ('9e000000-0000-4000-8000-000000000003', '9d000000-0000-4000-8000-000000000001', '9b000000-0000-4000-8000-000000000001', '9c000000-0000-4000-8000-000000000001', 'not_playing', 12.00),
  ('9e000000-0000-4000-8000-000000000004', '9d000000-0000-4000-8000-000000000001', '9b000000-0000-4000-8000-000000000001', '9c000000-0000-4000-8000-000000000005', 'playing', 13.00),
  ('9e000000-0000-4000-8000-000000000005', '9d000000-0000-4000-8000-000000000001', '9b000000-0000-4000-8000-000000000001', '9c000000-0000-4000-8000-000000000004', 'playing', 14.00),
  ('9e000000-0000-4000-8000-000000000006', '9d000000-0000-4000-8000-000000000002', '9b000000-0000-4000-8000-000000000002', '9c000000-0000-4000-8000-000000000008', 'playing', 9.00);

-- Seed current projections through the existing server-authoritative score
-- boundary so this test exercises the real append-only revision contract.
select * from public.set_round_participant_score(
  '9a000000-0000-4000-8000-000000000001',
  '9e000000-0000-4000-8000-000000000001',
  '{"golf_points":20.00}'::jsonb,
  0,
  '9f000000-0000-4000-8000-000000000001',
  'portal',
  null,
  now(),
  '9f000000-0000-4000-8000-000000000011',
  '9f000000-0000-4000-8000-000000000021'
);
select * from public.set_round_participant_score(
  '9a000000-0000-4000-8000-000000000001',
  '9e000000-0000-4000-8000-000000000002',
  '{"golf_points":18.00}'::jsonb,
  0,
  '9f000000-0000-4000-8000-000000000002',
  'portal',
  null,
  now(),
  '9f000000-0000-4000-8000-000000000012',
  '9f000000-0000-4000-8000-000000000022'
);
select * from public.set_round_participant_score(
  '9a000000-0000-4000-8000-000000000001',
  '9e000000-0000-4000-8000-000000000004',
  '{"golf_points":17.00}'::jsonb,
  0,
  '9f000000-0000-4000-8000-000000000004',
  'portal',
  null,
  now(),
  '9f000000-0000-4000-8000-000000000014',
  '9f000000-0000-4000-8000-000000000024'
);
select * from public.set_round_participant_score(
  '9a000000-0000-4000-8000-000000000007',
  '9e000000-0000-4000-8000-000000000006',
  '{"golf_points":16.00}'::jsonb,
  0,
  '9f000000-0000-4000-8000-000000000006',
  'portal',
  null,
  now(),
  '9f000000-0000-4000-8000-000000000016',
  '9f000000-0000-4000-8000-000000000026'
);

create function pg_temp.capture_score_stale_detail()
returns table (sqlstate text, message text, detail text)
language plpgsql
set search_path = ''
as $$
declare
  captured_state text;
  captured_message text;
  captured_detail text;
begin
  begin
    perform *
    from public.set_live_round_participant_not_playing(
      '9a000000-0000-4000-8000-000000000001',
      '9d000000-0000-4000-8000-000000000001',
      '9e000000-0000-4000-8000-000000000002',
      1,
      1,
      (select revision.id
       from public.score_revisions as revision
       where revision.participant_id = '9e000000-0000-4000-8000-000000000002'
         and revision.revision_number = 1),
      true,
      'Concurrent score stale correction',
      'portal',
      '9f000000-0000-4000-8000-000000000117',
      '9f000000-0000-4000-8000-000000000217'
    );
  exception when others then
    get stacked diagnostics
      captured_state = returned_sqlstate,
      captured_message = message_text,
      captured_detail = pg_exception_detail;
  end;
  return query select captured_state, captured_message, captured_detail;
end;
$$;

select throws_ok(
  $$ select * from public.set_live_round_participant_not_playing(
    '9a000000-0000-4000-8000-000000000002',
    '9d000000-0000-4000-8000-000000000001',
    '9e000000-0000-4000-8000-000000000001',
    1, 1, (select last_revision_id from public.participant_score_projections where participant_id = '9e000000-0000-4000-8000-000000000001'), false, 'Member left after score', 'portal',
    '9f000000-0000-4000-8000-000000000101',
    '9f000000-0000-4000-8000-000000000201'
  ) $$,
  '22023', 'rsvp_change_confirmation_required',
  'the coordinator must explicitly confirm score invalidation'
);
select throws_ok(
  $$ select * from public.set_live_round_participant_not_playing(
    '9a000000-0000-4000-8000-000000000002',
    '9d000000-0000-4000-8000-000000000001',
    '9e000000-0000-4000-8000-000000000001',
    1, 1, (select last_revision_id from public.participant_score_projections where participant_id = '9e000000-0000-4000-8000-000000000001'), true, null, 'portal',
    '9f000000-0000-4000-8000-000000000102',
    '9f000000-0000-4000-8000-000000000202'
  ) $$,
  '22023', 'rsvp_change_reason_required',
  'score invalidation requires a nonblank reason'
);
select throws_ok(
  $$ select * from public.set_live_round_participant_not_playing(
    '9a000000-0000-4000-8000-000000000002',
    '9d000000-0000-4000-8000-000000000001',
    '9e000000-0000-4000-8000-000000000001',
    1, 1, (select last_revision_id from public.participant_score_projections where participant_id = '9e000000-0000-4000-8000-000000000001'), true, 'Member left after score', 'member_web',
    '9f000000-0000-4000-8000-000000000103',
    '9f000000-0000-4000-8000-000000000203'
  ) $$,
  '22023', 'rsvp_source_invalid',
  'the source must identify a trusted mobile or portal boundary'
);
select throws_ok(
  $$ select * from public.set_live_round_participant_not_playing(
    '9a000000-0000-4000-8000-000000000003',
    '9d000000-0000-4000-8000-000000000001',
    '9e000000-0000-4000-8000-000000000001',
    1, 1, (select last_revision_id from public.participant_score_projections where participant_id = '9e000000-0000-4000-8000-000000000001'), true, 'Member left after score', 'portal',
    '9f000000-0000-4000-8000-000000000104',
    '9f000000-0000-4000-8000-000000000204'
  ) $$,
  'P0003', 'actor_not_authorized',
  'a member cannot change another participant RSVP'
);
select throws_ok(
  $$ select * from public.set_live_round_participant_not_playing(
    '9a000000-0000-4000-8000-000000000004',
    '9d000000-0000-4000-8000-000000000001',
    '9e000000-0000-4000-8000-000000000001',
    1, 1, (select last_revision_id from public.participant_score_projections where participant_id = '9e000000-0000-4000-8000-000000000001'), true, 'Recovery correction', 'portal',
    '9f000000-0000-4000-8000-000000000105',
    '9f000000-0000-4000-8000-000000000205'
  ) $$,
  'P0003', 'recovery_session_forbidden',
  'a password-recovery session cannot change a participant RSVP'
);
select throws_ok(
  $$ select * from public.set_live_round_participant_not_playing(
    '9a000000-0000-4000-8000-000000000005',
    '9d000000-0000-4000-8000-000000000001',
    '9e000000-0000-4000-8000-000000000001',
    1, 1, (select last_revision_id from public.participant_score_projections where participant_id = '9e000000-0000-4000-8000-000000000001'), true, 'Banned correction', 'portal',
    '9f000000-0000-4000-8000-000000000106',
    '9f000000-0000-4000-8000-000000000206'
  ) $$,
  'P0003', 'actor_not_authorized',
  'a banned coordinator cannot change a participant RSVP'
);
select throws_ok(
  $$ select * from public.set_live_round_participant_not_playing(
    '9a000000-0000-4000-8000-000000000006',
    '9d000000-0000-4000-8000-000000000001',
    '9e000000-0000-4000-8000-000000000001',
    1, 1, (select last_revision_id from public.participant_score_projections where participant_id = '9e000000-0000-4000-8000-000000000001'), true, 'Inactive correction', 'portal',
    '9f000000-0000-4000-8000-000000000107',
    '9f000000-0000-4000-8000-000000000207'
  ) $$,
  'P0003', 'actor_not_authorized',
  'an inactive coordinator cannot change a participant RSVP'
);
select throws_ok(
  $$ select * from public.set_live_round_participant_not_playing(
    '9a000000-0000-4000-8000-000000000007',
    '9d000000-0000-4000-8000-000000000001',
    '9e000000-0000-4000-8000-000000000001',
    1, 1, (select last_revision_id from public.participant_score_projections where participant_id = '9e000000-0000-4000-8000-000000000001'), true, 'Cross tenant correction', 'portal',
    '9f000000-0000-4000-8000-000000000108',
    '9f000000-0000-4000-8000-000000000208'
  ) $$,
  'P0002', 'round_not_found',
  'a coordinator cannot address a round in another tenant'
);
select throws_ok(
  $$ select * from public.set_live_round_participant_not_playing(
    '9a000000-0000-4000-8000-000000000002',
    '9d000000-0000-4000-8000-000000000001',
    '9e000000-0000-4000-8000-000000000006',
    1, 1, (select last_revision_id from public.participant_score_projections where participant_id = '9e000000-0000-4000-8000-000000000006'), true, 'Cross participant correction', 'portal',
    '9f000000-0000-4000-8000-000000000109',
    '9f000000-0000-4000-8000-000000000209'
  ) $$,
  'P0002', 'participant_not_found',
  'a participant from another tenant is indistinguishable from missing'
);

create temporary table coordinator_change as
select * from public.set_live_round_participant_not_playing(
  '9a000000-0000-4000-8000-000000000002',
  '9d000000-0000-4000-8000-000000000001',
  '9e000000-0000-4000-8000-000000000001',
  1, 1, (select last_revision_id from public.participant_score_projections where participant_id = '9e000000-0000-4000-8000-000000000001'), true, 'Member withdrew after scoring', 'portal',
  '9f000000-0000-4000-8000-000000000111',
  '9f000000-0000-4000-8000-000000000211'
);
select is((select rsvp_status::text from coordinator_change), 'not_playing', 'coordinator changes the RSVP to Not Playing');
select is((select version from coordinator_change), 2::bigint, 'participant version advances atomically');
select is((select score_invalidated from coordinator_change), true, 'receipt identifies the invalidated score projection');
select is((select state::text from public.rounds where id = '9d000000-0000-4000-8000-000000000001'), 'live', 'the round remains Live');
select is((select rsvp_status::text from public.round_participants where id = '9e000000-0000-4000-8000-000000000001'), 'not_playing', 'participant state is persisted');
select is((select version from public.round_participants where id = '9e000000-0000-4000-8000-000000000001'), 2::bigint, 'participant optimistic version is persisted');
select is((select count(*) from public.participant_score_projections where participant_id = '9e000000-0000-4000-8000-000000000001'), 0::bigint, 'current score projection is removed');
select is((select count(*) from public.score_revisions where participant_id = '9e000000-0000-4000-8000-000000000001'), 1::bigint, 'append-only score revision remains');
select is((select golf_points::numeric from public.score_revisions where participant_id = '9e000000-0000-4000-8000-000000000001'), 20.00::numeric, 'invalidated revision retains the confirmed points');
select is((select plus_minus::numeric from public.score_revisions where participant_id = '9e000000-0000-4000-8000-000000000001'), 10.00::numeric, 'invalidated revision retains the derived plus/minus');
select is((select count(*) from public.audit_events where action = 'round.participant_rsvp_changed' and operation_id = '9f000000-0000-4000-8000-000000000211'), 1::bigint, 'the transition writes one audit event');
select is((select source from public.audit_events where operation_id = '9f000000-0000-4000-8000-000000000211'), 'portal', 'audit records the trusted source');
select is((select reason from public.audit_events where operation_id = '9f000000-0000-4000-8000-000000000211'), 'Member withdrew after scoring', 'audit records the required reason');
select is((select before_state ->> 'score_projection_version' from public.audit_events where operation_id = '9f000000-0000-4000-8000-000000000211'), '1', 'audit captures the invalidated projection version');
select is((select after_state ->> 'score_invalidated' from public.audit_events where operation_id = '9f000000-0000-4000-8000-000000000211'), 'true', 'audit marks the projection invalidated');

create temporary table coordinator_retry as
select * from public.set_live_round_participant_not_playing(
  '9a000000-0000-4000-8000-000000000002',
  '9d000000-0000-4000-8000-000000000001',
  '9e000000-0000-4000-8000-000000000001',
  1, 1, (select (before_state ->> 'score_revision_id')::uuid from public.audit_events where operation_id = '9f000000-0000-4000-8000-000000000211'), true, 'Member withdrew after scoring', 'portal',
  '9f000000-0000-4000-8000-000000000111',
  '9f000000-0000-4000-8000-000000000211'
);
select is((select version from coordinator_retry), 2::bigint, 'exact operation retry returns the original receipt');
select is((select score_invalidated from coordinator_retry), true, 'exact retry preserves the invalidation receipt');
select is((select count(*) from public.score_revisions where participant_id = '9e000000-0000-4000-8000-000000000001'), 1::bigint, 'exact retry does not add a score revision');
select is((select count(*) from public.audit_events where operation_id = '9f000000-0000-4000-8000-000000000211'), 1::bigint, 'exact retry does not add an audit event');
select throws_ok(
  $$ select * from public.set_live_round_participant_not_playing(
    '9a000000-0000-4000-8000-000000000002',
    '9d000000-0000-4000-8000-000000000001',
    '9e000000-0000-4000-8000-000000000001',
    1, 1, (select (before_state ->> 'score_revision_id')::uuid from public.audit_events where operation_id = '9f000000-0000-4000-8000-000000000211'), true, 'Different reason', 'portal',
    '9f000000-0000-4000-8000-000000000111',
    '9f000000-0000-4000-8000-000000000211'
  ) $$,
  '23505', 'operation_id_reused',
  'reusing an operation ID with a different request is rejected'
);
select throws_ok(
  $$ select * from public.set_live_round_participant_not_playing(
    '9a000000-0000-4000-8000-000000000002',
    '9d000000-0000-4000-8000-000000000001',
    '9e000000-0000-4000-8000-000000000001',
    1, 2, (select (before_state ->> 'score_revision_id')::uuid from public.audit_events where operation_id = '9f000000-0000-4000-8000-000000000211'), true, 'Member withdrew after scoring', 'portal',
    '9f000000-0000-4000-8000-000000000111',
    '9f000000-0000-4000-8000-000000000211'
  ) $$,
  '23505', 'operation_id_reused',
  'reusing an operation ID with different score expectations is rejected'
);

create temporary table concurrent_score_change as
select * from public.set_round_participant_score(
  '9a000000-0000-4000-8000-000000000001',
  '9e000000-0000-4000-8000-000000000002',
  '{"golf_points":17.00}'::jsonb,
  1,
  '9f000000-0000-4000-8000-000000000117',
  'portal',
  'Concurrent coordinator score correction',
  now(),
  '9f000000-0000-4000-8000-000000000118',
  '9f000000-0000-4000-8000-000000000218'
);
select is((select version from concurrent_score_change), 2::bigint, 'a concurrent score edit advances the projection version');
select is((select count(*) from public.score_revisions where participant_id = '9e000000-0000-4000-8000-000000000002'), 2::bigint, 'the concurrent score edit appends a second revision');

select throws_ok(
  $$ select * from public.set_live_round_participant_not_playing(
    '9a000000-0000-4000-8000-000000000001',
    '9d000000-0000-4000-8000-000000000001',
    '9e000000-0000-4000-8000-000000000002',
    2, 2, (select last_revision_id from public.participant_score_projections where participant_id = '9e000000-0000-4000-8000-000000000002'), true, 'Stale participant correction', 'portal',
    '9f000000-0000-4000-8000-000000000112',
    '9f000000-0000-4000-8000-000000000212'
  ) $$,
  '40001', 'participant_version_changed',
  'stale participant versions are rejected'
);
select is((select rsvp_status::text from public.round_participants where id = '9e000000-0000-4000-8000-000000000002'), 'playing', 'stale correction leaves RSVP unchanged');
select is((select count(*) from public.participant_score_projections where participant_id = '9e000000-0000-4000-8000-000000000002'), 1::bigint, 'stale correction leaves current score unchanged');

create temporary table score_stale_detail as
select * from pg_temp.capture_score_stale_detail();
select is((select sqlstate from score_stale_detail), '40001', 'stale score expectations use serialization failure SQLSTATE');
select is((select message from score_stale_detail), 'score_version_changed', 'stale score expectations use the stable error code');
select is((select (detail::jsonb ->> 'version')::bigint from score_stale_detail), 2::bigint, 'stale score detail returns the current projection version');
select is((select detail::jsonb ->> 'revision_id' from score_stale_detail), (select last_revision_id::text from public.participant_score_projections where participant_id = '9e000000-0000-4000-8000-000000000002'), 'stale score detail returns the current revision ID');
select is((select (detail::jsonb ->> 'golf_points')::numeric from score_stale_detail), 17.00::numeric, 'stale score detail returns the current points');
select is((select rsvp_status::text from public.round_participants where id = '9e000000-0000-4000-8000-000000000002'), 'playing', 'stale score rejection leaves RSVP unchanged');
select is((select count(*) from public.participant_score_projections where participant_id = '9e000000-0000-4000-8000-000000000002'), 1::bigint, 'stale score rejection leaves the current projection');

create temporary table administrator_change as
select * from public.set_live_round_participant_not_playing(
  '9a000000-0000-4000-8000-000000000001',
  '9d000000-0000-4000-8000-000000000001',
  '9e000000-0000-4000-8000-000000000002',
  1, 2, (select last_revision_id from public.participant_score_projections where participant_id = '9e000000-0000-4000-8000-000000000002'), true, 'Administrator confirmed withdrawal', 'mobile',
  '9f000000-0000-4000-8000-000000000113',
  '9f000000-0000-4000-8000-000000000213'
);
select is((select rsvp_status::text from administrator_change), 'not_playing', 'administrator can perform the same atomic transition');
select is((select source from public.audit_events where operation_id = '9f000000-0000-4000-8000-000000000213'), 'mobile', 'mobile source is retained for the trusted server boundary');

select throws_ok(
  $$ select * from public.set_live_round_participant_not_playing(
    '9a000000-0000-4000-8000-000000000002',
    '9d000000-0000-4000-8000-000000000001',
    '9e000000-0000-4000-8000-000000000003',
    1, 1, gen_random_uuid(), true, 'No score', 'portal',
    '9f000000-0000-4000-8000-000000000114',
    '9f000000-0000-4000-8000-000000000214'
  ) $$,
  'P0001', 'participant_rsvp_not_playing',
  'a participant already Not Playing cannot be transitioned again'
);

update public.rounds
set state = 'completed', version = version + 1
where id = '9d000000-0000-4000-8000-000000000001';
select throws_ok(
  $$ select * from public.set_live_round_participant_not_playing(
    '9a000000-0000-4000-8000-000000000002',
    '9d000000-0000-4000-8000-000000000001',
    '9e000000-0000-4000-8000-000000000004',
    1, 1, (select last_revision_id from public.participant_score_projections where participant_id = '9e000000-0000-4000-8000-000000000004'), true, 'Completed correction', 'portal',
    '9f000000-0000-4000-8000-000000000115',
    '9f000000-0000-4000-8000-000000000215'
  ) $$,
  'P0001', 'round_state_locked',
  'completed rounds reject operational RSVP correction'
);
select is((select rsvp_status::text from public.round_participants where id = '9e000000-0000-4000-8000-000000000004'), 'playing', 'locked-round rejection leaves RSVP unchanged');
select is((select count(*) from public.participant_score_projections where participant_id = '9e000000-0000-4000-8000-000000000004'), 1::bigint, 'locked-round rejection leaves projection unchanged');
select is((select rsvp_status::text from public.round_participants where id = '9e000000-0000-4000-8000-000000000006'), 'playing', 'cross-tenant participant remains untouched');
select is((select count(*) from public.participant_score_projections where participant_id = '9e000000-0000-4000-8000-000000000006'), 1::bigint, 'cross-tenant projection remains untouched');

select * from finish();

rollback;
