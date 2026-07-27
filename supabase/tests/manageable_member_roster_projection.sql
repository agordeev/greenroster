begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

select has_function(
  'public',
  'list_manageable_member_roster',
  array[
    'uuid',
    'text',
    'text',
    'public.membership_status',
    'public.membership_role',
    'boolean',
    'text',
    'text',
    'integer',
    'bigint'
  ],
  'paginated administrative roster RPC exists'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.list_manageable_member_roster(uuid,text,text,public.membership_status,public.membership_role,boolean,text,text,integer,bigint)',
    'execute'
  ),
  'service_role can execute the roster RPC'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.list_manageable_member_roster(uuid,text,text,public.membership_status,public.membership_role,boolean,text,text,integer,bigint)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.list_manageable_member_roster(uuid,text,text,public.membership_status,public.membership_role,boolean,text,text,integer,bigint)',
    'execute'
  ),
  'client roles cannot execute the roster RPC'
);

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at
)
values
  ('ba000000-0000-4000-8000-000000000001', 'roster-admin-a@example.test', now(), false, false, now(), now()),
  ('ba000000-0000-4000-8000-000000000002', 'roster-coordinator-a@example.test', now(), false, false, now(), now()),
  ('ba000000-0000-4000-8000-000000000003', 'roster-member-a@example.test', now(), false, false, now(), now()),
  ('ba000000-0000-4000-8000-000000000004', 'roster-admin-b@example.test', now(), false, false, now(), now());

insert into public.user_profiles (user_id, display_name)
values
  ('ba000000-0000-4000-8000-000000000001', 'Roster Admin A'),
  ('ba000000-0000-4000-8000-000000000002', 'Roster Coordinator A'),
  ('ba000000-0000-4000-8000-000000000003', 'Roster Member A'),
  ('ba000000-0000-4000-8000-000000000004', 'Roster Admin B');

insert into public.groups (id, name, time_zone)
values
  ('bb000000-0000-4000-8000-000000000001', 'Roster Group A', 'UTC'),
  ('bb000000-0000-4000-8000-000000000002', 'Roster Group B', 'UTC');

insert into public.memberships (
  id, group_id, user_id, role, status, dues_paid, initial_quota,
  uses_initial_quota, initial_quota_provenance, created_at, activated_at
)
values
  ('bc000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', 'ba000000-0000-4000-8000-000000000001', 'administrator', 'active', true, 9.00, true, 'seed', '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z'),
  ('bc000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001', 'ba000000-0000-4000-8000-000000000002', 'coordinator', 'active', false, null, false, null, '2026-07-02T00:00:00Z', '2026-07-02T00:00:00Z'),
  ('bc000000-0000-4000-8000-000000000003', 'bb000000-0000-4000-8000-000000000001', 'ba000000-0000-4000-8000-000000000003', 'member', 'active', true, null, false, null, '2026-07-03T00:00:00Z', '2026-07-03T00:00:00Z'),
  ('bc000000-0000-4000-8000-000000000011', 'bb000000-0000-4000-8000-000000000001', null, 'member', 'pending', false, null, false, null, '2026-07-04T00:00:00Z', null),
  ('bc000000-0000-4000-8000-000000000012', 'bb000000-0000-4000-8000-000000000001', null, 'member', 'pending', true, null, false, null, '2026-07-05T00:00:00Z', null),
  ('bc000000-0000-4000-8000-000000000013', 'bb000000-0000-4000-8000-000000000001', null, 'member', 'pending', false, null, false, null, '2026-07-06T00:00:00Z', null),
  ('bc000000-0000-4000-8000-000000000014', 'bb000000-0000-4000-8000-000000000001', null, 'member', 'pending', false, null, false, null, '2026-07-07T00:00:00Z', null),
  ('bc000000-0000-4000-8000-000000000015', 'bb000000-0000-4000-8000-000000000001', null, 'member', 'pending', true, null, false, null, '2026-07-08T00:00:00Z', null),
  ('bc000000-0000-4000-8000-000000000021', 'bb000000-0000-4000-8000-000000000002', null, 'member', 'pending', false, null, false, null, '2026-07-08T00:00:00Z', null),
  ('bc000000-0000-4000-8000-000000000022', 'bb000000-0000-4000-8000-000000000002', 'ba000000-0000-4000-8000-000000000004', 'administrator', 'active', true, null, false, null, '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z');

