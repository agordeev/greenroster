begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

select has_function(
  'public',
  'preview_published_round_edit',
  array['uuid', 'uuid', 'text', 'text', 'text', 'text', 'text', 'boolean', 'text', 'bigint'],
  'published round edit preview RPC exists'
);
select has_function(
  'public',
  'update_published_round_edit',
  array['uuid', 'uuid', 'text', 'text', 'text', 'text', 'text', 'boolean', 'text', 'bigint', 'text', 'boolean', 'uuid', 'uuid'],
  'published round edit apply RPC exists'
);
select has_function(
  'public',
  'claim_round_details_changed_email',
  array['uuid', 'timestamp with time zone'],
  'published round details e-mail claim RPC exists'
);
select ok(
  has_function_privilege('service_role', 'public.preview_published_round_edit(uuid,uuid,text,text,text,text,text,boolean,text,bigint)', 'execute')
  and has_function_privilege('service_role', 'public.update_published_round_edit(uuid,uuid,text,text,text,text,text,boolean,text,bigint,text,boolean,uuid,uuid)', 'execute')
  and has_function_privilege('service_role', 'public.claim_round_details_changed_email(uuid,timestamptz)', 'execute'),
  'trusted server can execute all published-edit RPCs'
);
select ok(
  not has_function_privilege('public', 'public.preview_published_round_edit(uuid,uuid,text,text,text,text,text,boolean,text,bigint)', 'execute')
  and not has_function_privilege('anon', 'public.update_published_round_edit(uuid,uuid,text,text,text,text,text,boolean,text,bigint,text,boolean,uuid,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.claim_round_details_changed_email(uuid,timestamptz)', 'execute'),
  'client roles have no published-edit or claim RPC grants'
);
select ok(
  (select prosecdef and proconfig = array['search_path=""']
   from pg_catalog.pg_proc
   where oid = 'public.update_published_round_edit(uuid,uuid,text,text,text,text,text,boolean,text,bigint,text,boolean,uuid,uuid)'::regprocedure)
  and not has_table_privilege('service_role', 'public.rounds', 'select')
  and not has_table_privilege('service_role', 'public.round_participants', 'select'),
  'published edit is a pinned security-definer boundary without direct source grants'
);

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at
)
values
  ('31000000-0000-4000-8000-000000000001', 'edit-admin@example.test', now(), false, false, now(), now()),
  ('31000000-0000-4000-8000-000000000002', 'edit-coordinator@example.test', now(), false, false, now(), now()),
  ('31000000-0000-4000-8000-000000000003', 'edit-member@example.test', now(), false, false, now(), now()),
  ('31000000-0000-4000-8000-000000000004', 'edit-other@example.test', now(), false, false, now(), now()),
  ('31000000-0000-4000-8000-000000000005', 'edit-recovery@example.test', now(), false, false, now(), now());

update auth.users
set raw_app_meta_data = '{"greenroster_password_recovery":true}'::jsonb
where id = '31000000-0000-4000-8000-000000000005';

insert into public.user_profiles (user_id, first_name, last_name)
values
  ('31000000-0000-4000-8000-000000000001', 'Edit', 'Admin'),
  ('31000000-0000-4000-8000-000000000002', 'Edit', 'Coordinator'),
  ('31000000-0000-4000-8000-000000000003', 'Edit', 'Member'),
  ('31000000-0000-4000-8000-000000000004', 'Edit', 'Other'),
  ('31000000-0000-4000-8000-000000000005', 'Edit', 'Recovery');

insert into public.groups (id, name, time_zone)
values
  ('32000000-0000-4000-8000-000000000001', 'Edit Group A', 'America/New_York'),
  ('32000000-0000-4000-8000-000000000002', 'Edit Group B', 'UTC');

