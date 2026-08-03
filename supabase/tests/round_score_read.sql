begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

select has_function(
  'public',
  'read_live_round_scores',
  array['uuid','uuid'],
  'live score read RPC exists'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.read_live_round_scores(uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.read_live_round_scores(uuid,uuid)',
    'execute'
  ),
  'live score read is service-only'
);
select ok(
  has_table_privilege('authenticated', 'public.participant_score_projections', 'select')
  and exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'participant_score_projections'
      and policyname = 'participant_score_projections_live_read'
  ),
  'Realtime score projection has an authenticated tenant policy'
);
select ok(
  has_function_privilege(
    'authenticated',
    'app.can_read_live_score_projection(uuid,uuid)',
    'execute'
  ),
  'authenticated Realtime evaluation can execute the locked policy helper'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'participant_score_projections'
  ),
  'score projection is in the Realtime publication'
);

insert into auth.users (id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at)
values
  ('3a000000-0000-4000-8000-000000000001', 'read-admin@example.test', now(), false, false, now(), now()),
  ('3a000000-0000-4000-8000-000000000002', 'read-member-a@example.test', now(), false, false, now(), now()),
  ('3a000000-0000-4000-8000-000000000003', 'read-member-b@example.test', now(), false, false, now(), now()),
  ('3a000000-0000-4000-8000-000000000004', 'read-recovery@example.test', now(), false, false, now(), now()),
  ('3a000000-0000-4000-8000-000000000005', 'read-excluded@example.test', now(), false, false, now(), now());

update auth.users
set raw_app_meta_data = '{"greenroster_password_recovery":true}'::jsonb
where id = '3a000000-0000-4000-8000-000000000004';

insert into public.user_profiles (user_id, first_name, last_name)
values
  ('3a000000-0000-4000-8000-000000000001', 'Read', 'Admin'),
  ('3a000000-0000-4000-8000-000000000002', 'Read', 'Member A'),
  ('3a000000-0000-4000-8000-000000000003', 'Read', 'Member B'),
  ('3a000000-0000-4000-8000-000000000004', 'Read', 'Recovery'),
  ('3a000000-0000-4000-8000-000000000005', 'Read', 'Excluded');

insert into public.groups (id, name, time_zone)
values
  ('3b000000-0000-4000-8000-000000000001', 'Read Group A', 'America/New_York'),
  ('3b000000-0000-4000-8000-000000000002', 'Read Group B', 'UTC');

insert into public.memberships (id, group_id, user_id, role, status, activated_at)
values
  ('3c000000-0000-4000-8000-000000000001', '3b000000-0000-4000-8000-000000000001', '3a000000-0000-4000-8000-000000000001', 'administrator', 'active', now()),
  ('3c000000-0000-4000-8000-000000000002', '3b000000-0000-4000-8000-000000000001', '3a000000-0000-4000-8000-000000000002', 'member', 'active', now()),
  ('3c000000-0000-4000-8000-000000000003', '3b000000-0000-4000-8000-000000000001', '3a000000-0000-4000-8000-000000000003', 'member', 'active', now()),
  ('3c000000-0000-4000-8000-000000000004', '3b000000-0000-4000-8000-000000000001', '3a000000-0000-4000-8000-000000000004', 'member', 'active', now()),
  ('3c000000-0000-4000-8000-000000000005', '3b000000-0000-4000-8000-000000000001', '3a000000-0000-4000-8000-000000000005', 'member', 'active', now());

insert into public.membership_golfer_profiles (membership_id, group_id, first_name, last_name, tee_location)
values
  ('3c000000-0000-4000-8000-000000000001', '3b000000-0000-4000-8000-000000000001', 'Read', 'Admin', 'middle'),
  ('3c000000-0000-4000-8000-000000000002', '3b000000-0000-4000-8000-000000000001', 'Read', 'Member A', 'middle'),
  ('3c000000-0000-4000-8000-000000000003', '3b000000-0000-4000-8000-000000000001', 'Read', 'Member B', 'middle'),
  ('3c000000-0000-4000-8000-000000000004', '3b000000-0000-4000-8000-000000000001', 'Read', 'Recovery', 'middle');

insert into public.rounds (
  id, group_id, description, scheduled_at, group_time_zone, format, state,
  enable_gross_score, enable_net_score, version, published_at, created_by
)
values
  ('3d000000-0000-4000-8000-000000000001', '3b000000-0000-4000-8000-000000000001', 'Readable live round', now(), 'America/New_York', 'individual_net', 'live', true, true, 1, now(), '3a000000-0000-4000-8000-000000000001'),
  ('3d000000-0000-4000-8000-000000000002', '3b000000-0000-4000-8000-000000000001', 'Readable published round', now(), 'America/New_York', 'individual_net', 'published', false, false, 1, now(), '3a000000-0000-4000-8000-000000000001');

insert into public.round_rule_snapshots (round_id, group_id, format, settings_version)
values
  ('3d000000-0000-4000-8000-000000000001', '3b000000-0000-4000-8000-000000000001', 'individual_net', 0),
  ('3d000000-0000-4000-8000-000000000002', '3b000000-0000-4000-8000-000000000001', 'individual_net', 0);

