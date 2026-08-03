begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

select has_function(
  'public',
  'set_round_participant_score',
  array['uuid','uuid','jsonb','bigint','uuid','text','text','app.utc_instant','uuid','uuid'],
  'score mutation RPC exists'
);
select has_function(
  'public',
  'set_round_draft_score_fields',
  array['uuid','uuid','boolean','boolean','bigint','uuid','uuid'],
  'draft score capability RPC exists'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.set_round_participant_score(uuid,uuid,jsonb,bigint,uuid,text,text,app.utc_instant,uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.set_round_participant_score(uuid,uuid,jsonb,bigint,uuid,text,text,app.utc_instant,uuid,uuid)',
    'execute'
  ),
  'only the trusted server can call score mutation'
);
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class
   where oid = 'public.participant_score_projections'::regclass)
  and (select relrowsecurity and relforcerowsecurity
       from pg_catalog.pg_class
       where oid = 'public.score_revisions'::regclass),
  'score state is force-RLS protected'
);

insert into auth.users (id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at)
values
  ('1a000000-0000-4000-8000-000000000001', 'score-admin@example.test', now(), false, false, now(), now()),
  ('1a000000-0000-4000-8000-000000000002', 'score-coordinator@example.test', now(), false, false, now(), now()),
  ('1a000000-0000-4000-8000-000000000003', 'score-member-a@example.test', now(), false, false, now(), now()),
  ('1a000000-0000-4000-8000-000000000004', 'score-member-b@example.test', now(), false, false, now(), now()),
  ('1a000000-0000-4000-8000-000000000005', 'score-recovery@example.test', now(), false, false, now(), now());

update auth.users
set raw_app_meta_data = '{"greenroster_password_recovery":true}'::jsonb
where id = '1a000000-0000-4000-8000-000000000005';

insert into public.user_profiles (user_id, first_name, last_name)
values
  ('1a000000-0000-4000-8000-000000000001', 'Score', 'Admin'),
  ('1a000000-0000-4000-8000-000000000002', 'Score', 'Coordinator'),
  ('1a000000-0000-4000-8000-000000000003', 'Score', 'Member A'),
  ('1a000000-0000-4000-8000-000000000004', 'Score', 'Member B'),
  ('1a000000-0000-4000-8000-000000000005', 'Score', 'Recovery');

insert into public.groups (id, name, time_zone)
values
  ('1b000000-0000-4000-8000-000000000001', 'Score Group A', 'America/New_York'),
  ('1b000000-0000-4000-8000-000000000002', 'Score Group B', 'UTC');

insert into public.memberships (id, group_id, user_id, role, status, activated_at)
values
  ('1c000000-0000-4000-8000-000000000001', '1b000000-0000-4000-8000-000000000001', '1a000000-0000-4000-8000-000000000001', 'administrator', 'active', now()),
  ('1c000000-0000-4000-8000-000000000002', '1b000000-0000-4000-8000-000000000001', '1a000000-0000-4000-8000-000000000002', 'coordinator', 'active', now()),
  ('1c000000-0000-4000-8000-000000000003', '1b000000-0000-4000-8000-000000000001', '1a000000-0000-4000-8000-000000000003', 'member', 'active', now()),
  ('1c000000-0000-4000-8000-000000000004', '1b000000-0000-4000-8000-000000000001', '1a000000-0000-4000-8000-000000000004', 'member', 'active', now()),
  ('1c000000-0000-4000-8000-000000000005', '1b000000-0000-4000-8000-000000000001', '1a000000-0000-4000-8000-000000000005', 'member', 'active', now());

insert into public.membership_golfer_profiles (membership_id, group_id, first_name, last_name, tee_location)
values
  ('1c000000-0000-4000-8000-000000000001', '1b000000-0000-4000-8000-000000000001', 'Score', 'Admin', 'middle'),
  ('1c000000-0000-4000-8000-000000000002', '1b000000-0000-4000-8000-000000000001', 'Score', 'Coordinator', 'middle'),
  ('1c000000-0000-4000-8000-000000000003', '1b000000-0000-4000-8000-000000000001', 'Score', 'Member A', 'middle'),
  ('1c000000-0000-4000-8000-000000000004', '1b000000-0000-4000-8000-000000000001', 'Score', 'Member B', 'middle'),
  ('1c000000-0000-4000-8000-000000000005', '1b000000-0000-4000-8000-000000000001', 'Score', 'Recovery', 'middle');

