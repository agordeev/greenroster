begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

select has_function(
  'public',
  'read_mobile_live_round_scores',
  array['uuid'],
  'actor-derived mobile live score read exists'
);
select has_function(
  'public',
  'set_mobile_round_participant_score',
  array['uuid','jsonb','bigint','uuid','text','app.utc_instant','uuid','uuid'],
  'actor-derived mobile score write exists'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.read_mobile_live_round_scores(uuid)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.set_mobile_round_participant_score(uuid,jsonb,bigint,uuid,text,app.utc_instant,uuid,uuid)',
    'execute'
  ),
  'authenticated clients can call both mobile score boundaries'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.read_mobile_live_round_scores(uuid)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.read_mobile_live_round_scores(uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.set_mobile_round_participant_score(uuid,jsonb,bigint,uuid,text,app.utc_instant,uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.set_mobile_round_participant_score(uuid,jsonb,bigint,uuid,text,app.utc_instant,uuid,uuid)',
    'execute'
  ),
  'anonymous and service-role clients cannot call mobile score boundaries'
);
select ok(
  (select prosecdef from pg_catalog.pg_proc where oid = 'public.read_mobile_live_round_scores(uuid)'::regprocedure)
  and (select prosecdef from pg_catalog.pg_proc where oid = 'public.set_mobile_round_participant_score(uuid,jsonb,bigint,uuid,text,app.utc_instant,uuid,uuid)'::regprocedure),
  'mobile score boundaries are pinned security-definer delegates'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.read_live_round_scores(uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.set_round_participant_score(uuid,uuid,jsonb,bigint,uuid,text,text,app.utc_instant,uuid,uuid)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.read_live_round_scores(uuid,uuid)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.set_round_participant_score(uuid,uuid,jsonb,bigint,uuid,text,text,app.utc_instant,uuid,uuid)',
    'execute'
  ),
  'service-only score RPCs remain unavailable to mobile clients'
);
select ok(
  not has_table_privilege('authenticated', 'public.score_revisions', 'select,insert,update,delete')
  and not has_table_privilege('authenticated', 'public.score_revisions', 'truncate'),
  'mobile clients cannot bypass the score write boundary through raw history'
);

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, banned_until,
  created_at, updated_at
)
values
  ('aa000000-0000-4000-8000-000000000001', 'mobile-coordinator@example.test', now(), false, false, null, now(), now()),
  ('aa000000-0000-4000-8000-000000000002', 'mobile-member-a@example.test', now(), false, false, null, now(), now()),
  ('aa000000-0000-4000-8000-000000000003', 'mobile-member-b@example.test', now(), false, false, null, now(), now()),
  ('aa000000-0000-4000-8000-000000000004', 'mobile-member-cross-tenant@example.test', now(), false, false, null, now(), now()),
  ('aa000000-0000-4000-8000-000000000005', 'mobile-recovery@example.test', now(), false, false, null, now(), now()),
  ('aa000000-0000-4000-8000-000000000006', 'mobile-inactive@example.test', now(), false, false, null, now(), now()),
  ('aa000000-0000-4000-8000-000000000007', 'mobile-banned@example.test', now(), false, false, now() + interval '1 day', now(), now()),
  ('aa000000-0000-4000-8000-000000000008', 'mobile-excluded@example.test', now(), false, false, null, now(), now());

update auth.users
set raw_app_meta_data = '{"greenroster_password_recovery":true}'::jsonb
where id = 'aa000000-0000-4000-8000-000000000005';

insert into public.user_profiles (user_id, first_name, last_name)
values
  ('aa000000-0000-4000-8000-000000000001', 'Mobile', 'Coordinator'),
  ('aa000000-0000-4000-8000-000000000002', 'Mobile', 'Member A'),
  ('aa000000-0000-4000-8000-000000000003', 'Mobile', 'Member B'),
  ('aa000000-0000-4000-8000-000000000004', 'Mobile', 'Cross Tenant'),
  ('aa000000-0000-4000-8000-000000000005', 'Mobile', 'Recovery'),
  ('aa000000-0000-4000-8000-000000000006', 'Mobile', 'Inactive'),
  ('aa000000-0000-4000-8000-000000000007', 'Mobile', 'Banned'),
  ('aa000000-0000-4000-8000-000000000008', 'Mobile', 'Excluded');

insert into public.groups (id, name, time_zone)
values
  ('ab000000-0000-4000-8000-000000000001', 'Mobile Group A', 'America/New_York'),
  ('ab000000-0000-4000-8000-000000000002', 'Mobile Group B', 'UTC');