insert into public.membership_golfer_profiles (membership_id, group_id, first_name, last_name, tee_location)
values
  ('bc000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', 'Zulu', 'Zed', 'pro'),
  ('bc000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001', 'Alpha', 'Aardvark', 'middle'),
  ('bc000000-0000-4000-8000-000000000003', 'bb000000-0000-4000-8000-000000000001', 'Bravo', 'Bravo', 'back'),
  ('bc000000-0000-4000-8000-000000000011', 'bb000000-0000-4000-8000-000000000001', 'Delta', 'Delta', 'front'),
  ('bc000000-0000-4000-8000-000000000012', 'bb000000-0000-4000-8000-000000000001', 'Echo', 'Echo', 'middle'),
  ('bc000000-0000-4000-8000-000000000013', 'bb000000-0000-4000-8000-000000000001', 'Twin', 'Twin', 'back'),
  ('bc000000-0000-4000-8000-000000000014', 'bb000000-0000-4000-8000-000000000001', 'Twin', 'Twin', 'back'),
  ('bc000000-0000-4000-8000-000000000015', 'bb000000-0000-4000-8000-000000000001', 'Expired', 'Expired', 'front'),
  ('bc000000-0000-4000-8000-000000000021', 'bb000000-0000-4000-8000-000000000002', 'Cross', 'Tenant', 'middle'),
  ('bc000000-0000-4000-8000-000000000022', 'bb000000-0000-4000-8000-000000000002', 'Other', 'Administrator', 'pro');

insert into public.membership_handicap_records (
  id, membership_id, group_id, handicap_id, handicap, source, as_of, created_at
)
values
  ('bd000000-0000-4000-8000-000000000001', 'bc000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', 'H-ZULU', 12.3, 'manual', '2026-07-10', '2026-07-10T00:00:00Z'),
  ('bd000000-0000-4000-8000-000000000002', 'bc000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001', 'H-ALPHA', 18.1, 'import', '2026-07-11', '2026-07-11T00:00:00Z'),
  ('bd000000-0000-4000-8000-000000000003', 'bc000000-0000-4000-8000-000000000003', 'bb000000-0000-4000-8000-000000000001', 'H-BRAVO', 20.4, 'import', '2026-07-12', '2026-07-12T00:00:00Z'),
  ('bd000000-0000-4000-8000-000000000011', 'bc000000-0000-4000-8000-000000000011', 'bb000000-0000-4000-8000-000000000001', 'H-DELTA', 10.0, 'manual', '2026-07-13', '2026-07-13T00:00:00Z');

insert into public.membership_quota_projections (
  membership_id, group_id, projection_version, settings_version,
  projection_ready, projected_quota, projection_source, effective_at
)
values
  ('bc000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', 2, 3, true, 8.50, '{"source":"seed","reason":"bootstrap"}'::jsonb, '2026-07-20T00:00:00Z'),
  ('bc000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001', 3, 4, true, 10.00, '{"source":"round","round_id":"r-1"}'::jsonb, '2026-07-21T00:00:00Z'),
  ('bc000000-0000-4000-8000-000000000003', 'bb000000-0000-4000-8000-000000000001', 4, 4, true, 11.25, '{"source":"round","round_id":"r-2"}'::jsonb, '2026-07-22T00:00:00Z');