insert into public.round_participants (
  id, round_id, group_id, membership_id, rsvp_status, quota_snapshot
)
values
  ('3e000000-0000-4000-8000-000000000001', '3d000000-0000-4000-8000-000000000001', '3b000000-0000-4000-8000-000000000001', '3c000000-0000-4000-8000-000000000002', 'playing', 15.00),
  ('3e000000-0000-4000-8000-000000000002', '3d000000-0000-4000-8000-000000000001', '3b000000-0000-4000-8000-000000000001', '3c000000-0000-4000-8000-000000000003', 'playing', 10.00),
  ('3e000000-0000-4000-8000-000000000003', '3d000000-0000-4000-8000-000000000001', '3b000000-0000-4000-8000-000000000001', '3c000000-0000-4000-8000-000000000001', 'not_playing', 12.00);

insert into public.round_participants (
  id, round_id, group_id, membership_id, participant_kind, sponsor_membership_id,
  guest_first_name, guest_last_name, rsvp_status, quota_snapshot
)
values (
  '3e000000-0000-4000-8000-000000000004',
  '3d000000-0000-4000-8000-000000000001',
  '3b000000-0000-4000-8000-000000000001',
  null,
  'guest',
  '3c000000-0000-4000-8000-000000000002',
  'Read Guest',
  'Player',
  'playing',
  8.00
);

select * into temporary table member_score
from public.set_round_participant_score(
  '3a000000-0000-4000-8000-000000000002',
  '3e000000-0000-4000-8000-000000000001',
  '{"golf_points":20}'::jsonb,
  0,
  '3f000000-0000-4000-8000-000000000001',
  'mobile', null, now(),
  '3f000000-0000-4000-8000-000000000011',
  '3f000000-0000-4000-8000-000000000021'
);

select * into temporary table read_as_member
from public.read_live_round_scores(
  '3a000000-0000-4000-8000-000000000002',
  '3d000000-0000-4000-8000-000000000001'
);
select is((select count(*) from read_as_member), 4::bigint, 'member receives the live roster projection');
select is((select score_version from read_as_member where participant_id = '3e000000-0000-4000-8000-000000000001'), 1::bigint, 'read exposes the current score version');
select is((select golf_points::numeric from read_as_member where participant_id = '3e000000-0000-4000-8000-000000000001'), 20.00::numeric, 'read exposes confirmed authored points');
select is((select plus_minus::numeric from read_as_member where participant_id = '3e000000-0000-4000-8000-000000000001'), 5.00::numeric, 'read exposes server-derived plus/minus');
select is((select can_edit from read_as_member where participant_id = '3e000000-0000-4000-8000-000000000001'), true, 'member can edit their own Playing participant');
select is((select can_edit from read_as_member where participant_id = '3e000000-0000-4000-8000-000000000002'), false, 'member cannot edit another participant');
select is((select can_edit from read_as_member where participant_id = '3e000000-0000-4000-8000-000000000004'), true, 'sponsor can edit their guest participant');
select is((select can_author_manual_merit from read_as_member where participant_id = '3e000000-0000-4000-8000-000000000001'), false, 'member cannot author manual merit');
select is((select enabled_final_total_fields from read_as_member limit 1), '{"golf_points": true, "gross_score": true, "net_score": true}'::jsonb, 'read exposes the immutable field capability snapshot');
select throws_ok(
  $$ select * from public.read_live_round_scores('3a000000-0000-4000-8000-000000000005', '3d000000-0000-4000-8000-000000000001') $$,
  'P0002', 'round_not_found', 'same-group members excluded from a round cannot read its live scores'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '3a000000-0000-4000-8000-000000000005', true);
select is(
  (select count(*) from public.participant_score_projections),
  0::bigint,
  'same-group excluded members cannot subscribe to the live score projection'
);
reset role;

select * into temporary table read_as_admin
from public.read_live_round_scores(
  '3a000000-0000-4000-8000-000000000001',
  '3d000000-0000-4000-8000-000000000001'
);
select is((select can_edit from read_as_admin where participant_id = '3e000000-0000-4000-8000-000000000002'), true, 'administrator can edit another Playing participant');
select is((select can_author_manual_merit from read_as_admin where participant_id = '3e000000-0000-4000-8000-000000000002'), true, 'administrator may author manual merit');
select throws_ok(
  $$ select * from public.read_live_round_scores('3a000000-0000-4000-8000-000000000004', '3d000000-0000-4000-8000-000000000001') $$,
  'P0003', 'recovery_session_forbidden', 'recovery sessions cannot read live scores'
);
select throws_ok(
  $$ select * from public.read_live_round_scores('3a000000-0000-4000-8000-000000000002', '3d000000-0000-4000-8000-000000000002') $$,
  'P0001', 'round_scoring_locked', 'published rounds do not expose a live scorecard'
);

select * from finish();

rollback;
