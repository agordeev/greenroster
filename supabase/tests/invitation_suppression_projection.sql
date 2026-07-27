begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

select ok(
  has_function_privilege(
    'service_role',
    'public.list_manageable_membership_invitations(uuid)',
    'execute'
  ),
  'service_role can execute the suppression-aware invitation projection'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.list_manageable_membership_invitations(uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.list_manageable_membership_invitations(uuid)',
    'execute'
  ),
  'client roles cannot execute the suppression-aware invitation projection'
);

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at
)
values
  ('b9000000-0000-4000-8000-000000000001', 'suppression-admin-a@example.test', now(), false, false, now(), now()),
  ('b9000000-0000-4000-8000-000000000002', 'suppression-admin-b@example.test', now(), false, false, now(), now()),
  ('b9000000-0000-4000-8000-000000000003', 'suppression-member-a@example.test', now(), false, false, now(), now());

insert into public.user_profiles (user_id, display_name)
values
  ('b9000000-0000-4000-8000-000000000001', 'Suppression Admin A'),
  ('b9000000-0000-4000-8000-000000000002', 'Suppression Admin B'),
  ('b9000000-0000-4000-8000-000000000003', 'Suppression Member A');

insert into public.groups (id, name, time_zone)
values
  ('c9000000-0000-4000-8000-000000000001', 'Suppression Group A', 'UTC'),
  ('c9000000-0000-4000-8000-000000000002', 'Suppression Group B', 'UTC');

insert into public.memberships (
  id, group_id, user_id, role, status, activated_at
)
values
  ('d9000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000001', 'b9000000-0000-4000-8000-000000000001', 'administrator', 'active', now()),
  ('d9000000-0000-4000-8000-000000000002', 'c9000000-0000-4000-8000-000000000001', 'b9000000-0000-4000-8000-000000000003', 'member', 'active', now()),
  ('d9000000-0000-4000-8000-000000000003', 'c9000000-0000-4000-8000-000000000002', 'b9000000-0000-4000-8000-000000000002', 'administrator', 'active', now()),
  ('d9000000-0000-4000-8000-000000000011', 'c9000000-0000-4000-8000-000000000001', null, 'member', 'pending', null),
  ('d9000000-0000-4000-8000-000000000012', 'c9000000-0000-4000-8000-000000000001', null, 'member', 'pending', null),
  ('d9000000-0000-4000-8000-000000000013', 'c9000000-0000-4000-8000-000000000001', null, 'member', 'pending', null),
  ('d9000000-0000-4000-8000-000000000021', 'c9000000-0000-4000-8000-000000000002', null, 'member', 'pending', null);

insert into public.membership_golfer_profiles (membership_id, group_id, first_name, last_name)
values
  ('d9000000-0000-4000-8000-000000000011', 'c9000000-0000-4000-8000-000000000001', 'Complaint', 'Target'),
  ('d9000000-0000-4000-8000-000000000012', 'c9000000-0000-4000-8000-000000000001', 'Bounce', 'Target'),
  ('d9000000-0000-4000-8000-000000000013', 'c9000000-0000-4000-8000-000000000001', 'Unrelated', 'Target'),
  ('d9000000-0000-4000-8000-000000000021', 'c9000000-0000-4000-8000-000000000002', 'Cross', 'Tenant');

insert into public.membership_invitations (
  id, group_id, membership_id, invited_email, invited_email_normalized,
  role, token_digest_sha256, token_key_version, status, issued_at, expires_at,
  inviter_user_id, version
)
values
  ('e9000000-0000-4000-8000-000000000011', 'c9000000-0000-4000-8000-000000000001', 'd9000000-0000-4000-8000-000000000011', 'complaint-after-sent@example.test', 'complaint-after-sent@example.test', 'member', repeat('a', 64), 1, 'pending', '2026-07-27T00:00:00Z', '2099-07-28T00:00:00Z', 'b9000000-0000-4000-8000-000000000001', 1),
  ('e9000000-0000-4000-8000-000000000012', 'c9000000-0000-4000-8000-000000000001', 'd9000000-0000-4000-8000-000000000012', 'bounce-after-sent@example.test', 'bounce-after-sent@example.test', 'member', repeat('b', 64), 1, 'pending', '2026-07-27T00:00:00Z', '2099-07-28T00:00:00Z', 'b9000000-0000-4000-8000-000000000001', 1),
  ('e9000000-0000-4000-8000-000000000013', 'c9000000-0000-4000-8000-000000000001', 'd9000000-0000-4000-8000-000000000013', 'unrelated-target@example.test', 'unrelated-target@example.test', 'member', repeat('c', 64), 1, 'pending', '2026-07-27T00:00:00Z', '2099-07-28T00:00:00Z', 'b9000000-0000-4000-8000-000000000001', 1),
  ('e9000000-0000-4000-8000-000000000021', 'c9000000-0000-4000-8000-000000000002', 'd9000000-0000-4000-8000-000000000021', 'cross-tenant@example.test', 'cross-tenant@example.test', 'member', repeat('d', 64), 1, 'pending', '2026-07-27T00:00:00Z', '2099-07-28T00:00:00Z', 'b9000000-0000-4000-8000-000000000002', 1);

