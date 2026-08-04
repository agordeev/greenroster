begin;

create extension if not exists pgtap with schema extensions;

select plan(22);

select has_function(
  'public',
  'read_official_round_results',
  array['uuid', 'uuid'],
  'service official result read exists'
);
select ok(
  has_function_privilege('service_role', 'public.read_official_round_results(uuid,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.read_official_round_results(uuid,uuid)', 'execute')
  and not has_function_privilege('anon', 'public.read_official_round_results(uuid,uuid)', 'execute'),
  'service official result read is not directly exposed'
);
select has_function(
  'public',
  'read_mobile_official_round_results',
  array['uuid'],
  'authenticated mobile official result read exists'
);
select ok(
  has_function_privilege('authenticated', 'public.read_mobile_official_round_results(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.read_mobile_official_round_results(uuid)', 'execute'),
  'mobile official result read is authenticated-only'
);

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at
)
values
  ('e1000000-0000-4000-8000-000000000001', 'results-admin@example.test', now(), false, false, now(), now()),
  ('e1000000-0000-4000-8000-000000000002', 'results-member@example.test', now(), false, false, now(), now()),
  ('e1000000-0000-4000-8000-000000000003', 'results-nonparticipant@example.test', now(), false, false, now(), now());
insert into public.user_profiles (user_id, display_name, first_name, last_name)
values
  ('e1000000-0000-4000-8000-000000000001', 'Results Admin', 'Results', 'Admin'),
  ('e1000000-0000-4000-8000-000000000002', 'Results Member', 'Results', 'Member'),
  ('e1000000-0000-4000-8000-000000000003', 'Results Nonparticipant', 'Results', 'Nonparticipant');
insert into public.groups (id, name, time_zone)
values
  ('e2000000-0000-4000-8000-000000000001', 'Results Group', 'UTC'),
  ('e2000000-0000-4000-8000-000000000002', 'Other Results Group', 'UTC');