insert into public.memberships (
  id, group_id, user_id, role, status, activated_at, inactivated_at
)
values
  ('ac000000-0000-4000-8000-000000000001', 'ab000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000001', 'coordinator', 'active', now(), null),
  ('ac000000-0000-4000-8000-000000000002', 'ab000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000002', 'member', 'active', now(), null),
  ('ac000000-0000-4000-8000-000000000003', 'ab000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000003', 'member', 'active', now(), null),
  ('ac000000-0000-4000-8000-000000000004', 'ab000000-0000-4000-8000-000000000002', 'aa000000-0000-4000-8000-000000000004', 'member', 'active', now(), null),
  ('ac000000-0000-4000-8000-000000000005', 'ab000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000005', 'member', 'active', now(), null),
  ('ac000000-0000-4000-8000-000000000006', 'ab000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000006', 'member', 'inactive', null, now()),
  ('ac000000-0000-4000-8000-000000000007', 'ab000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000007', 'member', 'active', now(), null),
  ('ac000000-0000-4000-8000-000000000008', 'ab000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000008', 'member', 'active', now(), null);

insert into public.membership_golfer_profiles (
  membership_id, group_id, first_name, last_name, tee_location
)
values
  ('ac000000-0000-4000-8000-000000000001', 'ab000000-0000-4000-8000-000000000001', 'Mobile', 'Coordinator', 'middle'),
  ('ac000000-0000-4000-8000-000000000002', 'ab000000-0000-4000-8000-000000000001', 'Mobile', 'Member A', 'middle'),
  ('ac000000-0000-4000-8000-000000000003', 'ab000000-0000-4000-8000-000000000001', 'Mobile', 'Member B', 'middle');

insert into public.rounds (
  id, group_id, description, scheduled_at, group_time_zone, format, state,
  enable_gross_score, enable_net_score, version, published_at, created_by
)
values (
  'ad000000-0000-4000-8000-000000000001',
  'ab000000-0000-4000-8000-000000000001',
  'Mobile live round',
  now(),
  'America/New_York',
  'individual_net',
  'live',
  true,
  true,
  1,
  now(),
  'aa000000-0000-4000-8000-000000000001'
);

insert into public.round_rule_snapshots (round_id, group_id, format, settings_version)
values (
  'ad000000-0000-4000-8000-000000000001',
  'ab000000-0000-4000-8000-000000000001',
  'individual_net',
  0
);

insert into public.round_participants (
  id, round_id, group_id, membership_id, rsvp_status, quota_snapshot
)
values
  ('ae000000-0000-4000-8000-000000000001', 'ad000000-0000-4000-8000-000000000001', 'ab000000-0000-4000-8000-000000000001', 'ac000000-0000-4000-8000-000000000002', 'playing', 10.00),
  ('ae000000-0000-4000-8000-000000000002', 'ad000000-0000-4000-8000-000000000001', 'ab000000-0000-4000-8000-000000000001', 'ac000000-0000-4000-8000-000000000003', 'playing', 11.00);

insert into public.round_participants (
  id, round_id, group_id, membership_id, participant_kind, sponsor_membership_id,
  guest_first_name, guest_last_name, rsvp_status, quota_snapshot
)
values (
  'ae000000-0000-4000-8000-000000000003',
  'ad000000-0000-4000-8000-000000000001',
  'ab000000-0000-4000-8000-000000000001',
  null,
  'guest',
  'ac000000-0000-4000-8000-000000000002',
  'Mobile Guest',
  'Player',
  'playing',
  8.00
);

create function pg_temp.capture_mobile_stale_detail()
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
    from public.set_mobile_round_participant_score(
      'ae000000-0000-4000-8000-000000000001',
      '{"golf_points":19.00}'::jsonb,
      0,
      'af000000-0000-4000-8000-000000000009',
      null,
      pg_catalog.now(),
      'af000000-0000-4000-8000-000000000020',
      'af000000-0000-4000-8000-000000000030'
    );
  exception when others then
    get stacked diagnostics
      captured_state = returned_sqlstate,
      captured_message = message_text,
      captured_detail = pg_exception_detail;
    return query select captured_state, captured_message, captured_detail;
    return;
  end;
  return query select null::text, null::text, null::text;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'aa000000-0000-4000-8000-000000000002', true);

