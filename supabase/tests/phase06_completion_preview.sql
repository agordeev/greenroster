begin;

create extension if not exists pgtap with schema extensions;

select plan(26);

select has_function(
  'public',
  'preview_live_round_completion',
  array['app.entity_id', 'app.entity_id'],
  'the read-only completion preview exists'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.preview_live_round_completion(app.entity_id,app.entity_id)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.preview_live_round_completion(app.entity_id,app.entity_id)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.preview_live_round_completion(app.entity_id,app.entity_id)',
    'execute'
  ),
  'only the trusted server can execute the completion preview'
);
select ok(
  (select prosecdef
      and provolatile = 's'
      and proconfig = array['search_path=""']
      and pg_catalog.pg_get_function_result(oid) = 'jsonb'
   from pg_catalog.pg_proc
   where oid = 'public.preview_live_round_completion(app.entity_id,app.entity_id)'::regprocedure),
  'completion preview is a stable security-definer JSON boundary'
);

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at
)
values
  ('8a000000-0000-4000-8000-000000000001', 'preview-admin-a@example.test', now(), false, false, now(), now()),
  ('8a000000-0000-4000-8000-000000000005', 'preview-admin-b@example.test', now(), false, false, now(), now());

insert into public.groups (id, name, time_zone)
values
  ('8b000000-0000-4000-8000-000000000001', 'Preview Group A', 'UTC'),
  ('8b000000-0000-4000-8000-000000000002', 'Preview Group B', 'UTC');

insert into public.memberships (id, group_id, user_id, role, status, activated_at)
values
  ('8c000000-0000-4000-8000-000000000001', '8b000000-0000-4000-8000-000000000001', '8a000000-0000-4000-8000-000000000001', 'administrator', 'active', now()),
  ('8c000000-0000-4000-8000-000000000002', '8b000000-0000-4000-8000-000000000001', null, 'member', 'pending', null),
  ('8c000000-0000-4000-8000-000000000003', '8b000000-0000-4000-8000-000000000001', null, 'member', 'pending', null),
  ('8c000000-0000-4000-8000-000000000004', '8b000000-0000-4000-8000-000000000001', null, 'member', 'pending', null),
  ('8c000000-0000-4000-8000-000000000005', '8b000000-0000-4000-8000-000000000002', '8a000000-0000-4000-8000-000000000005', 'administrator', 'active', now());

insert into public.group_quota_settings (
  group_id, method, moving_average_history_length, precision, rounding_rule,
  version, updated_by, participation_merit
)
values (
  '8b000000-0000-4000-8000-000000000001', 'moving_average', 4, 2,
  'half_away_from_zero', 1, '8a000000-0000-4000-8000-000000000001', 2
);

insert into public.placement_merit_rows (group_id, rank, merit_points)
values
  ('8b000000-0000-4000-8000-000000000001', 1, 10),
  ('8b000000-0000-4000-8000-000000000001', 3, 5);

insert into public.rounds (
  id, group_id, description, scheduled_at, group_time_zone, format, state,
  published_at, created_by
)
values
  ('8d000000-0000-4000-8000-000000000001', '8b000000-0000-4000-8000-000000000001', 'Preview Net', now(), 'UTC', 'individual_net', 'live', now(), '8a000000-0000-4000-8000-000000000001'),
  ('8d000000-0000-4000-8000-000000000002', '8b000000-0000-4000-8000-000000000001', 'Preview Gross', now(), 'UTC', 'individual_gross', 'live', now(), '8a000000-0000-4000-8000-000000000001'),
  ('8d000000-0000-4000-8000-000000000003', '8b000000-0000-4000-8000-000000000001', 'Preview Missing Snapshot', now(), 'UTC', 'individual_net', 'live', now(), '8a000000-0000-4000-8000-000000000001');

