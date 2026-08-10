begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

select has_function(
  'public',
  'post_round_announcement',
  array['uuid', 'uuid', 'text', 'uuid', 'uuid'],
  'round announcement post RPC exists'
);
select has_function(
  'public',
  'read_member_inbox',
  array['uuid', 'integer'],
  'member web inbox read RPC exists'
);
select has_function(
  'public',
  'mark_member_inbox_read',
  array['uuid', 'uuid', 'uuid', 'uuid'],
  'member web inbox mark-read RPC exists'
);
select has_function(
  'public',
  'resolve_mobile_member_inbox',
  array['integer'],
  'mobile inbox read RPC exists'
);
select has_function(
  'public',
  'mark_mobile_member_inbox_read',
  array['uuid', 'uuid', 'uuid'],
  'mobile inbox mark-read RPC exists'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.post_round_announcement(uuid,uuid,text,uuid,uuid)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.read_member_inbox(uuid,integer)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.mark_member_inbox_read(uuid,uuid,uuid,uuid)',
    'execute'
  ),
  'trusted web server can use the announcement boundaries'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.post_round_announcement(uuid,uuid,text,uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.read_member_inbox(uuid,integer)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.resolve_mobile_member_inbox(integer)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.mark_mobile_member_inbox_read(uuid,uuid,uuid)',
    'execute'
  ),
  'browser roles receive only the authenticated mobile wrappers'
);
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class
   where oid = 'public.round_announcements'::regclass)
  and (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class
   where oid = 'public.notification_inbox_items'::regclass),
  'announcement and inbox source tables remain force-RLS protected'
);
select ok(
  (select prosecdef and proconfig = array['search_path=""']
   from pg_catalog.pg_proc
   where oid = 'public.post_round_announcement(uuid,uuid,text,uuid,uuid)'::regprocedure)
  and (select prosecdef and proconfig = array['search_path=""']
   from pg_catalog.pg_proc
   where oid = 'public.read_member_inbox(uuid,integer)'::regprocedure),
  'server announcement boundaries pin a blank search path'
);

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at
)
values
  ('78000000-0000-4000-8000-000000000001', 'inbox-member-a@example.test', now(), false, false, now(), now()),
  ('78000000-0000-4000-8000-000000000002', 'inbox-member-b@example.test', now(), false, false, now(), now()),
  ('78000000-0000-4000-8000-000000000003', 'inbox-coordinator@example.test', now(), false, false, now(), now()),
  ('78000000-0000-4000-8000-000000000004', 'inbox-other@example.test', now(), false, false, now(), now()),
  ('78000000-0000-4000-8000-000000000005', 'inbox-recovery@example.test', now(), false, false, now(), now());

update auth.users
set raw_app_meta_data = '{"greenroster_password_recovery":true}'::jsonb
where id = '78000000-0000-4000-8000-000000000005';

insert into public.user_profiles (user_id, first_name, last_name)
values
  ('78000000-0000-4000-8000-000000000001', 'Inbox', 'Member A'),
  ('78000000-0000-4000-8000-000000000002', 'Inbox', 'Member B'),
  ('78000000-0000-4000-8000-000000000003', 'Inbox', 'Coordinator'),
  ('78000000-0000-4000-8000-000000000004', 'Inbox', 'Other'),
  ('78000000-0000-4000-8000-000000000005', 'Inbox', 'Recovery');

insert into public.groups (id, name, time_zone)
values
  ('79000000-0000-4000-8000-000000000001', 'Inbox Group A', 'UTC'),
  ('79000000-0000-4000-8000-000000000002', 'Inbox Group B', 'UTC');

insert into public.memberships (
  id, group_id, user_id, role, status, activated_at, inactivated_at
)
values
  ('7a000000-0000-4000-8000-000000000001', '79000000-0000-4000-8000-000000000001', '78000000-0000-4000-8000-000000000001', 'member', 'active', now(), null),
  ('7a000000-0000-4000-8000-000000000002', '79000000-0000-4000-8000-000000000001', '78000000-0000-4000-8000-000000000002', 'member', 'active', now(), null),
  ('7a000000-0000-4000-8000-000000000003', '79000000-0000-4000-8000-000000000001', '78000000-0000-4000-8000-000000000003', 'coordinator', 'active', now(), null),
  ('7a000000-0000-4000-8000-000000000004', '79000000-0000-4000-8000-000000000002', '78000000-0000-4000-8000-000000000004', 'member', 'active', now(), null),
  ('7a000000-0000-4000-8000-000000000005', '79000000-0000-4000-8000-000000000001', '78000000-0000-4000-8000-000000000005', 'member', 'active', now(), null);