insert into public.rounds (
  id, group_id, description, scheduled_at, group_time_zone, format, state,
  enable_gross_score, enable_net_score, version, published_at, created_by
)
values
  ('1d000000-0000-4000-8000-000000000001', '1b000000-0000-4000-8000-000000000001', 'Live net score', now(), 'America/New_York', 'individual_net', 'live', true, true, 3, now(), '1a000000-0000-4000-8000-000000000001'),
  ('1d000000-0000-4000-8000-000000000002', '1b000000-0000-4000-8000-000000000001', 'Published score', now(), 'America/New_York', 'individual_net', 'published', false, false, 1, now(), '1a000000-0000-4000-8000-000000000001'),
  ('1d000000-0000-4000-8000-000000000003', '1b000000-0000-4000-8000-000000000001', 'Live gross score', now(), 'America/New_York', 'individual_gross', 'live', true, false, 2, now(), '1a000000-0000-4000-8000-000000000001'),
  ('1d000000-0000-4000-8000-000000000004', '1b000000-0000-4000-8000-000000000001', 'Draft net score', now(), 'America/New_York', 'individual_net', 'draft', false, false, 1, null, '1a000000-0000-4000-8000-000000000001'),
  ('1d000000-0000-4000-8000-000000000005', '1b000000-0000-4000-8000-000000000001', 'Draft gross score', now(), 'America/New_York', 'individual_gross', 'draft', false, false, 1, null, '1a000000-0000-4000-8000-000000000001');

insert into public.round_rule_snapshots (
  round_id, group_id, format, settings_version, enabled_final_total_fields
)
values
  ('1d000000-0000-4000-8000-000000000001', '1b000000-0000-4000-8000-000000000001', 'individual_net', 0, '{"golf_points": true, "gross_score": false, "net_score": false}'::jsonb),
  ('1d000000-0000-4000-8000-000000000002', '1b000000-0000-4000-8000-000000000001', 'individual_net', 0, '{"golf_points": true, "gross_score": false, "net_score": false}'::jsonb),
  ('1d000000-0000-4000-8000-000000000003', '1b000000-0000-4000-8000-000000000001', 'individual_gross', 0, '{"golf_points": true, "gross_score": false, "net_score": false}'::jsonb);

insert into public.round_participants (
  id, round_id, group_id, membership_id, rsvp_status, quota_snapshot
)
values
  ('1e000000-0000-4000-8000-000000000001', '1d000000-0000-4000-8000-000000000001', '1b000000-0000-4000-8000-000000000001', '1c000000-0000-4000-8000-000000000003', 'playing', 12.30),
  ('1e000000-0000-4000-8000-000000000002', '1d000000-0000-4000-8000-000000000001', '1b000000-0000-4000-8000-000000000001', '1c000000-0000-4000-8000-000000000004', 'playing', 10.00),
  ('1e000000-0000-4000-8000-000000000003', '1d000000-0000-4000-8000-000000000001', '1b000000-0000-4000-8000-000000000001', '1c000000-0000-4000-8000-000000000002', 'not_playing', 10.00),
  ('1e000000-0000-4000-8000-000000000004', '1d000000-0000-4000-8000-000000000002', '1b000000-0000-4000-8000-000000000001', '1c000000-0000-4000-8000-000000000003', 'playing', 12.30),
  ('1e000000-0000-4000-8000-000000000005', '1d000000-0000-4000-8000-000000000003', '1b000000-0000-4000-8000-000000000001', '1c000000-0000-4000-8000-000000000003', 'playing', null);

insert into public.round_participants (
  id, round_id, group_id, membership_id, participant_kind, sponsor_membership_id,
  guest_first_name, guest_last_name, rsvp_status, quota_snapshot
)
values (
  '1e000000-0000-4000-8000-000000000006',
  '1d000000-0000-4000-8000-000000000001',
  '1b000000-0000-4000-8000-000000000001',
  null,
  'guest',
  '1c000000-0000-4000-8000-000000000003',
  'Guest',
  'Player',
  'playing',
  8.50
);