insert into public.memberships (
  id, group_id, user_id, role, status, activated_at
)
values
  ('e3000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'administrator', 'active', now()),
  ('e3000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002', 'member', 'active', now()),
  ('e3000000-0000-4000-8000-000000000003', 'e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000003', 'member', 'active', now());

insert into public.rounds (
  id, group_id, description, scheduled_at, group_time_zone, format, state,
  published_at, created_by, version
)
values
  ('e4000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'Official results round', now(), 'UTC', 'individual_net', 'completed', now(), 'e1000000-0000-4000-8000-000000000001', 2),
  ('e4000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000002', 'Other tenant round', now(), 'UTC', 'individual_net', 'completed', now(), 'e1000000-0000-4000-8000-000000000001', 2);
insert into public.round_participants (
  id, round_id, group_id, membership_id, participant_kind, sponsor_membership_id,
  guest_first_name, guest_last_name, rsvp_status, quota_snapshot
)
values
  ('e5000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000002', 'member', null, null, null, 'playing', 20),
  ('e5000000-0000-4000-8000-000000000002', 'e4000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', null, 'guest', 'e3000000-0000-4000-8000-000000000001', 'Guest', 'Golfer', 'playing', 5);
insert into public.score_revisions (
  id, group_id, round_id, participant_id, revision_number, base_version,
  device_operation_id, actor_user_id, source, client_changed_at, correlation_id,
  operation_id, changed_fields, golf_points, manual_merit, plus_minus, ranking_value,
  request_fingerprint
)
values
  ('e6000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000001', 1, 0, 'e7000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'portal', now(), 'e8000000-0000-4000-8000-000000000001', 'e9000000-0000-4000-8000-000000000001', '{"golf_points": true}', 40, 1, 20, 20, repeat('1', 64)),
  ('e6000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000002', 1, 0, 'e7000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000001', 'portal', now(), 'e8000000-0000-4000-8000-000000000002', 'e9000000-0000-4000-8000-000000000002', '{"golf_points": true}', 40, 0, 35, 20, repeat('2', 64));
insert into public.round_completion_runs (
  id, round_id, group_id, completion_number, state, completed_at, completed_by,
  round_version, correlation_id, operation_id
)
values (
  'ea000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 1, 'official', now(), 'e1000000-0000-4000-8000-000000000001', 2, 'eb000000-0000-4000-8000-000000000001', 'ec000000-0000-4000-8000-000000000001'
);
insert into public.round_official_results (
  completion_id, round_id, group_id, participant_id, participant_kind,
  membership_id, sponsor_membership_id, score_revision_id, golf_points,
  quota_snapshot, plus_minus, ranking_value, competition_rank,
  participation_merit, placement_merit, manual_merit, generated_merit, total_merit
)
values
  ('ea000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000001', 'member', 'e3000000-0000-4000-8000-000000000002', null, 'e6000000-0000-4000-8000-000000000001', 40, 20, 20, 20, 1, 2, 10, 1, 12, 13),
  ('ea000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000002', 'guest', null, 'e3000000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000002', 40, 5, 35, 20, 1, 0, 0, 0, 0, 0);

insert into public.audit_events (
  group_id, actor_user_id, action, target_type, target_id, target_version,
  after_state, source, correlation_id, operation_id
)
values (
  'e2000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000002',
  'round.participant_rsvp_changed',
  'round_participant',
  'e5000000-0000-4000-8000-000000000001',
  2,
  '{"changed_at":"2026-08-01T10:00:00Z","rsvp_status":"playing"}',
  'member_web',
  'ed000000-0000-4000-8000-000000000001',
  'ee000000-0000-4000-8000-000000000001'
);

create temporary table admin_results as
select * from public.read_official_round_results(
  'e1000000-0000-4000-8000-000000000001',
  'e4000000-0000-4000-8000-000000000001'
);
select is((select count(*) from admin_results), 2::bigint, 'administrator receives the complete current official result set');
select is((select completion_number from admin_results limit 1), 1::bigint, 'result rows expose the completion number');
select is((select participant_kind from admin_results order by participant_id limit 1), 'member'::public.round_participant_kind, 'member result is retained');
select is((select competition_rank from admin_results where participant_kind = 'guest'), 1::bigint, 'ties retain the explicit competition rank');
select is((select first_name from admin_results where participant_kind = 'member'), 'Results', 'member result resolves the current display name');
select is((select last_name from admin_results where participant_kind = 'guest'), 'Golfer', 'guest result resolves its round-scoped name');
select is((select total_merit from admin_results where participant_kind = 'member'), 13::numeric, 'member result exposes the total merit');
select is((select generated_merit::numeric from admin_results where participant_kind = 'member'), 12::numeric, 'member result exposes generated merit separately');
select is((select total_merit from admin_results where participant_kind = 'guest'), 0::numeric, 'guest result has no merit');
select is((select membership_id::uuid from admin_results where participant_kind = 'guest'), null::uuid, 'guest result has no permanent membership');
select is((select quota_snapshot::numeric from admin_results where participant_kind = 'member'), 20::numeric, 'result exposes the round quota snapshot');
select is((select plus_minus::numeric from admin_results where participant_kind = 'member'), 20::numeric, 'result exposes server plus-minus');
select is((select rsvp_changed_at from admin_results where participant_kind = 'member'), '2026-08-01T10:00:00Z'::app.utc_instant, 'result exposes the immutable RSVP change timestamp');
select is((select score_revision_id::uuid from admin_results where participant_kind = 'member'), 'e6000000-0000-4000-8000-000000000001'::uuid, 'result preserves score revision provenance');
create temporary table nonparticipant_results as
select * from public.read_official_round_results(
  'e1000000-0000-4000-8000-000000000003',
  'e4000000-0000-4000-8000-000000000001'
);
select is((select count(*) from nonparticipant_results), 2::bigint, 'an active group member can read results without participating in the round');
select throws_ok(
  $$ select * from public.read_official_round_results('e1000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000002') $$,
  'P0002', 'round_not_found', 'cross-tenant result reads are indistinguishable from missing rounds'
);

update public.round_completion_runs
set state = 'reopened', reopened_at = now(), reopened_by = 'e1000000-0000-4000-8000-000000000001', reopen_reason = 'read boundary test'
where id = 'ea000000-0000-4000-8000-000000000001';
update public.rounds
set state = 'live', version = 3
where id = 'e4000000-0000-4000-8000-000000000001';
select throws_ok(
  $$ select * from public.read_official_round_results('e1000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001') $$,
  'P0002', 'round_results_not_available', 'reopened rounds lose their official read surface'
);
select is((select count(*) from public.round_official_results where completion_id = 'ea000000-0000-4000-8000-000000000001'), 2::bigint, 'withdrawn snapshots remain retained for investigation');

select * from finish();

rollback;