insert into public.memberships (id, group_id, user_id, role, status, activated_at)
values
  ('33000000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001', 'administrator', 'active', now()),
  ('33000000-0000-4000-8000-000000000002', '32000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000002', 'coordinator', 'active', now()),
  ('33000000-0000-4000-8000-000000000003', '32000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000003', 'member', 'active', now()),
  ('33000000-0000-4000-8000-000000000004', '32000000-0000-4000-8000-000000000002', '31000000-0000-4000-8000-000000000004', 'administrator', 'active', now()),
  ('33000000-0000-4000-8000-000000000005', '32000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000005', 'administrator', 'active', now());

insert into public.membership_golfer_profiles (membership_id, group_id, first_name, last_name, tee_location)
values
  ('33000000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000001', 'Edit', 'Admin', 'middle'),
  ('33000000-0000-4000-8000-000000000002', '32000000-0000-4000-8000-000000000001', 'Edit', 'Coordinator', 'back'),
  ('33000000-0000-4000-8000-000000000003', '32000000-0000-4000-8000-000000000001', 'Edit', 'Member', 'front');

insert into public.rounds (
  id, group_id, description, scheduled_at, group_time_zone, venue, round_url,
  notes, notes_visible_to_players, rsvp_deadline_at, format, state, version, published_at, created_by
)
values (
  '34000000-0000-4000-8000-000000000001',
  '32000000-0000-4000-8000-000000000001',
  'Published edit round',
  '2026-08-15 13:30:00+00',
  'America/New_York',
  'North Course',
  'https://example.test/round/edit',
  'Bring a cart.', true,
  '2026-08-14 13:30:00+00',
  'individual_net', 'published', 4,
  '2026-08-03 12:00:00+00',
  '31000000-0000-4000-8000-000000000001'
);

insert into public.round_rule_snapshots (
  round_id, group_id, format, quota_method, moving_average_history_length,
  quota_precision, quota_rounding_rule, adjustment_bands, settings_version
)
values (
  '34000000-0000-4000-8000-000000000001',
  '32000000-0000-4000-8000-000000000001',
  'individual_net', 'moving_average', 10, 1,
  'half_away_from_zero', '[]'::jsonb, 1
);

insert into public.round_participants (
  id, round_id, group_id, membership_id, rsvp_status,
  quota_snapshot, quota_snapshot_source, handicap_snapshot,
  handicap_snapshot_source, handicap_snapshot_as_of, tee_snapshot
)
values
  ('35000000-0000-4000-8000-000000000001', '34000000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000001', '33000000-0000-4000-8000-000000000001', 'playing', 12.3, '{"source":"test"}', 8.7, 'manual', '2026-08-01', 'middle'),
  ('35000000-0000-4000-8000-000000000002', '34000000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000001', '33000000-0000-4000-8000-000000000003', 'no_response', 10.5, '{"source":"test"}', null, null, null, 'front');

select throws_ok(
  $$ select public.preview_published_round_edit(
    '31000000-0000-4000-8000-000000000003', '34000000-0000-4000-8000-000000000001',
    'Edited', '2026-08-15T10:30', 'South Course', 'https://example.test/round/edit',
    'Bring a cart.', true, '2026-08-14T10:30', 4
  ) $$,
  'P0003', 'actor_not_authorized',
  'ordinary members cannot preview published edits'
);
select throws_ok(
  $$ select public.preview_published_round_edit(
    '31000000-0000-4000-8000-000000000004', '34000000-0000-4000-8000-000000000001',
    'Edited', '2026-08-15T10:30', 'South Course', 'https://example.test/round/edit',
    'Bring a cart.', true, '2026-08-14T10:30', 4
  ) $$,
  'P0002', 'round_not_found',
  'cross-tenant administrators cannot preview another group round'
);
select throws_ok(
  $$ select public.preview_published_round_edit(
    '31000000-0000-4000-8000-000000000005', '34000000-0000-4000-8000-000000000001',
    'Edited', '2026-08-15T10:30', 'South Course', 'https://example.test/round/edit',
    'Bring a cart.', true, '2026-08-14T10:30', 4
  ) $$,
  'P0003', 'actor_not_authorized',
  'recovery sessions cannot preview published edits'
);

