begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

select has_function(
  'public',
  'read_member_next_round',
  array['uuid'],
  'member next-round read RPC exists'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.read_member_next_round(uuid)',
    'execute'
  ),
  'trusted server can execute the member next-round read RPC'
);
select ok(
  not has_function_privilege(
    'public',
    'public.read_member_next_round(uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.read_member_next_round(uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.read_member_next_round(uuid)',
    'execute'
  ),
  'client roles have no direct member next-round RPC grant'
);
select ok(
  not has_table_privilege('service_role', 'public.rounds', 'select')
  and not has_table_privilege('service_role', 'public.round_participants', 'select'),
  'service role has no direct access to round projection source tables'
);
select ok(
  (select prosecdef from pg_catalog.pg_proc where oid =
    'public.read_member_next_round(uuid)'::regprocedure)
  and (select proconfig = array['search_path=""'] from pg_catalog.pg_proc where oid =
    'public.read_member_next_round(uuid)'::regprocedure),
  'member next-round read is a pinned security-definer boundary'
);
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class where oid = 'public.rounds'::regclass)
  and (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class where oid = 'public.round_participants'::regclass)
  and (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class where oid = 'public.audit_events'::regclass),
  'projection source tables remain force-RLS protected'
);

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at
)
values
  ('4d000000-0000-4000-8000-000000000001', 'next-member-a@example.test', now(), false, false, now(), now()),
  ('4d000000-0000-4000-8000-000000000002', 'next-member-b@example.test', now(), false, false, now(), now()),
  ('4d000000-0000-4000-8000-000000000003', 'next-coordinator-a@example.test', now(), false, false, now(), now()),
  ('4d000000-0000-4000-8000-000000000004', 'next-member-other@example.test', now(), false, false, now(), now()),
  ('4d000000-0000-4000-8000-000000000005', 'next-recovery-a@example.test', now(), false, false, now(), now()),
  ('4d000000-0000-4000-8000-000000000006', 'next-inactive-a@example.test', now(), false, false, now(), now());

update auth.users
set raw_app_meta_data = '{"greenroster_password_recovery":true}'::jsonb
where id = '4d000000-0000-4000-8000-000000000005';

insert into public.user_profiles (user_id, first_name, last_name)
values
  ('4d000000-0000-4000-8000-000000000001', 'Next', 'Member A'),
  ('4d000000-0000-4000-8000-000000000002', 'Next', 'Member B'),
  ('4d000000-0000-4000-8000-000000000003', 'Next', 'Coordinator'),
  ('4d000000-0000-4000-8000-000000000004', 'Next', 'Other Group'),
  ('4d000000-0000-4000-8000-000000000005', 'Next', 'Recovery'),
  ('4d000000-0000-4000-8000-000000000006', 'Next', 'Inactive');

insert into public.groups (id, name, time_zone)
values
  ('4e000000-0000-4000-8000-000000000001', 'Next Group A', 'America/New_York'),
  ('4e000000-0000-4000-8000-000000000002', 'Next Group B', 'UTC');

insert into public.memberships (id, group_id, user_id, role, status, activated_at, inactivated_at)
values
  ('4f000000-0000-4000-8000-000000000001', '4e000000-0000-4000-8000-000000000001', '4d000000-0000-4000-8000-000000000001', 'member', 'active', now(), null),
  ('4f000000-0000-4000-8000-000000000002', '4e000000-0000-4000-8000-000000000001', '4d000000-0000-4000-8000-000000000002', 'member', 'active', now(), null),
  ('4f000000-0000-4000-8000-000000000003', '4e000000-0000-4000-8000-000000000001', '4d000000-0000-4000-8000-000000000003', 'coordinator', 'active', now(), null),
  ('4f000000-0000-4000-8000-000000000004', '4e000000-0000-4000-8000-000000000002', '4d000000-0000-4000-8000-000000000004', 'member', 'active', now(), null),
  ('4f000000-0000-4000-8000-000000000005', '4e000000-0000-4000-8000-000000000001', '4d000000-0000-4000-8000-000000000005', 'member', 'active', now(), null),
  ('4f000000-0000-4000-8000-000000000006', '4e000000-0000-4000-8000-000000000001', '4d000000-0000-4000-8000-000000000006', 'member', 'inactive', now(), now());

