begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

select has_function(
  'public',
  'preview_membership_invitation',
  array['uuid', 'uuid', 'text'],
  'token-authenticated invitation preview exists'
);
select has_function(
  'public',
  'correct_membership_invitation_address',
  array['uuid', 'uuid', 'uuid', 'text', 'text', 'integer', 'timestamptz', 'text', 'uuid', 'uuid'],
  'invitation correction/regeneration function exists'
);
select has_function(
  'public',
  'regenerate_membership_invitation',
  array['uuid', 'uuid', 'uuid', 'text', 'integer', 'timestamptz', 'text', 'uuid', 'uuid'],
  'server-authoritative invitation regeneration function exists'
);
select has_function(
  'public',
  'revoke_membership_invitation',
  array['uuid', 'uuid', 'text', 'uuid', 'uuid'],
  'invitation revoke function exists'
);
select has_function(
  'public',
  'accept_membership_invitation',
  array['uuid', 'uuid', 'text', 'uuid', 'uuid'],
  'invitation acceptance function exists'
);
select has_function(
  'public',
  'list_manageable_membership_invitations',
  array['uuid'],
  'authorized invitation management projection exists'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.preview_membership_invitation(uuid,uuid,text)',
    'execute'
  ),
  'trusted server can preview invitations'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.accept_membership_invitation(uuid,uuid,text,uuid,uuid)',
    'execute'
  ),
  'authenticated clients cannot accept invitations directly'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.list_manageable_membership_invitations(uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.list_manageable_membership_invitations(uuid)',
    'execute'
  ),
  'only the trusted server can request the authorized management projection'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.regenerate_membership_invitation(uuid,uuid,uuid,text,integer,timestamptz,text,uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.regenerate_membership_invitation(uuid,uuid,uuid,text,integer,timestamptz,text,uuid,uuid)',
    'execute'
  ),
  'only the trusted server can regenerate an invitation'
);

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at
)
values
  ('a8000000-0000-4000-8000-000000000001', 'lifecycle-admin-a@example.test', now(), false, false, now(), now()),
  ('a8000000-0000-4000-8000-000000000002', 'lifecycle-coordinator-a@example.test', now(), false, false, now(), now()),
  ('a8000000-0000-4000-8000-000000000003', 'different-account@example.test', now(), false, false, now(), now()),
  ('a8000000-0000-4000-8000-000000000004', 'already-attached@example.test', now(), false, false, now(), now()),
  ('a8000000-0000-4000-8000-000000000005', 'unverified@example.test', null, false, false, now(), now()),
  ('a8000000-0000-4000-8000-000000000006', 'lifecycle-admin-b@example.test', now(), false, false, now(), now());

insert into public.user_profiles (user_id, display_name)
values
  ('a8000000-0000-4000-8000-000000000001', 'Lifecycle Admin A'),
  ('a8000000-0000-4000-8000-000000000002', 'Lifecycle Coordinator A'),
  ('a8000000-0000-4000-8000-000000000004', 'Already Attached'),
  ('a8000000-0000-4000-8000-000000000006', 'Lifecycle Admin B');

insert into public.groups (id, name, time_zone)
values
  ('b8000000-0000-4000-8000-000000000001', 'Lifecycle Group A', 'UTC'),
  ('b8000000-0000-4000-8000-000000000002', 'Lifecycle Group B', 'UTC');

insert into public.memberships (
  id, group_id, user_id, role, status, activated_at
)
values
  ('c8000000-0000-4000-8000-000000000001', 'b8000000-0000-4000-8000-000000000001', 'a8000000-0000-4000-8000-000000000001', 'administrator', 'active', now()),
  ('c8000000-0000-4000-8000-000000000002', 'b8000000-0000-4000-8000-000000000001', 'a8000000-0000-4000-8000-000000000002', 'coordinator', 'active', now()),
  ('c8000000-0000-4000-8000-000000000003', 'b8000000-0000-4000-8000-000000000001', null, 'member', 'pending', null),
  ('c8000000-0000-4000-8000-000000000004', 'b8000000-0000-4000-8000-000000000001', null, 'member', 'pending', null),
  ('c8000000-0000-4000-8000-000000000005', 'b8000000-0000-4000-8000-000000000001', 'a8000000-0000-4000-8000-000000000004', 'member', 'active', now()),
  ('c8000000-0000-4000-8000-000000000006', 'b8000000-0000-4000-8000-000000000001', null, 'member', 'pending', null),
  ('c8000000-0000-4000-8000-000000000007', 'b8000000-0000-4000-8000-000000000001', null, 'member', 'pending', null),
  ('c8000000-0000-4000-8000-000000000008', 'b8000000-0000-4000-8000-000000000002', null, 'member', 'pending', null),
  ('c8000000-0000-4000-8000-000000000009', 'b8000000-0000-4000-8000-000000000002', 'a8000000-0000-4000-8000-000000000006', 'administrator', 'active', now());