insert into public.membership_invitations (
  id, group_id, membership_id, invited_email, invited_email_normalized,
  role, token_digest_sha256, token_key_version, status, issued_at, expires_at,
  inviter_user_id, accepted_at, version
)
values
  ('be000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', 'bc000000-0000-4000-8000-000000000001', 'zulu-invited@example.test', 'zulu-invited@example.test', 'member', repeat('a', 64), 1, 'accepted', '2026-06-01T00:00:00Z', '2099-07-01T00:00:00Z', 'ba000000-0000-4000-8000-000000000001', '2026-06-02T00:00:00Z', 1),
  ('be000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001', 'bc000000-0000-4000-8000-000000000002', 'alpha-invited@example.test', 'alpha-invited@example.test', 'member', repeat('b', 64), 1, 'accepted', '2026-06-01T00:00:00Z', '2099-07-01T00:00:00Z', 'ba000000-0000-4000-8000-000000000001', '2026-06-02T00:00:00Z', 1),
  ('be000000-0000-4000-8000-000000000003', 'bb000000-0000-4000-8000-000000000001', 'bc000000-0000-4000-8000-000000000003', 'bravo-invited@example.test', 'bravo-invited@example.test', 'member', repeat('c', 64), 1, 'accepted', '2026-06-01T00:00:00Z', '2099-07-01T00:00:00Z', 'ba000000-0000-4000-8000-000000000001', '2026-06-02T00:00:00Z', 1),
  ('be000000-0000-4000-8000-000000000011', 'bb000000-0000-4000-8000-000000000001', 'bc000000-0000-4000-8000-000000000011', 'delta-invited@example.test', 'delta-invited@example.test', 'member', repeat('d', 64), 1, 'pending', '2026-07-04T00:00:00Z', '2099-07-04T00:00:00Z', 'ba000000-0000-4000-8000-000000000001', null, 1),
  ('be000000-0000-4000-8000-000000000012', 'bb000000-0000-4000-8000-000000000001', 'bc000000-0000-4000-8000-000000000012', 'echo-invited@example.test', 'echo-invited@example.test', 'member', repeat('e', 64), 1, 'pending', '2026-07-05T00:00:00Z', '2099-07-05T00:00:00Z', 'ba000000-0000-4000-8000-000000000001', null, 1),
  ('be000000-0000-4000-8000-000000000013', 'bb000000-0000-4000-8000-000000000001', 'bc000000-0000-4000-8000-000000000013', 'twin-a@example.test', 'twin-a@example.test', 'member', repeat('f', 64), 1, 'pending', '2026-07-06T00:00:00Z', '2099-07-06T00:00:00Z', 'ba000000-0000-4000-8000-000000000001', null, 1),
  ('be000000-0000-4000-8000-000000000014', 'bb000000-0000-4000-8000-000000000001', 'bc000000-0000-4000-8000-000000000014', 'twin-b@example.test', 'twin-b@example.test', 'member', repeat('1', 64), 1, 'pending', '2026-07-07T00:00:00Z', '2099-07-07T00:00:00Z', 'ba000000-0000-4000-8000-000000000001', null, 1),
  ('be000000-0000-4000-8000-000000000015', 'bb000000-0000-4000-8000-000000000001', 'bc000000-0000-4000-8000-000000000015', 'expired-invited@example.test', 'expired-invited@example.test', 'member', repeat('2', 64), 1, 'pending', '2026-07-01T00:00:00Z', '2026-07-10T00:00:00Z', 'ba000000-0000-4000-8000-000000000001', null, 1),
  ('be000000-0000-4000-8000-000000000021', 'bb000000-0000-4000-8000-000000000002', 'bc000000-0000-4000-8000-000000000021', 'cross-invited@example.test', 'cross-invited@example.test', 'member', repeat('3', 64), 1, 'pending', '2026-07-08T00:00:00Z', '2099-07-08T00:00:00Z', 'ba000000-0000-4000-8000-000000000004', null, 1);

insert into public.notification_outbox_jobs (
  id, group_id, event_type, aggregate_type, aggregate_id, aggregate_version,
  idempotency_key, state, attempts, finished_at
)
values
  ('bf000000-0000-4000-8000-000000000011', 'bb000000-0000-4000-8000-000000000001', 'membership.invitation', 'membership_invitation', 'be000000-0000-4000-8000-000000000011', 1, 'roster-delta-invite', 'succeeded', 1, now()),
  ('bf000000-0000-4000-8000-000000000012', 'bb000000-0000-4000-8000-000000000001', 'membership.invitation', 'membership_invitation', 'be000000-0000-4000-8000-000000000012', 1, 'roster-echo-invite', 'succeeded', 1, now()),
  ('bf000000-0000-4000-8000-000000000021', 'bb000000-0000-4000-8000-000000000002', 'membership.invitation', 'membership_invitation', 'be000000-0000-4000-8000-000000000021', 1, 'roster-cross-invite', 'succeeded', 1, now());