create temporary table first_score as
select * from public.set_round_participant_score(
  '1a000000-0000-4000-8000-000000000003',
  '1e000000-0000-4000-8000-000000000001',
  '{"golf_points": 20.00}'::jsonb,
  0,
  '2a000000-0000-4000-8000-000000000001',
  'mobile',
  null,
  '2026-08-03T12:00:00Z'::timestamptz,
  '2b000000-0000-4000-8000-000000000001',
  '2c000000-0000-4000-8000-000000000001'
);
select is((select version from first_score), 1::bigint, 'member first score creates version one');
select is((select golf_points from first_score), 20.00::numeric, 'points preserve exact decimal input');
select is((select plus_minus from first_score), 7.70::numeric, 'server calculates plus/minus from the quota snapshot');
select is((select ranking_value from first_score), 7.70::numeric, 'net ranking value is server-derived');
select is(
  (select count(*) from public.score_revisions where participant_id = '1e000000-0000-4000-8000-000000000001'),
  1::bigint,
  'first score appends one immutable revision'
);
select is(
  (select count(*) from public.audit_events where action = 'round.score_updated' and operation_id = '2c000000-0000-4000-8000-000000000001'),
  1::bigint,
  'first score writes one audit event'
);
select is(
  (select enabled_final_total_fields from public.round_rule_snapshots where round_id = '1d000000-0000-4000-8000-000000000001'),
  '{"golf_points": true, "gross_score": true, "net_score": true}'::jsonb,
  'published snapshot preserves enabled net-format fields'
);
select is(
  (select enabled_final_total_fields from public.round_rule_snapshots where round_id = '1d000000-0000-4000-8000-000000000003'),
  '{"golf_points": true, "gross_score": true, "net_score": false}'::jsonb,
  'gross snapshot disables net even when gross is enabled'
);

create temporary table draft_score_fields as
select * from public.set_round_draft_score_fields(
  '1a000000-0000-4000-8000-000000000002',
  '1d000000-0000-4000-8000-000000000004',
  true,
  true,
  1,
  '2b000000-0000-4000-8000-000000000018',
  '2c000000-0000-4000-8000-000000000018'
);
select is((select enable_gross_score from draft_score_fields), true, 'draft enables gross score');
select is((select enable_net_score from draft_score_fields), true, 'draft enables net score');
select is((select version from draft_score_fields), 2::bigint, 'draft capability update bumps round version');
select throws_ok(
  $$ select * from public.set_round_draft_score_fields(
    '1a000000-0000-4000-8000-000000000002',
    '1d000000-0000-4000-8000-000000000005',
    false, true, 1,
    '2b000000-0000-4000-8000-000000000019',
    '2c000000-0000-4000-8000-000000000019'
  ) $$,
  '22023', 'score_field_capability_invalid', 'gross drafts cannot enable net score'
);

create temporary table guest_score as
select * from public.set_round_participant_score(
  '1a000000-0000-4000-8000-000000000003',
  '1e000000-0000-4000-8000-000000000006',
  '{"golf_points": 15.00}'::jsonb,
  0,
  '2a000000-0000-4000-8000-000000000016',
  'mobile',
  null,
  now(),
  '2b000000-0000-4000-8000-000000000016',
  '2c000000-0000-4000-8000-000000000016'
);
select is((select plus_minus from guest_score), 6.50::numeric, 'sponsor may score a round-scoped guest');
create temporary table guest_incremental_score as
from public.set_round_participant_score(
  '1a000000-0000-4000-8000-000000000002',
  '1e000000-0000-4000-8000-000000000006',
  '{"gross_score": 90}'::jsonb,
  1,
  '2a000000-0000-4000-8000-000000000021',
  'portal',
  null,
  now(),
  '2b000000-0000-4000-8000-000000000021',
  '2c000000-0000-4000-8000-000000000021'
);
select is((select version from guest_incremental_score), 2::bigint, 'first entry of another enabled field needs no correction reason');
select throws_ok(
  $$ select * from public.set_round_participant_score(
    '1a000000-0000-4000-8000-000000000004', '1e000000-0000-4000-8000-000000000006',
    '{"golf_points": 14.00}'::jsonb, 1,
    '2a000000-0000-4000-8000-000000000017', 'mobile', null, now(),
    '2b000000-0000-4000-8000-000000000017', '2c000000-0000-4000-8000-000000000017'
  ) $$,
  'P0003', 'score_actor_not_authorized', 'a non-sponsor member cannot score a guest'
);