insert into public.membership_golfer_profiles (
  membership_id, group_id, first_name, last_name
)
select membership.id, membership.group_id, 'Pending', membership.id::text
from public.memberships as membership
where membership.user_id is null;

create temporary table first_invitation as
select * from public.issue_membership_invitation(
  'a8000000-0000-4000-8000-000000000002',
  'c8000000-0000-4000-8000-000000000003',
  'd8000000-0000-4000-8000-000000000001',
  'Original@One.example.test',
  repeat('a', 64),
  1,
  now() + interval '1 day',
  'e8000000-0000-4000-8000-000000000001',
  'e8000000-0000-4000-8000-000000000002'
);

create temporary table second_invitation as
select * from public.issue_membership_invitation(
  'a8000000-0000-4000-8000-000000000001',
  'c8000000-0000-4000-8000-000000000004',
  'd8000000-0000-4000-8000-000000000002',
  'Second@One.example.test',
  repeat('b', 64),
  1,
  now() + interval '1 day',
  'e8000000-0000-4000-8000-000000000003',
  'e8000000-0000-4000-8000-000000000004'
);

select throws_ok(
  $$ select * from public.correct_membership_invitation_address(
    'a8000000-0000-4000-8000-000000000002',
    'd8000000-0000-4000-8000-000000000002',
    'd8000000-0000-4000-8000-000000000003',
    'changed-by-coordinator@example.test',
    repeat('c', 64),
    1,
    now() + interval '2 days',
    'wrong role',
    'e8000000-0000-4000-8000-000000000005',
    'e8000000-0000-4000-8000-000000000006'
  ) $$,
  'P0003',
  'actor_not_authorized',
  'coordinator cannot correct a pending invitation address'
);

create temporary table regenerated_invitation as
select * from public.regenerate_membership_invitation(
  'a8000000-0000-4000-8000-000000000002',
  'd8000000-0000-4000-8000-000000000001',
  'd8000000-0000-4000-8000-000000000003',
  repeat('c', 64),
  2,
  now() + interval '2 days',
  'Resend requested',
  'e8000000-0000-4000-8000-000000000007',
  'e8000000-0000-4000-8000-000000000008'
);

select is(
  (select status from public.membership_invitations where id = 'd8000000-0000-4000-8000-000000000001'),
  'revoked'::public.membership_invitation_status,
  'regeneration revokes the prior single-use invitation'
);
select is(
  (select invited_email from regenerated_invitation),
  'Original@One.example.test'::text,
  'same-email regeneration retains the server-stored display address'
);
select is(
  (select token_key_version from public.membership_invitations where id = 'd8000000-0000-4000-8000-000000000003'),
  2,
  'regeneration stores the new token key version'
);
select is(
  (select state from public.notification_deliveries where outbox_job_id = (select queued_outbox_id from first_invitation)),
  'cancelled'::public.notification_delivery_state,
  'regeneration cancels the prior queued delivery'
);
select is(
  (select state from public.notification_deliveries where id = (select fresh_delivery_id from regenerated_invitation)),
  'queued'::public.notification_delivery_state,
  'regeneration queues exactly one fresh delivery'
);
select is(
  (select count(*) from public.notification_deliveries where recipient_membership_id = 'c8000000-0000-4000-8000-000000000003'),
  2::bigint,
  'old and fresh invitation deliveries remain auditable'
);
select is(
  (select count(*) from public.list_manageable_membership_invitations(
    'a8000000-0000-4000-8000-000000000002'
  )),
  2::bigint,
  'coordinator management projection returns only current pending invitations in the actor tenant'
);
select is(
  (select delivery_state from public.list_manageable_membership_invitations(
    'a8000000-0000-4000-8000-000000000002'
  ) where invitation_id = 'd8000000-0000-4000-8000-000000000003'),
  'queued'::public.notification_delivery_state,
  'management projection exposes the latest delivery state'
);
select ok(
  exists (
    select 1 from public.audit_events
    where action = 'membership.invitation_regenerated'
      and after_state ->> 'fresh_invitation_id' = 'd8000000-0000-4000-8000-000000000003'
  ),
  'same-email regeneration writes a distinct audit action'
);
select ok(
  not exists (
    select 1 from public.audit_events
    where action like 'membership.invitation_%'
      and (
        after_state ? 'invited_email'
        or after_state ? 'invited_email_normalized'
        or after_state ? 'token_digest_sha256'
        or after_state ? 'account_email'
      )
  ),
  'invitation lifecycle audit state contains no raw token or private e-mail'
);