insert into public.notification_deliveries (
  id, group_id, outbox_job_id, recipient_membership_id, recipient_address,
  recipient_address_normalized, channel, provider_message_id, state, attempts, sent_at
)
values
  ('c0000000-0000-4000-8000-000000000011', 'bb000000-0000-4000-8000-000000000001', 'bf000000-0000-4000-8000-000000000011', 'bc000000-0000-4000-8000-000000000011', 'delta-invited@example.test', 'delta-invited@example.test', 'email', 'roster-provider-delta', 'sent', 1, now()),
  ('c0000000-0000-4000-8000-000000000012', 'bb000000-0000-4000-8000-000000000001', 'bf000000-0000-4000-8000-000000000012', 'bc000000-0000-4000-8000-000000000012', 'echo-invited@example.test', 'echo-invited@example.test', 'email', 'roster-provider-echo', 'sent', 1, now()),
  ('c0000000-0000-4000-8000-000000000021', 'bb000000-0000-4000-8000-000000000002', 'bf000000-0000-4000-8000-000000000021', 'bc000000-0000-4000-8000-000000000021', 'cross-invited@example.test', 'cross-invited@example.test', 'email', 'roster-provider-cross', 'sent', 1, now());

insert into public.email_suppressions (normalized_address, reason)
values
  ('delta-invited@example.test', 'complaint'),
  ('cross-invited@example.test', 'bounce');

create temporary table roster_result on commit drop as
select public.list_manageable_member_roster(
  'ba000000-0000-4000-8000-000000000002'
) as payload;

select is(
  ((select payload from roster_result)->>'total_count')::integer,
  8,
  'authorized actor receives every member in the actor tenant'
);
select is(
  ((select payload from roster_result)->>'active_count')::integer,
  3,
  'active_count is the unfiltered active count for the actor tenant'
);
select is(
  jsonb_array_length((select payload from roster_result)->'rows'),
  8,
  'default roster page contains all fixture rows'
);
select is(
  (select row->>'membership_id'
   from jsonb_array_elements((select payload from roster_result)->'rows') as row
   limit 1),
  'bc000000-0000-4000-8000-000000000002',
  'default name ordering starts with the Aardvark member'
);
select is(
  (select row->>'membership_id'
   from jsonb_array_elements((select payload from roster_result)->'rows') as row
   where row->>'membership_id' = 'bc000000-0000-4000-8000-000000000001'),
  'bc000000-0000-4000-8000-000000000001',
  'stable result includes the administrator row'
);