insert into public.rounds (
  id, group_id, description, scheduled_at, group_time_zone, format,
  state, version, published_at, created_by
)
values
  ('7b000000-0000-4000-8000-000000000001', '79000000-0000-4000-8000-000000000001', 'Inbox Published Round', now() + interval '1 day', 'UTC', 'individual_net', 'published', 2, now(), '78000000-0000-4000-8000-000000000003'),
  ('7b000000-0000-4000-8000-000000000002', '79000000-0000-4000-8000-000000000001', 'Inbox Draft Round', now() + interval '2 days', 'UTC', 'individual_net', 'draft', 1, null, '78000000-0000-4000-8000-000000000003'),
  ('7b000000-0000-4000-8000-000000000003', '79000000-0000-4000-8000-000000000002', 'Other Group Round', now() + interval '1 day', 'UTC', 'individual_net', 'published', 2, now(), '78000000-0000-4000-8000-000000000004');

insert into public.round_participants (id, round_id, group_id, membership_id)
values
  ('7c000000-0000-4000-8000-000000000001', '7b000000-0000-4000-8000-000000000001', '79000000-0000-4000-8000-000000000001', '7a000000-0000-4000-8000-000000000001'),
  ('7c000000-0000-4000-8000-000000000002', '7b000000-0000-4000-8000-000000000001', '79000000-0000-4000-8000-000000000001', '7a000000-0000-4000-8000-000000000002'),
  ('7c000000-0000-4000-8000-000000000003', '7b000000-0000-4000-8000-000000000003', '79000000-0000-4000-8000-000000000002', '7a000000-0000-4000-8000-000000000004');

create temporary table posted_announcement as
select * from public.post_round_announcement(
  '78000000-0000-4000-8000-000000000003',
  '7b000000-0000-4000-8000-000000000001',
  'Meet by the first tee at 08:15.',
  '7d000000-0000-4000-8000-000000000001',
  '7e000000-0000-4000-8000-000000000001'
);

select is((select count(*) from posted_announcement), 1::bigint, 'posting returns one receipt');
select is((select body from posted_announcement), 'Meet by the first tee at 08:15.', 'posting stores trimmed plain text');
select is((select author_display_name from posted_announcement), 'Inbox Coordinator', 'posting stores the author display snapshot');
select is((select author_role::text from posted_announcement), 'coordinator', 'posting stores the author role snapshot');
select is((select inbox_count from posted_announcement), 3::bigint, 'posting fans out to participants and the coordinator');
select is(
  (select count(*) from public.notification_inbox_items where announcement_id = (select announcement_id from posted_announcement)),
  3::bigint,
  'posting creates one recipient-scoped inbox row per eligible membership'
);
select is(
  (select state::text from public.notification_outbox_jobs where id = (select outbox_job_id from posted_announcement)),
  'succeeded',
  'synchronous in-app fan-out terminalizes its durable outbox event'
);
select is(
  (select count(*) from public.audit_events where action = 'round.announcement_posted' and target_id = (select announcement_id from posted_announcement)),
  1::bigint,
  'posting writes one append-only audit event'
);

select is(
  (select count(*) from public.read_member_inbox('78000000-0000-4000-8000-000000000001', 50)),
  1::bigint,
  'the active member receives the announcement in the inbox'
);
select is(
  (select body from public.read_member_inbox('78000000-0000-4000-8000-000000000001', 50)),
  'Meet by the first tee at 08:15.',
  'the inbox returns the stored announcement body'
);
select is(
  (select round_description from public.read_member_inbox('78000000-0000-4000-8000-000000000001', 50)),
  'Inbox Published Round',
  'the inbox returns the authorized round description'
);
select is(
  (select count(*) from public.read_member_inbox('78000000-0000-4000-8000-000000000004', 50)),
  0::bigint,
  'a different tenant receives no announcement rows'
);