-- The source participant rows only require membership references for this
-- narrow projection test; no profile or quota snapshot is exposed.
insert into public.rounds (
  id, group_id, description, scheduled_at, group_time_zone, venue, notes,
  notes_visible_to_players, rsvp_deadline_at, format, state, version,
  published_at, created_by
)
values
  (
    '50000000-0000-4000-8000-000000000001',
    '4e000000-0000-4000-8000-000000000001',
    'Later Published Round', now() + interval '10 days', 'America/New_York',
    'South Course', 'Later notes', true, now() + interval '9 days',
    'individual_net', 'published', 2, now(),
    '4d000000-0000-4000-8000-000000000003'
  ),
  (
    '50000000-0000-4000-8000-000000000002',
    '4e000000-0000-4000-8000-000000000001',
    'Earlier Published Round', now() + interval '5 days', 'America/New_York',
    'North Course', 'Player-visible notes', true, now() + interval '4 days',
    'individual_gross', 'published', 3, now(),
    '4d000000-0000-4000-8000-000000000003'
  ),
  (
    '50000000-0000-4000-8000-000000000003',
    '4e000000-0000-4000-8000-000000000001',
    'Notes Hidden Round', now() + interval '20 days', 'America/New_York',
    'West Course', 'Private coordinator notes', false, now() + interval '19 days',
    'individual_gross', 'published', 4, now(),
    '4d000000-0000-4000-8000-000000000003'
  ),
  (
    '50000000-0000-4000-8000-000000000004',
    '4e000000-0000-4000-8000-000000000001',
    'Draft Round', now() + interval '1 day', 'America/New_York',
    'East Course', 'Draft notes', true, now(),
    'individual_gross', 'draft', 1, null,
    '4d000000-0000-4000-8000-000000000003'
  ),
  (
    '50000000-0000-4000-8000-000000000005',
    '4e000000-0000-4000-8000-000000000002',
    'Other Group Round', now() + interval '1 day', 'UTC',
    'Other Course', 'Other notes', true, now(),
    'individual_gross', 'published', 2, now(),
    '4d000000-0000-4000-8000-000000000004'
  );

insert into public.round_participants (
  id, round_id, group_id, membership_id, rsvp_status, version
)
values
  ('51000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', '4e000000-0000-4000-8000-000000000001', '4f000000-0000-4000-8000-000000000001', 'no_response', 1),
  ('51000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000002', '4e000000-0000-4000-8000-000000000001', '4f000000-0000-4000-8000-000000000001', 'playing', 4),
  ('51000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000003', '4e000000-0000-4000-8000-000000000001', '4f000000-0000-4000-8000-000000000001', 'not_playing', 2),
  ('51000000-0000-4000-8000-000000000004', '50000000-0000-4000-8000-000000000002', '4e000000-0000-4000-8000-000000000001', '4f000000-0000-4000-8000-000000000002', 'playing', 1);

insert into public.audit_events (
  id, group_id, actor_user_id, action, target_type, target_id, target_version,
  before_state, after_state, source, correlation_id, operation_id, occurred_at
)
values (
  '52000000-0000-4000-8000-000000000001',
  '4e000000-0000-4000-8000-000000000001',
  '4d000000-0000-4000-8000-000000000001',
  'round.participant_rsvp_changed', 'round_participant',
  '51000000-0000-4000-8000-000000000002', 4,
  '{"rsvp_status":"not_playing","participant_version":3}'::jsonb,
  '{"rsvp_status":"playing","participant_version":4,"changed_at":"2030-01-02T03:04:05+00:00"}'::jsonb,
  'member_web', '53000000-0000-4000-8000-000000000001',
  '54000000-0000-4000-8000-000000000001', now()
);

create temporary table member_next_round_result as
select public.read_member_next_round(
  '4d000000-0000-4000-8000-000000000001'
) as payload;

