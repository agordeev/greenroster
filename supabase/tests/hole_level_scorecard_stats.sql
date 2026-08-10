begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

select has_table('public', 'participant_hole_scores', 'hole scorecard projection exists');
select has_table('public', 'participant_hole_score_revisions', 'hole score history exists');
select has_function(
  'public',
  'set_round_participant_hole_score',
  array['uuid','uuid','smallint','jsonb','bigint','uuid','text','text','app.utc_instant','uuid','uuid'],
  'server hole-score mutation exists'
);
select has_function(
  'public',
  'read_round_hole_scorecard',
  array['uuid','uuid'],
  'server hole-score read exists'
);
select has_function('public', 'read_personal_golf_stats', array['uuid'], 'personal golf stats read exists');
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid = 'public.participant_hole_scores'::regclass)
  and (select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid = 'public.participant_hole_score_revisions'::regclass),
  'hole score tables are force-RLS protected'
);
select ok(
  has_function_privilege('service_role', 'public.set_round_participant_hole_score(uuid,uuid,smallint,jsonb,bigint,uuid,text,text,app.utc_instant,uuid,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.set_round_participant_hole_score(uuid,uuid,smallint,jsonb,bigint,uuid,text,text,app.utc_instant,uuid,uuid)', 'execute'),
  'only the trusted server can call the service hole-score mutation'
);

insert into auth.users (id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at)
values
  ('d1000000-0000-4000-8000-000000000001', 'hole-admin@example.test', now(), false, false, now(), now()),
  ('d1000000-0000-4000-8000-000000000002', 'hole-member@example.test', now(), false, false, now(), now()),
  ('d1000000-0000-4000-8000-000000000003', 'hole-other@example.test', now(), false, false, now(), now());
insert into public.user_profiles (user_id, first_name, last_name)
values
  ('d1000000-0000-4000-8000-000000000001', 'Hole', 'Admin'),
  ('d1000000-0000-4000-8000-000000000002', 'Hole', 'Member'),
  ('d1000000-0000-4000-8000-000000000003', 'Hole', 'Other');
insert into public.groups (id, name, time_zone)
values
  ('d2000000-0000-4000-8000-000000000001', 'Hole Group A', 'UTC'),
  ('d2000000-0000-4000-8000-000000000002', 'Hole Group B', 'UTC');