select * from public.mark_member_inbox_read(
  '78000000-0000-4000-8000-000000000001',
  (select inbox_item_id from posted_announcement join public.read_member_inbox('78000000-0000-4000-8000-000000000001', 50) on true),
  '7d000000-0000-4000-8000-000000000002',
  '7e000000-0000-4000-8000-000000000002'
);
select ok(
  (select read_at is not null from public.notification_inbox_items
   where id = (select inbox_item_id from public.read_member_inbox('78000000-0000-4000-8000-000000000001', 50))),
  'mark-read persists the member read timestamp'
);
select is(
  (select count(*) from public.audit_events where action = 'notification.inbox_read' and actor_user_id = '78000000-0000-4000-8000-000000000001'),
  1::bigint,
  'mark-read writes an audit event'
);
select is(
  (select version from public.mark_member_inbox_read(
    '78000000-0000-4000-8000-000000000001',
    (select inbox_item_id from public.read_member_inbox('78000000-0000-4000-8000-000000000001', 50)),
    '7d000000-0000-4000-8000-000000000002',
    '7e000000-0000-4000-8000-000000000002'
  )),
  (select version from public.notification_inbox_items where recipient_membership_id = '7a000000-0000-4000-8000-000000000001'),
  'mark-read retry returns the idempotent row without adding a second audit event'
);

select is(
  (select announcement_id from public.post_round_announcement(
    '78000000-0000-4000-8000-000000000003',
    '7b000000-0000-4000-8000-000000000001',
    'Meet by the first tee at 08:15.',
    '7d000000-0000-4000-8000-000000000001',
    '7e000000-0000-4000-8000-000000000001'
  )),
  (select announcement_id from posted_announcement),
  'the same posting operation returns the original announcement'
);
select throws_ok(
  $$ select * from public.post_round_announcement(
    '78000000-0000-4000-8000-000000000003',
    '7b000000-0000-4000-8000-000000000001',
    'Different text.',
    '7d000000-0000-4000-8000-000000000001',
    '7e000000-0000-4000-8000-000000000001'
  ) $$,
  '23505',
  'operation_id_reused',
  'reusing a posting operation with different text is rejected'
);
select throws_ok(
  $$ select * from public.post_round_announcement(
    '78000000-0000-4000-8000-000000000003',
    '7b000000-0000-4000-8000-000000000001',
    repeat('x', 301),
    '7d000000-0000-4000-8000-000000000003',
    '7e000000-0000-4000-8000-000000000003'
  ) $$,
  '22023',
  'round_announcement_too_long',
  'server validation enforces the 300-character limit'
);
select throws_ok(
  $$ select * from public.post_round_announcement(
    '78000000-0000-4000-8000-000000000001',
    '7b000000-0000-4000-8000-000000000001',
    'Member cannot post.',
    '7d000000-0000-4000-8000-000000000004',
    '7e000000-0000-4000-8000-000000000004'
  ) $$,
  'P0003',
  'actor_not_authorized',
  'ordinary members cannot post announcements'
);
select throws_ok(
  $$ select * from public.post_round_announcement(
    '78000000-0000-4000-8000-000000000003',
    '7b000000-0000-4000-8000-000000000002',
    'Draft text.',
    '7d000000-0000-4000-8000-000000000005',
    '7e000000-0000-4000-8000-000000000005'
  ) $$,
  'P0001',
  'round_announcement_state_locked',
  'draft rounds cannot receive member announcements'
);
select throws_ok(
  $$ select * from public.post_round_announcement(
    '78000000-0000-4000-8000-000000000004',
    '7b000000-0000-4000-8000-000000000001',
    'Cross-tenant text.',
    '7d000000-0000-4000-8000-000000000006',
    '7e000000-0000-4000-8000-000000000006'
  ) $$,
  'P0002',
  'round_not_found',
  'cross-tenant coordinators cannot address another group round'
);
select throws_ok(
  $$ select * from public.read_member_inbox(
    '78000000-0000-4000-8000-000000000005', 50
  ) $$,
  'P0003',
  'recovery_session_forbidden',
  'password-recovery sessions cannot read the inbox'
);
select throws_ok(
  $$ select * from public.read_member_inbox(
    '78000000-0000-4000-8000-000000000001', 101
  ) $$,
  '22023',
  'member_inbox_limit_invalid',
  'inbox limits are server validated'
);

select * from finish();
rollback;