select is(
  (select payload ->> 'round_id' from member_next_round_result),
  '50000000-0000-4000-8000-000000000002',
  'member receives the earliest upcoming Published round with own participant'
);
select is(
  (select payload ->> 'group_id' from member_next_round_result),
  '4e000000-0000-4000-8000-000000000001',
  'projection resolves tenant from member membership'
);
select is(
  (select payload ->> 'description' from member_next_round_result),
  'Earlier Published Round',
  'description is returned'
);
select is(
  (
    (select payload ->> 'scheduled_at' from member_next_round_result)::timestamptz
  ),
  now() + interval '5 days',
  'scheduled UTC instant is returned'
);
select is(
  (select payload ->> 'group_time_zone' from member_next_round_result),
  'America/New_York',
  'snapshotted group time zone is returned'
);
select is(
  (select payload ->> 'venue' from member_next_round_result),
  'North Course',
  'venue is returned'
);
select is(
  (select payload ->> 'notes' from member_next_round_result),
  'Player-visible notes',
  'player-visible notes are returned'
);
select is(
  (select payload ->> 'format' from member_next_round_result),
  'individual_gross',
  'format is returned'
);
select is(
  (
    (select payload ->> 'rsvp_deadline_at' from member_next_round_result)::timestamptz
  ),
  now() + interval '4 days',
  'RSVP deadline is returned'
);
select is(
  (select payload -> 'participant' ->> 'rsvp_status' from member_next_round_result),
  'playing',
  'own RSVP state is returned'
);
select is(
  (select payload -> 'participant' ->> 'version' from member_next_round_result),
  '4',
  'own participant version is returned'
);
select is(
  (select payload -> 'participant' ->> 'changed_at' from member_next_round_result),
  '2030-01-02T03:04:05+00:00',
  'latest RSVP changed timestamp is returned from the audit boundary'
);
select ok(
  not ((select payload ? 'notes_visible_to_players' from member_next_round_result))
  and not ((select payload ? 'round_url' from member_next_round_result))
  and not ((select payload ? 'state' from member_next_round_result)),
  'projection excludes non-member-web fields'
);

-- A round with hidden notes is not selected while an earlier eligible round
-- exists; after removing that earlier participant, hidden notes are nulled.
update public.rounds
set scheduled_at = now() + interval '10 days',
    rsvp_deadline_at = now() + interval '9 days'
where id = '50000000-0000-4000-8000-000000000003';
delete from public.round_participants
where id = '51000000-0000-4000-8000-000000000002';
select is(
  (
    public.read_member_next_round('4d000000-0000-4000-8000-000000000001')
      ->> 'round_id'
  ),
  '50000000-0000-4000-8000-000000000001',
  'equal scheduled instants use immutable round id as deterministic tie-breaker'
);
delete from public.round_participants
where id = '51000000-0000-4000-8000-000000000001';
select is(
  (
    public.read_member_next_round('4d000000-0000-4000-8000-000000000001')
      ->> 'round_id'
  ),
  '50000000-0000-4000-8000-000000000003',
  'next eligible round advances deterministically when the earlier participant is absent'
);
select is(
  (
    public.read_member_next_round('4d000000-0000-4000-8000-000000000001')
      ->> 'notes'
  ),
  null,
  'notes hidden from players are returned as null'
);

-- No upcoming Published participant returns a neutral NULL projection.
delete from public.round_participants
where id = '51000000-0000-4000-8000-000000000003';
select is(
  public.read_member_next_round('4d000000-0000-4000-8000-000000000001'),
  null::jsonb,
  'no eligible Published round returns no projection'
);

select throws_ok(
  $$ select public.read_member_next_round(
    '4d000000-0000-4000-8000-000000000003'
  ) $$,
  'P0003',
  'actor_not_authorized',
  'coordinators are denied and directed to the portal boundary'
);
select throws_ok(
  $$ select public.read_member_next_round(
    '4d000000-0000-4000-8000-000000000005'
  ) $$,
  'P0003',
  'recovery_session_forbidden',
  'password-recovery sessions cannot read member data'
);
select throws_ok(
  $$ select public.read_member_next_round(
    '4d000000-0000-4000-8000-000000000006'
  ) $$,
  'P0003',
  'actor_not_authorized',
  'inactive memberships are denied'
);
select throws_ok(
  $$ select public.read_member_next_round(null) $$,
  '22004',
  'member_next_round_context_required',
  'missing actor identity is rejected'
);

-- The other group has a Published round, but its member cannot see it via a
-- different actor: each actor resolves only their own membership tenant.
select is(
  public.read_member_next_round('4d000000-0000-4000-8000-000000000004'),
  null::jsonb,
  'a member with no own participant receives no cross-group projection'
);

select * from finish();
rollback;