insert into public.memberships (id, group_id, user_id, role, status, activated_at)
values
  ('d3000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'administrator', 'active', now()),
  ('d3000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002', 'member', 'active', now()),
  ('d3000000-0000-4000-8000-000000000003', 'd2000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000003', 'administrator', 'active', now());
insert into public.membership_golfer_profiles (membership_id, group_id, first_name, last_name)
values
  ('d3000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 'Hole', 'Admin'),
  ('d3000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000001', 'Hole', 'Member'),
  ('d3000000-0000-4000-8000-000000000003', 'd2000000-0000-4000-8000-000000000002', 'Hole', 'Other');
insert into public.rounds (id, group_id, description, scheduled_at, group_time_zone, format, state, version, published_at, created_by)
values
  ('d4000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 'Hole live', now(), 'UTC', 'individual_net', 'live', 1, now(), 'd1000000-0000-4000-8000-000000000001'),
  ('d4000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000002', 'Other group', now(), 'UTC', 'individual_net', 'live', 1, now(), 'd1000000-0000-4000-8000-000000000003');
insert into public.round_participants (id, round_id, group_id, membership_id, rsvp_status, quota_snapshot)
values
  ('d5000000-0000-4000-8000-000000000001', 'd4000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000002', 'playing', 10),
  ('d5000000-0000-4000-8000-000000000002', 'd4000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000001', 'playing', 10),
  ('d5000000-0000-4000-8000-000000000003', 'd4000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000002', 'd3000000-0000-4000-8000-000000000003', 'playing', 10);

select is(
  (select count(*) from public.participant_hole_scores where participant_id = 'd5000000-0000-4000-8000-000000000001'),
  18::bigint,
  'a participant receives one row for each of the 18 holes'
);

select is(
  (select version from public.set_round_participant_hole_score(
    'd1000000-0000-4000-8000-000000000002', 'd5000000-0000-4000-8000-000000000001', 1,
    '{"strokes":4,"putts":2,"fairway_hit":true,"green_in_regulation":false,"sand_save":null,"hole_comment":"Good start"}'::jsonb,
    0, 'd6000000-0000-4000-8000-000000000001', 'mobile', null,
    now(), 'd7000000-0000-4000-8000-000000000001', 'd8000000-0000-4000-8000-000000000001'
  )),
  1::bigint,
  'the first hole entry is server-versioned'
);
select is((select strokes from public.participant_hole_scores where participant_id = 'd5000000-0000-4000-8000-000000000001' and hole_number = 1), 4::smallint, 'strokes are stored');
select is((select putts from public.participant_hole_scores where participant_id = 'd5000000-0000-4000-8000-000000000001' and hole_number = 1), 2::smallint, 'putts are stored');
select is((select count(*) from public.participant_hole_score_revisions where participant_id = 'd5000000-0000-4000-8000-000000000001'), 1::bigint, 'the first entry appends one revision');
select is((select count(*) from public.audit_events where action = 'round.hole_score_updated' and target_id = 'd5000000-0000-4000-8000-000000000001'::uuid), 1::bigint, 'the first entry writes an audit event');

select is(
  (select version from public.set_round_participant_hole_score(
    'd1000000-0000-4000-8000-000000000002', 'd5000000-0000-4000-8000-000000000001', 1,
    '{"strokes":4,"putts":2}'::jsonb, 0, 'd6000000-0000-4000-8000-000000000001', 'mobile', null,
    now(), 'd7000000-0000-4000-8000-000000000001', 'd8000000-0000-4000-8000-000000000001'
  )),
  1::bigint,
  'an exact device retry returns the original revision'
);
select throws_ok(
  $$select * from public.set_round_participant_hole_score(
    'd1000000-0000-4000-8000-000000000002', 'd5000000-0000-4000-8000-000000000001', 1,
    '{"strokes":5}'::jsonb, 0, 'd6000000-0000-4000-8000-000000000002', 'mobile', 'Changed value',
    now(), 'd7000000-0000-4000-8000-000000000002', 'd8000000-0000-4000-8000-000000000002')$$,
  '40001', 'hole_score_version_changed', 'stale hole values are rejected'
);
select throws_ok(
  $$select * from public.set_round_participant_hole_score(
    'd1000000-0000-4000-8000-000000000003', 'd5000000-0000-4000-8000-000000000001', 1,
    '{"strokes":5}'::jsonb, 1, 'd6000000-0000-4000-8000-000000000003', 'mobile', null,
    now(), 'd7000000-0000-4000-8000-000000000003', 'd8000000-0000-4000-8000-000000000003')$$,
  'P0002', 'participant_not_found', 'a different group cannot address this participant'
);
select throws_ok(
  $$select * from public.set_round_participant_hole_score(
    'd1000000-0000-4000-8000-000000000002', 'd5000000-0000-4000-8000-000000000001', 2,
    '{"strokes":31}'::jsonb, 0, 'd6000000-0000-4000-8000-000000000004', 'mobile', null,
    now(), 'd7000000-0000-4000-8000-000000000004', 'd8000000-0000-4000-8000-000000000004')$$,
  '22023', 'hole_score_field_invalid', 'strokes above the documented range are rejected'
);
select throws_ok(
  $$select * from public.set_round_participant_hole_score(
    'd1000000-0000-4000-8000-000000000002', 'd5000000-0000-4000-8000-000000000001', 1,
    '{"strokes":5}'::jsonb, 1, 'd6000000-0000-4000-8000-000000000005', 'mobile', null,
    now(), 'd7000000-0000-4000-8000-000000000005', 'd8000000-0000-4000-8000-000000000005')$$,
  '22023', 'hole_score_correction_reason_required', 'replacing a saved value requires a reason'
);

select is((select count(*) from public.read_round_hole_scorecard('d1000000-0000-4000-8000-000000000002', 'd4000000-0000-4000-8000-000000000001')), 18::bigint, 'a member reads only their own 18-hole card');
select is((select count(*) from public.read_round_hole_scorecard('d1000000-0000-4000-8000-000000000001', 'd4000000-0000-4000-8000-000000000001')), 36::bigint, 'an administrator reads the round hole cards');
select is((select rounds_tracked from public.read_personal_golf_stats('d1000000-0000-4000-8000-000000000002')), 1::bigint, 'personal stats count the member round');
select is((select strokes_total from public.read_personal_golf_stats('d1000000-0000-4000-8000-000000000002')), 4::bigint, 'personal stats sum entered strokes');
select is((select putts_total from public.read_personal_golf_stats('d1000000-0000-4000-8000-000000000002')), 2::bigint, 'personal stats sum entered putts');

select * from finish();
rollback;