select is(
  (select row->>'handicap_value'
   from jsonb_array_elements((select payload from roster_result)->'rows') as row
   where row->>'membership_id' = 'bc000000-0000-4000-8000-000000000001'),
  '12.3',
  'roster joins the current handicap value'
);
select is(
  (select row->>'handicap_source'
   from jsonb_array_elements((select payload from roster_result)->'rows') as row
   where row->>'membership_id' = 'bc000000-0000-4000-8000-000000000002'),
  'import',
  'roster joins the current handicap source'
);
select is(
  (select row->>'handicap_as_of'
   from jsonb_array_elements((select payload from roster_result)->'rows') as row
   where row->>'membership_id' = 'bc000000-0000-4000-8000-000000000002'),
  '2026-07-11',
  'roster joins the current handicap as-of date'
);
select is(
  (select row->>'handicap_id'
   from jsonb_array_elements((select payload from roster_result)->'rows') as row
   where row->>'membership_id' = 'bc000000-0000-4000-8000-000000000002'),
  'H-ALPHA',
  'roster joins the current handicap identifier'
);
select is(
  (select row->>'current_quota'
   from jsonb_array_elements((select payload from roster_result)->'rows') as row
   where row->>'membership_id' = 'bc000000-0000-4000-8000-000000000001'),
  '8.50',
  'roster joins the current quota value without binary rounding'
);
select is(
  (select row->'current_quota_provenance'
   from jsonb_array_elements((select payload from roster_result)->'rows') as row
   where row->>'membership_id' = 'bc000000-0000-4000-8000-000000000001'),
  '{"reason":"bootstrap","source":"seed"}'::jsonb,
  'roster joins current quota provenance'
);
select ok(
  (select row->>'current_quota_effective_at'
   from jsonb_array_elements((select payload from roster_result)->'rows') as row
   where row->>'membership_id' = 'bc000000-0000-4000-8000-000000000001') like '2026-07-20%',
  'roster joins the current quota effective instant'
);
select is(
  (select (row->>'uses_initial_quota')::boolean
   from jsonb_array_elements((select payload from roster_result)->'rows') as row
   where row->>'membership_id' = 'bc000000-0000-4000-8000-000000000001'),
  true,
  'roster joins use-initial-quota state'
);
select ok(
  (select row->>'date_added'
   from jsonb_array_elements((select payload from roster_result)->'rows') as row
   where row->>'membership_id' = 'bc000000-0000-4000-8000-000000000001') like '2026-07-01%',
  'roster joins the membership date added'
);
select is(
  (select row->>'invitation_state'
   from jsonb_array_elements((select payload from roster_result)->'rows') as row
   where row->>'membership_id' = 'bc000000-0000-4000-8000-000000000011'),
  'pending',
  'pending invitation state is projected'
);
select is(
  (select (row->>'invitation_delivery_action_required')::boolean
   from jsonb_array_elements((select payload from roster_result)->'rows') as row
   where row->>'membership_id' = 'bc000000-0000-4000-8000-000000000011'),
  true,
  'complaint-suppressed sent invitation requires action'
);
select is(
  (select (row->>'invitation_delivery_action_required')::boolean
   from jsonb_array_elements((select payload from roster_result)->'rows') as row
   where row->>'membership_id' = 'bc000000-0000-4000-8000-000000000012'),
  false,
  'healthy sent invitation does not require action'
);
select is(
  (select row->>'invitation_state'
   from jsonb_array_elements((select payload from roster_result)->'rows') as row
   where row->>'membership_id' = 'bc000000-0000-4000-8000-000000000015'),
  'expired',
  'expired pending invitation is projected as expired'
);

select ok(
  not exists (
    select 1
    from jsonb_array_elements((select payload from roster_result)->'rows') as row
    where row ? 'account_email'
      or row ? 'secondary_email'
      or row ? 'mobile_phone'
      or row ? 'address_line1'
      or row ? 'last_round'
  ),
  'roster rows expose no account, private contact, or later-phase round fields'
);

create temporary table roster_search_account on commit drop as
select public.list_manageable_member_roster(
  'ba000000-0000-4000-8000-000000000002',
  'COORDINATOR-A@EXAMPLE.TEST', null, null, null, null, 'name', 'asc', 50, 0
) as payload;
select is(
  ((select payload from roster_search_account)->>'total_count')::integer,
  1,
  'search can use an attached account email without returning it'
);
select is(
  (select row->>'membership_id'
   from jsonb_array_elements((select payload from roster_search_account)->'rows') as row),
  'bc000000-0000-4000-8000-000000000002',
  'account-email search resolves the matching member'
);