select is(
  (select fresh_invitation_id from public.regenerate_membership_invitation(
    'a8000000-0000-4000-8000-000000000002',
    'd8000000-0000-4000-8000-000000000001',
    'd8000000-0000-4000-8000-000000000003',
    repeat('c', 64),
    2,
    now() + interval '3 days',
    'Resend requested',
    'e8000000-0000-4000-8000-000000000007',
    'e8000000-0000-4000-8000-000000000008'
  )),
  'd8000000-0000-4000-8000-000000000003'::app.entity_id,
  'regeneration retry returns the authoritative fresh invitation despite a recomputed expiry'
);

select throws_ok(
  $$ select * from public.regenerate_membership_invitation(
    'a8000000-0000-4000-8000-000000000002',
    'd8000000-0000-4000-8000-000000000001',
    'd8000000-0000-4000-8000-000000000003',
    repeat('d', 64),
    2,
    now() + interval '2 days',
    'Resend requested',
    'e8000000-0000-4000-8000-000000000007',
    'e8000000-0000-4000-8000-000000000008'
  ) $$,
  '23505',
  'operation_id_reused',
  'regeneration retry cannot change its token digest'
);

create temporary table corrected_invitation as
select * from public.correct_membership_invitation_address(
  'a8000000-0000-4000-8000-000000000001',
  'd8000000-0000-4000-8000-000000000002',
  'd8000000-0000-4000-8000-000000000004',
  'Corrected@Example.test',
  repeat('d', 64),
  1,
  now() + interval '2 days',
  'Address correction confirmed',
  'e8000000-0000-4000-8000-000000000009',
  'e8000000-0000-4000-8000-000000000010'
);

select is(
  (select action from public.audit_events where operation_id = 'e8000000-0000-4000-8000-000000000010'),
  'membership.invitation_address_corrected'::text,
  'administrator address correction writes its distinct audit action'
);
select is(
  (select invited_email_normalized from corrected_invitation),
  'corrected@example.test'::text,
  'administrator correction normalizes the replacement address'
);

select throws_ok(
  $$ select * from public.revoke_membership_invitation(
    'a8000000-0000-4000-8000-000000000003',
    'd8000000-0000-4000-8000-000000000004',
    'member cannot revoke',
    'e8000000-0000-4000-8000-000000000011',
    'e8000000-0000-4000-8000-000000000012'
  ) $$,
  'P0003',
  'actor_not_authorized',
  'ordinary members cannot revoke invitations'
);

create temporary table revoke_invitation as
select * from public.revoke_membership_invitation(
  'a8000000-0000-4000-8000-000000000002',
  'd8000000-0000-4000-8000-000000000004',
  'No longer needed',
  'e8000000-0000-4000-8000-000000000013',
  'e8000000-0000-4000-8000-000000000014'
);

select is(
  (select status from revoke_invitation),
  'revoked'::public.membership_invitation_status,
  'coordinator can revoke a pending invitation'
);
select is(
  (select state from public.notification_deliveries where id = (select queued_delivery_id from second_invitation)),
  'cancelled'::public.notification_delivery_state,
  'revocation cancels queued delivery'
);
select is(
  (select revoked_invitation_id from public.revoke_membership_invitation(
    'a8000000-0000-4000-8000-000000000002',
    'd8000000-0000-4000-8000-000000000004',
    'No longer needed',
    'e8000000-0000-4000-8000-000000000013',
    'e8000000-0000-4000-8000-000000000014'
  )),
  'd8000000-0000-4000-8000-000000000004'::app.entity_id,
  'revoke retry returns the authoritative invitation'
);
select throws_ok(
  $$ select * from public.revoke_membership_invitation(
    'a8000000-0000-4000-8000-000000000002',
    'd8000000-0000-4000-8000-000000000004',
    'Changed reason',
    'e8000000-0000-4000-8000-000000000013',
    'e8000000-0000-4000-8000-000000000014'
  ) $$,
  '23505',
  'operation_id_reused',
  'revoke retry cannot change its reason'
);

create temporary table preview_result as
select * from public.preview_membership_invitation(
  'a8000000-0000-4000-8000-000000000003',
  'd8000000-0000-4000-8000-000000000003',
  repeat('c', 64)
);

select is(
  (select group_name from preview_result),
  'Lifecycle Group A'::text,
  'preview resolves the invitation group'
);
select is(
  (select invited_email from preview_result),
  'Original@One.example.test'::text,
  'preview returns the invited display address'
);
select is(
  (select account_email from preview_result),
  'different-account@example.test'::text,
  'preview returns the authenticated account address to the invitee'
);
select is(
  (select email_matches from preview_result),
  false,
  'preview explicitly allows a safe invited/account e-mail mismatch'
);