insert into public.round_rule_snapshots (
  round_id, group_id, format, quota_method, moving_average_history_length,
  quota_precision, quota_rounding_rule, adjustment_bands, settings_version
)
values
  ('8d000000-0000-4000-8000-000000000001', '8b000000-0000-4000-8000-000000000001', 'individual_net', 'moving_average', 4, 2, 'half_away_from_zero', '[]', 1),
  ('8d000000-0000-4000-8000-000000000002', '8b000000-0000-4000-8000-000000000001', 'individual_gross', 'moving_average', 4, 2, 'half_away_from_zero', '[]', 1);

insert into public.round_participants (
  id, round_id, group_id, membership_id, participant_kind, rsvp_status, quota_snapshot
)
values
  ('8e000000-0000-4000-8000-000000000001', '8d000000-0000-4000-8000-000000000001', '8b000000-0000-4000-8000-000000000001', '8c000000-0000-4000-8000-000000000002', 'member', 'playing', 10),
  ('8e000000-0000-4000-8000-000000000002', '8d000000-0000-4000-8000-000000000001', '8b000000-0000-4000-8000-000000000001', '8c000000-0000-4000-8000-000000000003', 'member', 'playing', 10),
  ('8e000000-0000-4000-8000-000000000003', '8d000000-0000-4000-8000-000000000001', '8b000000-0000-4000-8000-000000000001', '8c000000-0000-4000-8000-000000000004', 'member', 'playing', 10),
  ('8e000000-0000-4000-8000-000000000011', '8d000000-0000-4000-8000-000000000002', '8b000000-0000-4000-8000-000000000001', '8c000000-0000-4000-8000-000000000002', 'member', 'playing', null),
  ('8e000000-0000-4000-8000-000000000012', '8d000000-0000-4000-8000-000000000002', '8b000000-0000-4000-8000-000000000001', '8c000000-0000-4000-8000-000000000003', 'member', 'playing', null);

insert into public.round_participants (
  id, round_id, group_id, participant_kind, sponsor_membership_id,
  guest_first_name, guest_last_name, rsvp_status, quota_snapshot
)
values (
  '8e000000-0000-4000-8000-000000000004', '8d000000-0000-4000-8000-000000000001', '8b000000-0000-4000-8000-000000000001', 'guest', '8c000000-0000-4000-8000-000000000001', 'Preview', 'Guest', 'playing', 8
);

insert into public.score_revisions (
  id, group_id, round_id, participant_id, revision_number, base_version,
  device_operation_id, actor_user_id, source, client_changed_at, correlation_id,
  operation_id, changed_fields, golf_points, manual_merit, plus_minus,
  ranking_value, request_fingerprint
)
values
  ('8f000000-0000-4000-8000-000000000001', '8b000000-0000-4000-8000-000000000001', '8d000000-0000-4000-8000-000000000001', '8e000000-0000-4000-8000-000000000001', 1, 0, '90000000-0000-4000-8000-000000000001', '8a000000-0000-4000-8000-000000000001', 'portal', now(), '91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', '{"golf_points": true}', 20, 1.50, 10, 10, repeat('1', 64)),
  ('8f000000-0000-4000-8000-000000000002', '8b000000-0000-4000-8000-000000000001', '8d000000-0000-4000-8000-000000000001', '8e000000-0000-4000-8000-000000000002', 1, 0, '90000000-0000-4000-8000-000000000002', '8a000000-0000-4000-8000-000000000001', 'portal', now(), '91000000-0000-4000-8000-000000000002', '92000000-0000-4000-8000-000000000002', '{"golf_points": true}', 20, null, 10, 10, repeat('2', 64)),
  ('8f000000-0000-4000-8000-000000000003', '8b000000-0000-4000-8000-000000000001', '8d000000-0000-4000-8000-000000000001', '8e000000-0000-4000-8000-000000000003', 1, 0, '90000000-0000-4000-8000-000000000003', '8a000000-0000-4000-8000-000000000001', 'portal', now(), '91000000-0000-4000-8000-000000000003', '92000000-0000-4000-8000-000000000003', '{"golf_points": true}', 15, null, 5, 5, repeat('3', 64)),
  ('8f000000-0000-4000-8000-000000000004', '8b000000-0000-4000-8000-000000000001', '8d000000-0000-4000-8000-000000000001', '8e000000-0000-4000-8000-000000000004', 1, 0, '90000000-0000-4000-8000-000000000004', '8a000000-0000-4000-8000-000000000001', 'portal', now(), '91000000-0000-4000-8000-000000000004', '92000000-0000-4000-8000-000000000004', '{"golf_points": true}', 12, 7, 4, 4, repeat('4', 64)),
  ('8f000000-0000-4000-8000-000000000011', '8b000000-0000-4000-8000-000000000001', '8d000000-0000-4000-8000-000000000002', '8e000000-0000-4000-8000-000000000011', 1, 0, '90000000-0000-4000-8000-000000000011', '8a000000-0000-4000-8000-000000000001', 'portal', now(), '91000000-0000-4000-8000-000000000011', '92000000-0000-4000-8000-000000000011', '{"golf_points": true}', 30, null, null, 30, repeat('5', 64)),
  ('8f000000-0000-4000-8000-000000000012', '8b000000-0000-4000-8000-000000000001', '8d000000-0000-4000-8000-000000000002', '8e000000-0000-4000-8000-000000000012', 1, 0, '90000000-0000-4000-8000-000000000012', '8a000000-0000-4000-8000-000000000001', 'portal', now(), '91000000-0000-4000-8000-000000000012', '92000000-0000-4000-8000-000000000012', '{"golf_points": true}', 20, null, null, 20, repeat('6', 64));

