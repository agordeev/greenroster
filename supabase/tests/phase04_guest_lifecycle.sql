begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

select has_function(
  'public',
  'create_round_guest',
  array['uuid','uuid','uuid','text','text','app.quota_value','app.handicap_value','text','text','uuid','uuid'],
  'guest creation RPC exists'
);
select has_function(
  'public',
  'update_round_guest',
  array['uuid','uuid','text','text','app.quota_value','app.handicap_value','text','bigint','text','text','uuid','uuid'],
  'guest edit RPC exists'
);
select has_function(
  'public',
  'withdraw_round_guest',
  array['uuid','uuid','uuid','bigint','boolean','text','text','uuid','uuid'],
  'guest withdrawal RPC exists'
);
select ok(
  has_function_privilege('service_role', 'public.create_round_guest(uuid,uuid,uuid,text,text,app.quota_value,app.handicap_value,text,text,uuid,uuid)', 'execute')
  and has_function_privilege('service_role', 'public.update_round_guest(uuid,uuid,text,text,app.quota_value,app.handicap_value,text,bigint,text,text,uuid,uuid)', 'execute')
  and has_function_privilege('service_role', 'public.withdraw_round_guest(uuid,uuid,uuid,bigint,boolean,text,text,uuid,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.create_round_guest(uuid,uuid,uuid,text,text,app.quota_value,app.handicap_value,text,text,uuid,uuid)', 'execute'),
  'guest mutations are service-only'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid = 'public.round_participants'::regclass),
  'guest participants remain force-RLS protected'
);

insert into auth.users (id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at)
values
  ('e1000000-0000-4000-8000-000000000001', 'guest-life-admin@example.test', now(), false, false, now(), now()),
  ('e1000000-0000-4000-8000-000000000002', 'guest-life-coordinator@example.test', now(), false, false, now(), now()),
  ('e1000000-0000-4000-8000-000000000003', 'guest-life-member@example.test', now(), false, false, now(), now()),
  ('e1000000-0000-4000-8000-000000000004', 'guest-life-other@example.test', now(), false, false, now(), now());
insert into public.user_profiles (user_id, first_name, last_name)
values
  ('e1000000-0000-4000-8000-000000000001', 'Guest Life', 'Admin'),
  ('e1000000-0000-4000-8000-000000000002', 'Guest Life', 'Coordinator'),
  ('e1000000-0000-4000-8000-000000000003', 'Guest Life', 'Member'),
  ('e1000000-0000-4000-8000-000000000004', 'Guest Life', 'Other');