create temporary table accepted_invitation as
select * from public.accept_membership_invitation(
  'a8000000-0000-4000-8000-000000000003',
  'd8000000-0000-4000-8000-000000000003',
  repeat('c', 64),
  'e8000000-0000-4000-8000-000000000015',
  'e8000000-0000-4000-8000-000000000016'
);

select is(
  (select status from accepted_invitation),
  'accepted'::public.membership_invitation_status,
  'acceptance consumes the invitation exactly once'
);
select is(
  (select status from public.memberships where id = 'c8000000-0000-4000-8000-000000000003'),
  'active'::public.membership_status,
  'acceptance activates the pending membership'
);
select is(
  (select user_id from public.memberships where id = 'c8000000-0000-4000-8000-000000000003'),
  'a8000000-0000-4000-8000-000000000003'::app.entity_id,
  'acceptance attaches the authenticated identity'
);
select ok(
  exists (select 1 from public.user_profiles where user_id = 'a8000000-0000-4000-8000-000000000003'),
  'acceptance creates a blank profile for first-run completion'
);
select is(
  (select state from public.notification_deliveries where id = (select fresh_delivery_id from regenerated_invitation)),
  'cancelled'::public.notification_delivery_state,
  'acceptance cancels an unsent invitation delivery'
);
select is(
  (select accepted_invitation_id from public.accept_membership_invitation(
    'a8000000-0000-4000-8000-000000000003',
    'd8000000-0000-4000-8000-000000000003',
    repeat('c', 64),
    'e8000000-0000-4000-8000-000000000015',
    'e8000000-0000-4000-8000-000000000016'
  )),
  'd8000000-0000-4000-8000-000000000003'::app.entity_id,
  'acceptance retry returns the original success'
);
select throws_ok(
  $$ select * from public.accept_membership_invitation(
    'a8000000-0000-4000-8000-000000000003',
    'd8000000-0000-4000-8000-000000000003',
    repeat('d', 64),
    'e8000000-0000-4000-8000-000000000015',
    'e8000000-0000-4000-8000-000000000016'
  ) $$,
  '23505',
  'operation_id_reused',
  'acceptance retry cannot change its token digest'
);

create temporary table attached_identity_invitation as
select * from public.issue_membership_invitation(
  'a8000000-0000-4000-8000-000000000001',
  'c8000000-0000-4000-8000-000000000006',
  'd8000000-0000-4000-8000-000000000005',
  'attached-target@example.test',
  repeat('e', 64),
  1,
  now() + interval '1 day',
  'e8000000-0000-4000-8000-000000000017',
  'e8000000-0000-4000-8000-000000000018'
);

select throws_ok(
  $$ select * from public.accept_membership_invitation(
    'a8000000-0000-4000-8000-000000000004',
    'd8000000-0000-4000-8000-000000000005',
    repeat('e', 64),
    'e8000000-0000-4000-8000-000000000019',
    'e8000000-0000-4000-8000-000000000020'
  ) $$,
  '23505',
  'identity_already_attached',
  'an identity with lifetime membership cannot accept a second invitation'
);

create temporary table unverified_invitation as
select * from public.issue_membership_invitation(
  'a8000000-0000-4000-8000-000000000001',
  'c8000000-0000-4000-8000-000000000007',
  'd8000000-0000-4000-8000-000000000006',
  'unverified@example.test',
  repeat('f', 64),
  1,
  now() + interval '1 day',
  'e8000000-0000-4000-8000-000000000021',
  'e8000000-0000-4000-8000-000000000022'
);

select throws_ok(
  $$ select * from public.accept_membership_invitation(
    'a8000000-0000-4000-8000-000000000005',
    'd8000000-0000-4000-8000-000000000006',
    repeat('f', 64),
    'e8000000-0000-4000-8000-000000000023',
    'e8000000-0000-4000-8000-000000000024'
  ) $$,
  'P0002',
  'invitation_identity_unavailable',
  'unverified identities cannot accept invitations'
);

update public.membership_invitations
set issued_at = now() - interval '2 days',
    expires_at = now() - interval '1 second'
where id = (select issued_invitation_id from unverified_invitation);

select is(
  (select status from public.preview_membership_invitation(
    'a8000000-0000-4000-8000-000000000001',
    'd8000000-0000-4000-8000-000000000006',
    repeat('f', 64)
  )),
  'expired'::public.membership_invitation_status,
  'preview classifies a pending invitation past expiry safely'
);

select is(
  (select status from public.preview_membership_invitation(
    'a8000000-0000-4000-8000-000000000003',
    'd8000000-0000-4000-8000-000000000001',
    repeat('a', 64)
  )),
  'revoked'::public.membership_invitation_status,
  'preview classifies a revoked invitation without exposing raw token state'
);

select * from finish();

rollback;