create temporary table edit_preview as
select public.preview_published_round_edit(
  '31000000-0000-4000-8000-000000000002',
  '34000000-0000-4000-8000-000000000001',
  'Edited published round',
  '2026-08-15T11:30',
  'South Course',
  'https://example.test/round/edit',
  'Bring a cart.',
  true,
  '2026-08-14T11:30',
  4
) as payload;

select is((select payload ->> 'current_version' from edit_preview), '4', 'preview returns the current round version');
select is((select payload -> 'changed_fields' from edit_preview), '["description", "scheduled_at", "venue", "rsvp_deadline_at"]'::jsonb, 'preview lists deterministic changed fields');
select is((select payload -> 'material_categories' from edit_preview), '["time"]'::jsonb, 'schedule changes are categorized as time impact');
select is((select payload ->> 'affected_participant_count' from edit_preview), '2', 'time impact reports every existing participant');
select ok((select (payload ->> 'impact_fingerprint') ~ '^[0-9a-f]{64}$' from edit_preview), 'preview returns a server fingerprint');
select ok((select payload -> 'scoring_consequences' ->> 0 like '%immutable%' from edit_preview), 'preview states that immutable snapshots remain unchanged');
select is((select jsonb_array_length(payload -> 'affected_participants') from edit_preview), 2, 'preview includes affected participant identities and RSVP states');

select throws_ok(
  $$ select public.update_published_round_edit(
    '31000000-0000-4000-8000-000000000002', '34000000-0000-4000-8000-000000000001',
    'Edited published round', '2026-08-15T11:30', 'South Course', 'https://example.test/round/edit',
    'Bring a cart.', true, '2026-08-14T11:30', 3,
    (select payload ->> 'impact_fingerprint' from edit_preview), true,
    '36000000-0000-4000-8000-000000000001', '37000000-0000-4000-8000-000000000001'
  ) $$,
  '40001', 'round_version_changed',
  'stale published edit versions are rejected'
);

create temporary table edit_receipt as
select public.update_published_round_edit(
  '31000000-0000-4000-8000-000000000002',
  '34000000-0000-4000-8000-000000000001',
  'Edited published round',
  '2026-08-15T11:30',
  'South Course',
  'https://example.test/round/edit',
  'Bring a cart.',
  true,
  '2026-08-14T11:30',
  4,
  (select payload ->> 'impact_fingerprint' from edit_preview),
  true,
  '36000000-0000-4000-8000-000000000001',
  '37000000-0000-4000-8000-000000000001'
) as payload;

select is((select payload ->> 'current_version' from edit_receipt), '5', 'apply increments the round version exactly once');
select is((select payload ->> 'announce' from edit_receipt), 'true', 'apply records the coordinator announcement decision');
select is((select payload ->> 'notification_count' from edit_receipt), '2', 'announce queues one e-mail per active participant');
select is((select description from public.rounds where id = '34000000-0000-4000-8000-000000000001'), 'Edited published round', 'apply updates the permitted description field');
select is((select version from public.rounds where id = '34000000-0000-4000-8000-000000000001'), 5::bigint, 'stored round version matches the receipt');
select is((select quota_snapshot::text from public.round_participants where id = '35000000-0000-4000-8000-000000000001'), '12.3', 'apply preserves participant quota snapshots');
select is((select quota_snapshot::text from public.round_participants where id = '35000000-0000-4000-8000-000000000002'), '10.5', 'apply preserves every participant snapshot');
select is((select format::text from public.round_rule_snapshots where round_id = '34000000-0000-4000-8000-000000000001'), 'individual_net', 'apply preserves the immutable rule snapshot');
select is((select count(*) from public.notification_outbox_jobs where event_type = 'round.details_changed' and aggregate_id = '34000000-0000-4000-8000-000000000001'), 2::bigint, 'announce creates one outbox job per participant');
select is((select count(*) from public.notification_deliveries as delivery join public.notification_outbox_jobs as jobs on jobs.id = delivery.outbox_job_id where jobs.event_type = 'round.details_changed' and jobs.aggregate_id = '34000000-0000-4000-8000-000000000001'), 2::bigint, 'announce creates one e-mail delivery per participant');
select is((select count(*) from public.audit_events where action = 'round.details_changed' and target_id = '34000000-0000-4000-8000-000000000001'), 1::bigint, 'apply writes one audit event');