create temporary table score_retry as
select * from public.set_round_participant_score(
  '1a000000-0000-4000-8000-000000000003',
  '1e000000-0000-4000-8000-000000000001',
  '{"golf_points": 20.00}'::jsonb,
  0,
  '2a000000-0000-4000-8000-000000000001',
  'mobile',
  null,
  '2026-08-03T12:00:00Z'::timestamptz,
  '2b000000-0000-4000-8000-000000000002',
  '2c000000-0000-4000-8000-000000000002'
);
select is((select version from score_retry), 1::bigint, 'same device operation replays the confirmed score');
select is(
  (select count(*) from public.score_revisions where participant_id = '1e000000-0000-4000-8000-000000000001'),
  1::bigint,
  'score retry does not append a duplicate revision'
);

select throws_ok(
  $$ select * from public.set_round_participant_score(
    '1a000000-0000-4000-8000-000000000003', '1e000000-0000-4000-8000-000000000001',
    '{"golf_points": 18.00}'::jsonb, 0,
    '2a000000-0000-4000-8000-000000000003', 'mobile', null, now(),
    '2b000000-0000-4000-8000-000000000003', '2c000000-0000-4000-8000-000000000003'
  ) $$,
  '40001', 'score_version_changed', 'stale score is rejected without overwrite'
);
select is((select golf_points from public.participant_score_projections where participant_id = '1e000000-0000-4000-8000-000000000001'), 20.00::numeric, 'stale score leaves current projection unchanged');

select throws_ok(
  $$ select * from public.set_round_participant_score(
    '1a000000-0000-4000-8000-000000000004', '1e000000-0000-4000-8000-000000000001',
    '{"golf_points": 19.00}'::jsonb, 1,
    '2a000000-0000-4000-8000-000000000004', 'mobile', null, now(),
    '2b000000-0000-4000-8000-000000000004', '2c000000-0000-4000-8000-000000000004'
  ) $$,
  'P0003', 'score_actor_not_authorized', 'member cannot score another member'
);
select throws_ok(
  $$ select * from public.set_round_participant_score(
    '1a000000-0000-4000-8000-000000000003', '1e000000-0000-4000-8000-000000000001',
    '{"golf_points": 19.00}'::jsonb, 1,
    '2a000000-0000-4000-8000-000000000020', 'portal', null, now(),
    '2b000000-0000-4000-8000-000000000020', '2c000000-0000-4000-8000-000000000020'
  ) $$,
  'P0003', 'score_actor_not_authorized', 'members cannot use portal score entry'
);
select throws_ok(
  $$ select * from public.set_round_participant_score(
    '1a000000-0000-4000-8000-000000000003', '1e000000-0000-4000-8000-000000000001',
    '{"manual_merit": 2.00}'::jsonb, 1,
    '2a000000-0000-4000-8000-000000000005', 'mobile', 'not allowed', now(),
    '2b000000-0000-4000-8000-000000000005', '2c000000-0000-4000-8000-000000000005'
  ) $$,
  'P0003', 'score_field_not_authorized', 'member cannot author manual merit'
);

create temporary table corrected_score as
select * from public.set_round_participant_score(
  '1a000000-0000-4000-8000-000000000002',
  '1e000000-0000-4000-8000-000000000001',
  '{"golf_points": 18.00}'::jsonb,
  1,
  '2a000000-0000-4000-8000-000000000006',
  'portal',
  'Coordinator correction',
  now(),
  '2b000000-0000-4000-8000-000000000006',
  '2c000000-0000-4000-8000-000000000006'
);
select is((select version from corrected_score), 2::bigint, 'coordinator correction advances the independent score version');
select is((select plus_minus from corrected_score), 5.70::numeric, 'correction recalculates plus/minus on the server');
select is((select reason from public.score_revisions where revision_number = 2 and participant_id = '1e000000-0000-4000-8000-000000000001'), 'Coordinator correction', 'correction reason is retained');

select throws_ok(
  $$ select * from public.set_round_participant_score(
    '1a000000-0000-4000-8000-000000000002', '1e000000-0000-4000-8000-000000000001',
    '{"golf_points": 17.00}'::jsonb, 2,
    '2a000000-0000-4000-8000-000000000007', 'portal', null, now(),
    '2b000000-0000-4000-8000-000000000007', '2c000000-0000-4000-8000-000000000007'
  ) $$,
  '22023', 'score_correction_reason_required', 'confirmed score changes require a reason'
);
select throws_ok(
  $$ select * from public.set_round_participant_score(
    '1a000000-0000-4000-8000-000000000002', '1e000000-0000-4000-8000-000000000001',
    '{"manual_merit": 2.00}'::jsonb, 2,
    '2a000000-0000-4000-8000-000000000008', 'portal', 'Merit correction', now(),
    '2b000000-0000-4000-8000-000000000008', '2c000000-0000-4000-8000-000000000008'
  ) $$,
  'P0003', 'score_actor_not_authorized', 'coordinator cannot use member account for portal correction'
);