insert into public.notification_outbox_jobs (
  id, group_id, event_type, aggregate_type, aggregate_id, aggregate_version,
  idempotency_key, state, attempts, finished_at
)
values
  ('f9000000-0000-4000-8000-000000000011', 'c9000000-0000-4000-8000-000000000001', 'membership.invitation', 'membership_invitation', 'e9000000-0000-4000-8000-000000000011', 1, 'suppression-invite-11', 'succeeded', 1, now()),
  ('f9000000-0000-4000-8000-000000000012', 'c9000000-0000-4000-8000-000000000001', 'membership.invitation', 'membership_invitation', 'e9000000-0000-4000-8000-000000000012', 1, 'suppression-invite-12', 'succeeded', 1, now()),
  ('f9000000-0000-4000-8000-000000000013', 'c9000000-0000-4000-8000-000000000001', 'membership.invitation', 'membership_invitation', 'e9000000-0000-4000-8000-000000000013', 1, 'suppression-invite-13', 'succeeded', 1, now()),
  ('f9000000-0000-4000-8000-000000000021', 'c9000000-0000-4000-8000-000000000002', 'membership.invitation', 'membership_invitation', 'e9000000-0000-4000-8000-000000000021', 1, 'suppression-invite-21', 'succeeded', 1, now());

insert into public.notification_deliveries (
  id, group_id, outbox_job_id, recipient_membership_id, recipient_address,
  recipient_address_normalized, channel, provider_message_id, state, attempts,
  sent_at
)
values
  ('a9000000-0000-4000-8000-000000000011', 'c9000000-0000-4000-8000-000000000001', 'f9000000-0000-4000-8000-000000000011', 'd9000000-0000-4000-8000-000000000011', 'complaint-after-sent@example.test', 'complaint-after-sent@example.test', 'email', 'provider-suppression-11', 'sent', 1, now()),
  ('a9000000-0000-4000-8000-000000000012', 'c9000000-0000-4000-8000-000000000001', 'f9000000-0000-4000-8000-000000000012', 'd9000000-0000-4000-8000-000000000012', 'bounce-after-sent@example.test', 'bounce-after-sent@example.test', 'email', 'provider-suppression-12', 'sent', 1, now()),
  ('a9000000-0000-4000-8000-000000000013', 'c9000000-0000-4000-8000-000000000001', 'f9000000-0000-4000-8000-000000000013', 'd9000000-0000-4000-8000-000000000013', 'unrelated-target@example.test', 'unrelated-target@example.test', 'email', 'provider-suppression-13', 'sent', 1, now()),
  ('a9000000-0000-4000-8000-000000000021', 'c9000000-0000-4000-8000-000000000002', 'f9000000-0000-4000-8000-000000000021', 'd9000000-0000-4000-8000-000000000021', 'cross-tenant@example.test', 'cross-tenant@example.test', 'email', 'provider-suppression-21', 'sent', 1, now());

insert into public.email_suppressions (normalized_address, reason)
values
  ('complaint-after-sent@example.test', 'complaint'),
  ('bounce-after-sent@example.test', 'bounce'),
  ('cross-tenant@example.test', 'bounce'),
  ('unrelated-suppression@example.test', 'complaint');

create temporary table actor_a_projection on commit drop as
select *
from public.list_manageable_membership_invitations(
  'b9000000-0000-4000-8000-000000000001'
);

select is(
  (select delivery_state from actor_a_projection where invitation_id = 'e9000000-0000-4000-8000-000000000011'),
  'sent'::public.notification_delivery_state,
  'complaint-after-sent preserves the latest sent delivery state'
);
select is(
  (select delivery_action_required from actor_a_projection where invitation_id = 'e9000000-0000-4000-8000-000000000011'),
  true,
  'complaint-after-sent sets the authoritative action-required flag'
);
select is(
  (select delivery_action_required from actor_a_projection where invitation_id = 'e9000000-0000-4000-8000-000000000012'),
  true,
  'bounce-after-sent sets the authoritative action-required flag'
);
select is(
  (select delivery_state from actor_a_projection where invitation_id = 'e9000000-0000-4000-8000-000000000012'),
  'sent'::public.notification_delivery_state,
  'bounce-after-sent preserves the latest sent delivery state'
);
select is(
  (select delivery_action_required from actor_a_projection where invitation_id = 'e9000000-0000-4000-8000-000000000013'),
  false,
  'a healthy invitation does not require action'
);
select ok(
  not exists (
    select 1 from actor_a_projection
    where invitation_id = 'e9000000-0000-4000-8000-000000000021'
  ),
  'a cross-tenant invitation and its suppression do not enter the actor tenant projection'
);

create temporary table actor_b_projection on commit drop as
select *
from public.list_manageable_membership_invitations(
  'b9000000-0000-4000-8000-000000000002'
);

select is(
  (select delivery_action_required from actor_b_projection where invitation_id = 'e9000000-0000-4000-8000-000000000021'),
  true,
  'the owning tenant sees its own authoritative action-required fact'
);
select ok(
  pg_catalog.pg_get_function_result(
    'public.list_manageable_membership_invitations(uuid)'::regprocedure
  ) not like '%suppression_reason%',
  'suppression reasons are not exposed in the management projection contract'
);

select throws_ok(
  $$ select * from public.list_manageable_membership_invitations('b9000000-0000-4000-8000-000000000003') $$,
  'P0003',
  'actor_not_authorized',
  'ordinary members remain denied from the management projection'
);

select * from finish();
rollback;