insert into public.participant_score_projections (
  participant_id, group_id, round_id, golf_points, manual_merit, plus_minus,
  ranking_value, version, last_revision_id
)
values
  ('8e000000-0000-4000-8000-000000000001', '8b000000-0000-4000-8000-000000000001', '8d000000-0000-4000-8000-000000000001', 20, 1.50, 10, 10, 1, '8f000000-0000-4000-8000-000000000001'),
  ('8e000000-0000-4000-8000-000000000002', '8b000000-0000-4000-8000-000000000001', '8d000000-0000-4000-8000-000000000001', 20, null, 10, 10, 1, '8f000000-0000-4000-8000-000000000002'),
  ('8e000000-0000-4000-8000-000000000003', '8b000000-0000-4000-8000-000000000001', '8d000000-0000-4000-8000-000000000001', 15, null, 5, 5, 1, '8f000000-0000-4000-8000-000000000003'),
  ('8e000000-0000-4000-8000-000000000004', '8b000000-0000-4000-8000-000000000001', '8d000000-0000-4000-8000-000000000001', 12, 7, 4, 4, 1, '8f000000-0000-4000-8000-000000000004'),
  ('8e000000-0000-4000-8000-000000000011', '8b000000-0000-4000-8000-000000000001', '8d000000-0000-4000-8000-000000000002', 30, null, null, 30, 1, '8f000000-0000-4000-8000-000000000011'),
  ('8e000000-0000-4000-8000-000000000012', '8b000000-0000-4000-8000-000000000001', '8d000000-0000-4000-8000-000000000002', 20, null, null, 20, 1, '8f000000-0000-4000-8000-000000000012');

create temporary table net_preview as
select public.preview_live_round_completion(
  '8d000000-0000-4000-8000-000000000001',
  '8b000000-0000-4000-8000-000000000001'
) as payload;