create temporary table admin_merit as
select * from public.set_round_participant_score(
  '1a000000-0000-4000-8000-000000000001',
  '1e000000-0000-4000-8000-000000000001',
  '{"manual_merit": 2.00}'::jsonb,
  2,
  '2a000000-0000-4000-8000-000000000009',
  'portal',
  'Merit correction',
  now(),
  '2b000000-0000-4000-8000-000000000009',
  '2c000000-0000-4000-8000-000000000009'
);
select is((select manual_merit from admin_merit), 2.00::numeric, 'administrator may author manual merit');

select throws_ok(
  $$ select * from public.set_round_participant_score(
    '1a000000-0000-4000-8000-000000000003', '1e000000-0000-4000-8000-000000000004',
    '{"gross_score": 80}'::jsonb, 0,
    '2a000000-0000-4000-8000-000000000010', 'mobile', null, now(),
    '2b000000-0000-4000-8000-000000000010', '2c000000-0000-4000-8000-000000000010'
  ) $$,
  '22023', 'score_field_disabled', 'disabled gross score is rejected'
);
select throws_ok(
  $$ select * from public.set_round_participant_score(
    '1a000000-0000-4000-8000-000000000003', '1e000000-0000-4000-8000-000000000001',
    '{"golf_points": 100.001}'::jsonb, 3,
    '2a000000-0000-4000-8000-000000000011', 'mobile', null, now(),
    '2b000000-0000-4000-8000-000000000011', '2c000000-0000-4000-8000-000000000011'
  ) $$,
  '22023', 'score_field_invalid', 'out-of-scale points are rejected'
);

select throws_ok(
  $$ select * from public.set_round_participant_score(
    '1a000000-0000-4000-8000-000000000003', '1e000000-0000-4000-8000-000000000003',
    '{"golf_points": 10}'::jsonb, 0,
    '2a000000-0000-4000-8000-000000000012', 'mobile', null, now(),
    '2b000000-0000-4000-8000-000000000012', '2c000000-0000-4000-8000-000000000012'
  ) $$,
  'P0001', 'participant_scoring_ineligible', 'Not Playing participants are locked'
);
select throws_ok(
  $$ select * from public.set_round_participant_score(
    '1a000000-0000-4000-8000-000000000003', '1e000000-0000-4000-8000-000000000004',
    '{"golf_points": 10}'::jsonb, 0,
    '2a000000-0000-4000-8000-000000000013', 'mobile', null, now(),
    '2b000000-0000-4000-8000-000000000013', '2c000000-0000-4000-8000-000000000013'
  ) $$,
  'P0001', 'round_scoring_locked', 'Published rounds are locked'
);
select throws_ok(
  $$ select * from public.set_round_participant_score(
    '1a000000-0000-4000-8000-000000000005', '1e000000-0000-4000-8000-000000000001',
    '{"golf_points": 10}'::jsonb, 2,
    '2a000000-0000-4000-8000-000000000014', 'mobile', null, now(),
    '2b000000-0000-4000-8000-000000000014', '2c000000-0000-4000-8000-000000000014'
  ) $$,
  'P0003', 'actor_not_authorized', 'recovery sessions are rejected'
);
select throws_ok(
  $$ select * from public.set_round_participant_score(
    '1a000000-0000-4000-8000-000000000003', '1e000000-0000-4000-8000-000000000001',
    '{"golf_points": 10}'::jsonb, 2,
    '2a000000-0000-4000-8000-000000000015', 'mobile', null, now(),
    '2b000000-0000-4000-8000-000000000015', '2c000000-0000-4000-8000-000000000015'
  ) $$,
  '40001', 'score_version_changed', 'old expected version remains stale after later revisions'
);

select throws_ok(
  $$ update public.score_revisions set reason = 'tamper' where participant_id = '1e000000-0000-4000-8000-000000000001' $$,
  'P0001', 'score_revisions_append_only', 'score revisions are append-only'
);

select * from finish();

rollback;