select is(
  ((select public.list_manageable_member_roster(
    'ba000000-0000-4000-8000-000000000002',
    'H-ALPHA', null, null, null, null, 'name', 'asc', 50, 0
  )->>'total_count')::integer),
  1,
  'search can use the current handicap identifier'
);
select is(
  ((select public.list_manageable_member_roster(
    'ba000000-0000-4000-8000-000000000002',
    '  Alpha   Aardvark  ', null, null, null, null, 'name', 'asc', 50, 0
  )->>'total_count')::integer),
  1,
  'full-name search normalizes whitespace in first-last order'
);
select is(
  ((select public.list_manageable_member_roster(
    'ba000000-0000-4000-8000-000000000002',
    'Aardvark Alpha', null, null, null, null, 'name', 'asc', 50, 0
  )->>'total_count')::integer),
  1,
  'full-name search accepts last-first order'
);
select is(
  ((select public.list_manageable_member_roster(
    'ba000000-0000-4000-8000-000000000002',
    null, 'b', null, null, null, 'name', 'asc', 50, 0
  )->>'total_count')::integer),
  1,
  'alphabet filter is case-insensitive and name-derived'
);
select is(
  ((select public.list_manageable_member_roster(
    'ba000000-0000-4000-8000-000000000002',
    null, null, 'pending', null, null, 'name', 'asc', 50, 0
  )->>'total_count')::integer),
  5,
  'status filter limits rows to pending memberships'
);
select is(
  ((select public.list_manageable_member_roster(
    'ba000000-0000-4000-8000-000000000002',
    null, null, 'pending', null, null, 'name', 'asc', 50, 0
  )->>'active_count')::integer),
  3,
  'active_count ignores current status filters'
);
select is(
  ((select public.list_manageable_member_roster(
    'ba000000-0000-4000-8000-000000000002',
    null, null, null, 'administrator', null, 'name', 'asc', 50, 0
  )->>'total_count')::integer),
  1,
  'role filter limits rows to administrators'
);
select is(
  ((select public.list_manageable_member_roster(
    'ba000000-0000-4000-8000-000000000002',
    null, null, null, null, true, 'name', 'asc', 50, 0
  )->>'total_count')::integer),
  4,
  'dues filter limits rows to dues-paid members'
);

select is(
  ((select public.list_manageable_member_roster(
    'ba000000-0000-4000-8000-000000000002',
    null, null, null, null, null, 'name', 'asc', 2, 0
  )->'rows'->0->>'membership_id')),
  'bc000000-0000-4000-8000-000000000002',
  'first page has deterministic first row'
);
select is(
  ((select public.list_manageable_member_roster(
    'ba000000-0000-4000-8000-000000000002',
    null, null, null, null, null, 'name', 'asc', 2, 0
  )->'rows'->1->>'membership_id')),
  'bc000000-0000-4000-8000-000000000003',
  'first page has deterministic second row'
);
select is(
  ((select public.list_manageable_member_roster(
    'ba000000-0000-4000-8000-000000000002',
    null, null, null, null, null, 'name', 'asc', 2, 2
  )->'rows'->0->>'membership_id')),
  'bc000000-0000-4000-8000-000000000011',
  'offset page advances in the same stable order'
);
select is(
  (select public.list_manageable_member_roster(
    'ba000000-0000-4000-8000-000000000002',
    null, null, null, null, null, 'name', 'asc', 2, 2
  )),
  (select public.list_manageable_member_roster(
    'ba000000-0000-4000-8000-000000000002',
    null, null, null, null, null, 'name', 'asc', 2, 2
  )),
  'repeated offset pages converge to the same result'
);
select is(
  ((select public.list_manageable_member_roster(
    'ba000000-0000-4000-8000-000000000002',
    null, null, null, null, null, 'name', 'desc', 1, 0
  )->'rows'->0->>'membership_id')),
  'bc000000-0000-4000-8000-000000000001',
  'descending name sort is allowlisted and deterministic'
);
select is(
  ((select public.list_manageable_member_roster(
    'ba000000-0000-4000-8000-000000000002',
    null, null, null, null, null, 'dues', 'desc', 1, 0
  )->'rows'->0->>'membership_id')),
  'bc000000-0000-4000-8000-000000000003',
  'dues sort key and direction are applied'
);
select is(
  ((select public.list_manageable_member_roster(
    'ba000000-0000-4000-8000-000000000002',
    null, null, null, null, null, 'name', 'asc', 2, 9007199254740991
  )->>'total_count')::integer),
  8,
  'out-of-range pages preserve total_count'
);
select is(
  ((select public.list_manageable_member_roster(
    'ba000000-0000-4000-8000-000000000002',
    null, null, null, null, null, 'name', 'asc', 2, 9007199254740991
  )->>'active_count')::integer),
  3,
  'out-of-range pages preserve active_count'
);
select is(
  jsonb_array_length((select public.list_manageable_member_roster(
    'ba000000-0000-4000-8000-000000000002',
    null, null, null, null, null, 'name', 'asc', 2, 9007199254740991
  )->'rows')),
  0,
  'out-of-range pages return an empty rows array'
);