select is(
  public.update_published_round_edit(
    '31000000-0000-4000-8000-000000000002', '34000000-0000-4000-8000-000000000001',
    'Edited published round', '2026-08-15T11:30', 'South Course', 'https://example.test/round/edit',
    'Bring a cart.', true, '2026-08-14T11:30', 4,
    (select payload ->> 'impact_fingerprint' from edit_preview), true,
    '36000000-0000-4000-8000-000000000001', '37000000-0000-4000-8000-000000000001'
  ),
  (select payload from edit_receipt),
  'exact operation retry returns the original receipt without duplicate work'
);
select throws_ok(
  $$ select public.update_published_round_edit(
    '31000000-0000-4000-8000-000000000002', '34000000-0000-4000-8000-000000000001',
    'Different payload', '2026-08-15T11:30', 'South Course', 'https://example.test/round/edit',
    'Bring a cart.', true, '2026-08-14T11:30', 5,
    (select payload ->> 'impact_fingerprint' from edit_preview), true,
    '36000000-0000-4000-8000-000000000001', '37000000-0000-4000-8000-000000000001'
  ) $$,
  '23505', 'operation_id_reused',
  'reusing an operation id with a different payload is rejected'
);

create temporary table edit_preview_no_announce as
select public.preview_published_round_edit(
  '31000000-0000-4000-8000-000000000002',
  '34000000-0000-4000-8000-000000000001',
  'Edited published round',
  '2026-08-15T11:30',
  'West Course',
  'https://example.test/round/edit',
  'Bring a cart.',
  true,
  '2026-08-14T11:30',
  5
) as payload;
select is(
  public.update_published_round_edit(
    '31000000-0000-4000-8000-000000000002', '34000000-0000-4000-8000-000000000001',
    'Edited published round', '2026-08-15T11:30', 'West Course', 'https://example.test/round/edit',
    'Bring a cart.', true, '2026-08-14T11:30', 5,
    (select payload ->> 'impact_fingerprint' from edit_preview_no_announce), false,
    '36000000-0000-4000-8000-000000000002', '37000000-0000-4000-8000-000000000002'
  ) ->> 'notification_count',
  '0',
  'announce false applies the edit without queueing e-mail'
);
select is((select count(*) from public.notification_outbox_jobs where event_type = 'round.details_changed' and aggregate_id = '34000000-0000-4000-8000-000000000001'), 2::bigint, 'announce false does not add outbox work');

select throws_ok(
  $$ select public.preview_published_round_edit(
    '31000000-0000-4000-8000-000000000002', '34000000-0000-4000-8000-000000000001',
    'Edited published round', '2026-08-15T11:30', 'West Course', 'https://example.test/round/edit',
    'Bring a cart.', true, '2026-08-14T11:30', 4
  ) $$,
  '40001', 'round_version_changed',
  'preview cannot use a stale version after an edit'
);

select throws_ok(
  $$ select * from public.claim_round_details_changed_email(
    '38000000-0000-4000-8000-000000000001',
    now() + interval '1 minute'
  ) $$,
  '22023', 'delivery_stale_boundary_invalid',
  'claim rejects a future stale boundary'
);
create temporary table claimed_detail_email as
select * from public.claim_round_details_changed_email(
  '38000000-0000-4000-8000-000000000001',
  now() - interval '1 minute'
);
select is((select count(*) from claimed_detail_email), 1::bigint, 'claim returns one due details delivery');
select is((select round_description from claimed_detail_email), 'Edited published round', 'claim returns the server round description');
select is((select state::text from public.notification_deliveries where id = (select delivery_id from claimed_detail_email)), 'sending', 'claim leases the delivery');
select is((select state::text from public.notification_outbox_jobs where id = (select outbox_job_id from claimed_detail_email)), 'processing', 'claim leases the outbox job');

select * from finish();
rollback;