select is((select count(*) from public.read_mobile_live_round_scores('ad000000-0000-4000-8000-000000000001')), 3::bigint, 'member receives the live round projection through the mobile boundary');
select is((select group_id::uuid from public.read_mobile_live_round_scores('ad000000-0000-4000-8000-000000000001') limit 1), 'ab000000-0000-4000-8000-000000000001'::uuid, 'mobile read derives the tenant from auth.uid()');
select is((select can_edit from public.read_mobile_live_round_scores('ad000000-0000-4000-8000-000000000001') where participant_id = 'ae000000-0000-4000-8000-000000000001'), true, 'member may edit their own Playing participant');
select is((select can_edit from public.read_mobile_live_round_scores('ad000000-0000-4000-8000-000000000001') where participant_id = 'ae000000-0000-4000-8000-000000000002'), false, 'member cannot edit another participant');
select is((select can_edit from public.read_mobile_live_round_scores('ad000000-0000-4000-8000-000000000001') where participant_id = 'ae000000-0000-4000-8000-000000000003'), true, 'sponsor may edit their guest participant');
select is((select can_author_manual_merit from public.read_mobile_live_round_scores('ad000000-0000-4000-8000-000000000001') where participant_id = 'ae000000-0000-4000-8000-000000000001'), false, 'member cannot author manual merit');

select is((select version from public.set_mobile_round_participant_score(
  'ae000000-0000-4000-8000-000000000001',
  '{"golf_points":20.00}'::jsonb,
  0,
  'af000000-0000-4000-8000-000000000001',
  null,
  '2026-08-04T12:00:00Z'::timestamptz,
  'af000000-0000-4000-8000-000000000011',
  'af000000-0000-4000-8000-000000000021'
)), 1::bigint, 'mobile member score creates version one');
select is((select plus_minus::numeric from public.set_mobile_round_participant_score(
  'ae000000-0000-4000-8000-000000000001', '{"golf_points":20.00}'::jsonb, 0,
  'af000000-0000-4000-8000-000000000001', null, '2026-08-04T12:00:00Z'::timestamptz,
  'af000000-0000-4000-8000-000000000011', 'af000000-0000-4000-8000-000000000021'
)), 10.00::numeric, 'mobile score write calculates plus/minus on the server');

set local role postgres;
select is((select source from public.score_revisions where participant_id = 'ae000000-0000-4000-8000-000000000001' and revision_number = 1), 'mobile', 'mobile wrapper forces the immutable revision source to mobile');
select is((select count(*) from public.score_revisions where participant_id = 'ae000000-0000-4000-8000-000000000001'), 1::bigint, 'mobile write appends exactly one revision');
set local role authenticated;

select is((select version from public.set_mobile_round_participant_score(
  'ae000000-0000-4000-8000-000000000001',
  '{"golf_points":20.00}'::jsonb,
  0,
  'af000000-0000-4000-8000-000000000001',
  null,
  '2026-08-04T12:00:00Z'::timestamptz,
  'af000000-0000-4000-8000-000000000012',
  'af000000-0000-4000-8000-000000000022'
)), 1::bigint, 'mobile score retries replay the exact committed result');
set local role postgres;
select is((select count(*) from public.score_revisions where participant_id = 'ae000000-0000-4000-8000-000000000001'), 1::bigint, 'mobile score retry does not duplicate history');
set local role authenticated;

select throws_ok(
  $$ select * from public.set_mobile_round_participant_score(
    'ae000000-0000-4000-8000-000000000001', '{"golf_points":19.00}'::jsonb, 0,
    'af000000-0000-4000-8000-000000000002', null, now(),
    'af000000-0000-4000-8000-000000000013', 'af000000-0000-4000-8000-000000000023'
  ) $$,
  '40001', 'score_version_changed', 'stale mobile writes are rejected'
);
select is(
  (select sqlstate from pg_temp.capture_mobile_stale_detail()),
  '40001',
  'stale mobile write exposes the expected serialization state'
);
select ok(
  (select detail like '%"version": 1%' and detail like '%"golf_points": 20.00%'
   from pg_temp.capture_mobile_stale_detail()),
  'stale mobile write detail includes the current version and score values'
);
set local role postgres;
select is((select golf_points::numeric from public.participant_score_projections where participant_id = 'ae000000-0000-4000-8000-000000000001'), 20.00::numeric, 'stale mobile write leaves the current projection unchanged');
set local role authenticated;

select throws_ok(
  $$ select * from public.set_mobile_round_participant_score(
    'ae000000-0000-4000-8000-000000000002', '{"golf_points":18.00}'::jsonb, 0,
    'af000000-0000-4000-8000-000000000003', null, now(),
    'af000000-0000-4000-8000-000000000014', 'af000000-0000-4000-8000-000000000024'
  ) $$,
  'P0003', 'score_actor_not_authorized', 'member cannot score another member through the mobile boundary'
);