insert into public.groups (id, name, time_zone, allow_member_guests)
values ('e2000000-0000-4000-8000-000000000001', 'Guest lifecycle group', 'UTC', true);
insert into public.memberships (id, group_id, user_id, role, status, activated_at)
values
  ('e3000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'administrator', 'active', now()),
  ('e3000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002', 'coordinator', 'active', now()),
  ('e3000000-0000-4000-8000-000000000003', 'e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000003', 'member', 'active', now()),
  ('e3000000-0000-4000-8000-000000000004', 'e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000004', 'member', 'active', now());
insert into public.membership_golfer_profiles (membership_id, group_id, first_name, last_name, tee_location)
values
  ('e3000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'Guest Life', 'Admin', 'middle'),
  ('e3000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000001', 'Guest Life', 'Coordinator', 'middle'),
  ('e3000000-0000-4000-8000-000000000003', 'e2000000-0000-4000-8000-000000000001', 'Guest Life', 'Member', 'middle'),
  ('e3000000-0000-4000-8000-000000000004', 'e2000000-0000-4000-8000-000000000001', 'Guest Life', 'Other', 'middle');
insert into public.rounds (
  id, group_id, description, scheduled_at, group_time_zone, format, state,
  version, published_at, created_by
)
values (
  'e4000000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  'Guest lifecycle round', now() + interval '2 hours', 'UTC',
  'individual_net', 'published', 1, now(),
  'e1000000-0000-4000-8000-000000000001'
);
insert into public.round_rule_snapshots (round_id, group_id, format, settings_version)
values (
  'e4000000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  'individual_net', 0
);
insert into public.round_participants (id, round_id, group_id, membership_id, rsvp_status, quota_snapshot)
values (
  'e5000000-0000-4000-8000-000000000001',
  'e4000000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  'e3000000-0000-4000-8000-000000000003',
  'playing', 20
);

create temporary table guest_created as
select * from public.create_round_guest(
  'e1000000-0000-4000-8000-000000000003',
  'e4000000-0000-4000-8000-000000000001',
  null,
  '  Pat', 'Player', 18.50, 12.3, 'middle', 'mobile',
  'e6000000-0000-4000-8000-000000000001',
  'e7000000-0000-4000-8000-000000000001'
);
select is((select participant_kind from guest_created), 'guest'::public.round_participant_kind, 'creation inserts a guest participant');
select is((select rsvp_status from guest_created), 'playing'::public.round_rsvp_status, 'creation starts the guest Playing');
select is((select sponsor_membership_id::uuid from guest_created), 'e3000000-0000-4000-8000-000000000003'::uuid, 'creation derives the sponsor from the actor');
select is((select quota_snapshot::numeric from guest_created), 18.50::numeric, 'guest quota preserves exact decimal input');
select is((select handicap_snapshot_source from guest_created), 'manual'::public.member_handicap_source, 'guest handicap provenance is server-authored');
select ok((select quota_snapshot_source ->> 'source' = 'guest_input' from guest_created), 'guest quota provenance identifies guest input');
select is((select duplicate_like from guest_created), false, 'first guest has no duplicate warning');
select is((select count(*) from public.audit_events where operation_id = 'e7000000-0000-4000-8000-000000000001'), 2::bigint, 'creation writes guest and RSVP audit events');
select is((select count(*) from public.memberships where id = (select participant_id from guest_created)), 0::bigint, 'guest creation never creates membership');

create temporary table guest_retry as
select * from public.create_round_guest(
  'e1000000-0000-4000-8000-000000000003',
  'e4000000-0000-4000-8000-000000000001',
  null,
  'Pat', 'Player', 18.50, 12.3, 'middle', 'mobile',
  'e6990000-0000-4000-8000-000000000001',
  'e7000000-0000-4000-8000-000000000001'
);
select is((select participant_id from guest_retry), (select participant_id from guest_created), 'create retry returns original guest');
select is((select count(*) from public.round_participants where participant_kind = 'guest'), 1::bigint, 'create retry is idempotent');
select throws_ok(
  $$ select * from public.create_round_guest(
    'e1000000-0000-4000-8000-000000000003', 'e4000000-0000-4000-8000-000000000001', null,
    'Other', 'Guest', 18.50, 12.3, 'middle', 'mobile',
    'e6990000-0000-4000-8000-000000000002', 'e7000000-0000-4000-8000-000000000001'
  ) $$,
  '23505', 'operation_id_reused', 'create operation reuse with a different request is rejected'
);

create temporary table guest_updated as
select * from public.update_round_guest(
  'e1000000-0000-4000-8000-000000000003',
  (select participant_id from guest_created),
  'Patricia', 'Player', 18.50, 12.3, 'back', 1, null, 'mobile',
  'e6000000-0000-4000-8000-000000000002',
  'e7000000-0000-4000-8000-000000000002'
);
select is((select first_name from guest_updated), 'Patricia', 'sponsor can edit a guest before the round is live');
select is((select version from guest_updated), 2::bigint, 'guest edit advances participant version');
select is((select count(*) from public.audit_events where action = 'round.guest_updated'), 1::bigint, 'guest edit writes an audit event');

update public.rounds set state = 'live' where id = 'e4000000-0000-4000-8000-000000000001';
select throws_ok(
  $$ select * from public.update_round_guest(
    'e1000000-0000-4000-8000-000000000003',
    (select participant_id from guest_created), 'Pat', 'Player', 18.50, 12.3, 'back', 2,
    null, 'mobile', 'e6000000-0000-4000-8000-000000000003', 'e7000000-0000-4000-8000-000000000003'
  ) $$,
  'P0003', 'guest_actor_not_authorized', 'sponsor cannot edit after scoring opens'
);

create temporary table guest_score as
select * from public.set_round_participant_score(
  'e1000000-0000-4000-8000-000000000003',
  (select participant_id from guest_created),
  '{"golf_points": 23.00}'::jsonb, 0,
  'e8000000-0000-4000-8000-000000000001', 'mobile', null,
  '2026-08-10T00:00:00Z'::timestamptz,
  'e6000000-0000-4000-8000-000000000004',
  'e7000000-0000-4000-8000-000000000004'
);
select is((select plus_minus::numeric from guest_score), 4.50::numeric, 'sponsor can score a Playing guest with the snapshot quota');

select throws_ok(
  $$ select * from public.withdraw_round_guest(
    'e1000000-0000-4000-8000-000000000003', 'e4000000-0000-4000-8000-000000000001',
    (select participant_id from guest_created), 2, true, 'Guest changed plans', 'mobile',
    'e6000000-0000-4000-8000-000000000005', 'e7000000-0000-4000-8000-000000000005'
  ) $$,
  'P0003', 'guest_actor_not_authorized', 'sponsor cannot withdraw once the round is live'
);
create temporary table guest_withdrawn as
select * from public.withdraw_round_guest(
  'e1000000-0000-4000-8000-000000000002', 'e4000000-0000-4000-8000-000000000001',
  (select participant_id from guest_created), 2, true, 'Guest changed plans', 'portal',
  'e6000000-0000-4000-8000-000000000006', 'e7000000-0000-4000-8000-000000000006'
);
select is((select rsvp_status from guest_withdrawn), 'not_playing'::public.round_rsvp_status, 'coordinator withdrawal changes RSVP state');
select is((select score_invalidated from guest_withdrawn), true, 'coordinator withdrawal invalidates the current score projection');
select is((select count(*) from public.participant_score_projections where participant_id = (select participant_id from guest_created)), 0::bigint, 'withdrawal removes only the current score projection');
select is((select count(*) from public.score_revisions where participant_id = (select participant_id from guest_created)), 1::bigint, 'withdrawal preserves immutable score history');
select is((select count(*) from public.audit_events where action = 'round.guest_withdrawn'), 1::bigint, 'withdrawal writes an audit event');

create temporary table guest_withdraw_retry as
select * from public.withdraw_round_guest(
  'e1000000-0000-4000-8000-000000000002', 'e4000000-0000-4000-8000-000000000001',
  (select participant_id from guest_created), 2, true, 'Guest changed plans', 'portal',
  'e6990000-0000-4000-8000-000000000006', 'e7000000-0000-4000-8000-000000000006'
);
select is((select score_invalidated from guest_withdraw_retry), true, 'withdrawal retry returns the original receipt');
select is((select count(*) from public.audit_events where action = 'round.guest_withdrawn'), 1::bigint, 'withdrawal retry is idempotent');

update public.rounds set state = 'completed' where id = 'e4000000-0000-4000-8000-000000000001';
select throws_ok(
  $$ select * from public.update_round_guest(
    'e1000000-0000-4000-8000-000000000002', (select participant_id from guest_created),
    'Locked', 'Guest', 18.50, 12.3, 'back', 3, 'Completed correction', 'portal',
    'e6000000-0000-4000-8000-000000000007', 'e7000000-0000-4000-8000-000000000007'
  ) $$,
  'P0001', 'round_guest_locked', 'completed rounds keep guest edits locked'
);

select * from finish();
rollback;