select throws_ok(
  $$ select public.list_manageable_member_roster('ba000000-0000-4000-8000-000000000002', null, null, null, null, null, 'email', 'asc', 50, 0) $$,
  '22023',
  'roster_sort_invalid',
  'unsupported sort key is rejected'
);
select throws_ok(
  $$ select public.list_manageable_member_roster('ba000000-0000-4000-8000-000000000002', null, null, null, null, null, 'name', 'sideways', 50, 0) $$,
  '22023',
  'roster_sort_invalid',
  'unsupported sort direction is rejected'
);
select throws_ok(
  $$ select public.list_manageable_member_roster('ba000000-0000-4000-8000-000000000002', null, 'AB', null, null, null, 'name', 'asc', 50, 0) $$,
  '22023',
  'roster_alphabet_invalid',
  'multi-letter alphabet input is rejected'
);
select throws_ok(
  $$ select public.list_manageable_member_roster('ba000000-0000-4000-8000-000000000002', null, null, null, null, null, 'name', 'asc', 0, 0) $$,
  '22023',
  'roster_limit_invalid',
  'zero page limit is rejected'
);
select throws_ok(
  $$ select public.list_manageable_member_roster('ba000000-0000-4000-8000-000000000002', null, null, null, null, null, 'name', 'asc', 50, -1) $$,
  '22023',
  'roster_offset_invalid',
  'negative page offset is rejected'
);
select throws_ok(
  $$ select public.list_manageable_member_roster('ba000000-0000-4000-8000-000000000003') $$,
  'P0003',
  'actor_not_authorized',
  'ordinary members cannot read the administrative roster'
);

select is(
  ((select public.list_manageable_member_roster(
    'ba000000-0000-4000-8000-000000000001',
    'cross-invited@example.test', null, null, null, null, 'name', 'asc', 50, 0
  )->>'total_count')::integer),
  0,
  'actor search cannot cross tenant boundaries'
);
select is(
  ((select public.list_manageable_member_roster(
    'ba000000-0000-4000-8000-000000000001',
    'cross-invited@example.test', null, null, null, null, 'name', 'asc', 50, 0
  )->>'active_count')::integer),
  3,
  'empty filtered pages retain the actor tenant active count'
);
select is(
  jsonb_array_length((select public.list_manageable_member_roster(
    'ba000000-0000-4000-8000-000000000001',
    'cross-invited@example.test', null, null, null, null, 'name', 'asc', 50, 0
  )->'rows')),
  0,
  'empty filtered pages retain an empty rows array'
);
select is(
  ((select public.list_manageable_member_roster(
    'ba000000-0000-4000-8000-000000000004',
    null, null, null, null, null, 'name', 'asc', 50, 0
  )->>'total_count')::integer),
  2,
  'the other tenant receives only its own roster rows'
);
select is(
  ((select public.list_manageable_member_roster(
    'ba000000-0000-4000-8000-000000000004',
    null, null, null, null, null, 'name', 'asc', 50, 0
  )->>'active_count')::integer),
  1,
  'active_count is tenant-isolated for the other actor'
);
select is(
  (select public.list_manageable_member_roster(
    'ba000000-0000-4000-8000-000000000004',
    null, null, null, null, null, 'name', 'asc', 50, 0
  )->'rows'->0->>'membership_id'),
  'bc000000-0000-4000-8000-000000000022',
  'cross-tenant rows are not returned to the other actor'
);
select is(
  (select (public.list_manageable_member_roster(
    'ba000000-0000-4000-8000-000000000004',
    null, null, null, null, null, 'name', 'asc', 50, 0
  )->'rows'->1->>'invitation_delivery_action_required')::boolean),
  true,
  'the owning tenant sees its own suppressed invitation action flag'
);

select * from finish();
rollback;