select is((select plus_minus::numeric from public.set_mobile_round_participant_score(
  'ae000000-0000-4000-8000-000000000003',
  '{"golf_points":15.00}'::jsonb,
  0,
  'af000000-0000-4000-8000-000000000004',
  null,
  now(),
  'af000000-0000-4000-8000-000000000015',
  'af000000-0000-4000-8000-000000000025'
)), 7.00::numeric, 'the member sponsor may score a guest through mobile');

set local role postgres;
select is((select source from public.score_revisions where participant_id = 'ae000000-0000-4000-8000-000000000003' and revision_number = 1), 'mobile', 'guest score revisions also force mobile source');
set local role authenticated;

select set_config('request.jwt.claim.sub', 'aa000000-0000-4000-8000-000000000001', true);
select is((select can_edit from public.read_mobile_live_round_scores('ad000000-0000-4000-8000-000000000001') where participant_id = 'ae000000-0000-4000-8000-000000000002'), true, 'coordinator can edit another participant through mobile');
select is((select can_author_manual_merit from public.read_mobile_live_round_scores('ad000000-0000-4000-8000-000000000001') where participant_id = 'ae000000-0000-4000-8000-000000000002'), true, 'coordinator capability is derived server-side');
select is(
  (select version from public.set_mobile_round_participant_score(
    'ae000000-0000-4000-8000-000000000002',
    '{"golf_points":18.00}'::jsonb,
    0,
    'af000000-0000-4000-8000-000000000005',
    null,
    now(),
    'af000000-0000-4000-8000-000000000016',
    'af000000-0000-4000-8000-000000000026'
  )),
  1::bigint,
  'coordinator can write another participant through the mobile boundary'
);
set local role postgres;
select is((select source from public.score_revisions where participant_id = 'ae000000-0000-4000-8000-000000000002'), 'mobile', 'coordinator mobile writes remain explicitly mobile-sourced');
set local role authenticated;

select set_config('request.jwt.claim.sub', 'aa000000-0000-4000-8000-000000000008', true);
select throws_ok(
  $$ select * from public.read_mobile_live_round_scores('ad000000-0000-4000-8000-000000000001') $$,
  'P0002', 'round_not_found', 'same-group members excluded from a round cannot use the mobile score read'
);
select set_config('request.jwt.claim.sub', 'aa000000-0000-4000-8000-000000000004', true);
select throws_ok(
  $$ select * from public.read_mobile_live_round_scores('ad000000-0000-4000-8000-000000000001') $$,
  'P0002', 'round_not_found', 'a cross-tenant member cannot read the other group live round'
);
select throws_ok(
  $$ select * from public.set_mobile_round_participant_score(
    'ae000000-0000-4000-8000-000000000001', '{"golf_points":17.00}'::jsonb, 1,
    'af000000-0000-4000-8000-000000000006', null, now(),
    'af000000-0000-4000-8000-000000000017', 'af000000-0000-4000-8000-000000000027'
  ) $$,
  'P0002', 'participant_not_found', 'a cross-tenant member cannot write the other group participant'
);

select set_config('request.jwt.claim.sub', 'aa000000-0000-4000-8000-000000000005', true);
select throws_ok(
  $$ select * from public.read_mobile_live_round_scores('ad000000-0000-4000-8000-000000000001') $$,
  'P0003', 'recovery_session_forbidden', 'recovery sessions cannot read mobile live scores'
);
select throws_ok(
  $$ select * from public.set_mobile_round_participant_score(
    'ae000000-0000-4000-8000-000000000001', '{"golf_points":17.00}'::jsonb, 1,
    'af000000-0000-4000-8000-000000000007', null, now(),
    'af000000-0000-4000-8000-000000000018', 'af000000-0000-4000-8000-000000000028'
  ) $$,
  'P0003', 'actor_not_authorized', 'recovery sessions cannot write mobile scores'
);

select set_config('request.jwt.claim.sub', 'aa000000-0000-4000-8000-000000000006', true);
select throws_ok(
  $$ select * from public.read_mobile_live_round_scores('ad000000-0000-4000-8000-000000000001') $$,
  'P0002', 'round_not_found', 'inactive members cannot read mobile live scores'
);

select set_config('request.jwt.claim.sub', 'aa000000-0000-4000-8000-000000000007', true);
select throws_ok(
  $$ select * from public.set_mobile_round_participant_score(
    'ae000000-0000-4000-8000-000000000001', '{"golf_points":17.00}'::jsonb, 1,
    'af000000-0000-4000-8000-000000000008', null, now(),
    'af000000-0000-4000-8000-000000000019', 'af000000-0000-4000-8000-000000000029'
  ) $$,
  'P0003', 'actor_not_authorized', 'banned members cannot write mobile scores'
);

select * from finish();

rollback;