select is((select payload ->> 'format' from net_preview), 'individual_net', 'Net preview uses the immutable round format');
select is((select payload ->> 'mobile_sync_check' from net_preview), 'complete', 'preview reports no missing mobile receipts when all current revisions are server-confirmed');
select is((select payload ->> 'completion_handshake_required' from net_preview), 'true', 'preview requires an explicit completion handshake');
select is((select payload ->> 'completion_allowed' from net_preview), 'false', 'preview cannot claim official completion');
select is((select payload ->> 'server_checks_passed' from net_preview), 'true', 'complete server inputs pass readiness');
select is((select jsonb_array_length(payload -> 'participants') from net_preview), 4, 'Net preview includes all Playing members and the guest');
select is((select (payload -> 'participants' -> 0 ->> 'participant_id') from net_preview), '8e000000-0000-4000-8000-000000000001', 'Net preview orders the tied winner deterministically');
select is((select (payload -> 'participants' -> 0 ->> 'competition_rank') from net_preview), '1', 'first tied Net member receives competition rank one');
select is((select (payload -> 'participants' -> 1 ->> 'competition_rank') from net_preview), '1', 'second tied Net member shares competition rank one');
select is((select (payload -> 'participants' -> 2 ->> 'competition_rank') from net_preview), '3', 'Net competition rank skips after the tie');
select is((select (payload -> 'participants' -> 0 -> 'merit' ->> 'total') from net_preview), '13.50', 'member merit combines participation, placement, and manual components');
select is((select (payload -> 'participants' -> 2 -> 'merit' ->> 'placement') from net_preview), '5', 'placement merit follows the snapshotted competition rank');
select is((select (payload -> 'participants' -> 3 ->> 'participant_kind') from net_preview), 'guest', 'guest remains a round-scoped result participant');
select is((select (payload -> 'participants' -> 3 -> 'merit' ->> 'total') from net_preview), '0', 'guests receive no merit even when a projection contains manual merit');
select ok((select (payload -> 'participants' -> 0 ->> 'score_revision_id') is not null from net_preview), 'preview carries authoritative score revision provenance');

select is(
  (select (public.preview_live_round_completion(
    '8d000000-0000-4000-8000-000000000002',
    '8b000000-0000-4000-8000-000000000001'
  ) -> 'participants' -> 0 ->> 'ranking_value')),
  '30',
  'Gross preview ranks by golf points'
);
select is(
  (select (public.preview_live_round_completion(
    '8d000000-0000-4000-8000-000000000002',
    '8b000000-0000-4000-8000-000000000001'
  ) -> 'participants' -> 0 ->> 'competition_rank')),
  '1',
  'Gross highest points receives rank one'
);
select is(
  (select (public.preview_live_round_completion(
    '8d000000-0000-4000-8000-000000000001',
    '8b000000-0000-4000-8000-000000000001'
  ) = public.preview_live_round_completion(
    '8d000000-0000-4000-8000-000000000001',
    '8b000000-0000-4000-8000-000000000001'
  ))),
  true,
  'repeated preview reads are idempotent and stable'
);

select is(
  (select (public.preview_live_round_completion(
    '8d000000-0000-4000-8000-000000000003',
    '8b000000-0000-4000-8000-000000000001'
  ) ->> 'snapshot_present')),
  'false',
  'missing snapshots are visible in the preview envelope'
);
select is(
  (select (public.preview_live_round_completion(
    '8d000000-0000-4000-8000-000000000003',
    '8b000000-0000-4000-8000-000000000001'
  ) ->> 'server_checks_passed')),
  'false',
  'missing snapshots fail server readiness'
);

set local role service_role;
select is(
  (public.preview_live_round_completion(
    '8d000000-0000-4000-8000-000000000001',
    '8b000000-0000-4000-8000-000000000001'
  ) ->> 'format'),
  'individual_net',
  'trusted service role can execute the protected preview'
);
reset role;

select throws_ok(
  $$ select public.preview_live_round_completion(
    '8d000000-0000-4000-8000-000000000001',
    '8b000000-0000-4000-8000-000000000002'
  ) $$,
  'P0002',
  'round_not_found',
  'cross-tenant preview keys reveal no round data'
);
select throws_ok(
  $$ select public.preview_live_round_completion(null, '8b000000-0000-4000-8000-000000000001') $$,
  '22004',
  'round_completion_context_required',
  'preview requires explicit round and group keys'
);

select * from finish();

rollback;
