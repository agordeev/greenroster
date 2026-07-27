begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

select ok(
  has_function_privilege(
    'service_role',
    'public.get_member_detail_projection(uuid,uuid)',
    'execute'
  ),
  'service role can execute the protected member detail projection'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.get_member_detail_projection(uuid,uuid)',
    'execute'
  ),
  'authenticated clients cannot execute the member detail projection directly'
);

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at
)
values
  ('1a000000-0000-4000-8000-000000000001', 'detail-admin@example.test', now(), false, false, now(), now()),
  ('1a000000-0000-4000-8000-000000000002', 'detail-coordinator@example.test', now(), false, false, now(), now()),
  ('1a000000-0000-4000-8000-000000000003', 'detail-target@example.test', now(), false, false, now(), now()),
  ('1a000000-0000-4000-8000-000000000004', 'detail-inactive@example.test', now(), false, false, now(), now()),
  ('1a000000-0000-4000-8000-000000000005', 'detail-unverified@example.test', null, false, false, now(), now()),
  ('1a000000-0000-4000-8000-000000000006', 'detail-banned@example.test', now(), false, false, now(), now()),
  ('1a000000-0000-4000-8000-000000000007', 'detail-member@example.test', now(), false, false, now(), now()),
  ('1a000000-0000-4000-8000-000000000008', 'detail-other-admin@example.test', now(), false, false, now(), now());

update auth.users
set banned_until = now() + interval '1 day'
where id = '1a000000-0000-4000-8000-000000000006';

insert into public.user_profiles (user_id)
select id from auth.users
where id::text like '1a000000-0000-4000-8000-%';

insert into public.groups (id, name, time_zone)
values
  ('5a000000-0000-4000-8000-000000000001', 'Detail Group A', 'UTC'),
  ('5a000000-0000-4000-8000-000000000002', 'Detail Group B', 'UTC');

insert into public.memberships (
  id, group_id, user_id, role, status, activated_at, inactivated_at
)
values
  ('6a000000-0000-4000-8000-000000000001', '5a000000-0000-4000-8000-000000000001', '1a000000-0000-4000-8000-000000000001', 'administrator', 'active', now(), null),
  ('6a000000-0000-4000-8000-000000000002', '5a000000-0000-4000-8000-000000000001', '1a000000-0000-4000-8000-000000000002', 'coordinator', 'active', now(), null),
  ('6a000000-0000-4000-8000-000000000003', '5a000000-0000-4000-8000-000000000001', '1a000000-0000-4000-8000-000000000003', 'member', 'active', now(), null),
  ('6a000000-0000-4000-8000-000000000004', '5a000000-0000-4000-8000-000000000001', '1a000000-0000-4000-8000-000000000004', 'member', 'inactive', now(), now()),
  ('6a000000-0000-4000-8000-000000000005', '5a000000-0000-4000-8000-000000000001', '1a000000-0000-4000-8000-000000000005', 'member', 'active', now(), null),
  ('6a000000-0000-4000-8000-000000000006', '5a000000-0000-4000-8000-000000000001', '1a000000-0000-4000-8000-000000000006', 'member', 'active', now(), null),
  ('6a000000-0000-4000-8000-000000000007', '5a000000-0000-4000-8000-000000000001', '1a000000-0000-4000-8000-000000000007', 'member', 'active', now(), null),
  ('6a000000-0000-4000-8000-000000000008', '5a000000-0000-4000-8000-000000000002', '1a000000-0000-4000-8000-000000000008', 'administrator', 'active', now(), null),
  ('6a000000-0000-4000-8000-000000000009', '5a000000-0000-4000-8000-000000000002', null, 'member', 'pending', null, null);

insert into public.membership_golfer_profiles (membership_id, group_id, first_name, last_name)
values
  ('6a000000-0000-4000-8000-000000000001', '5a000000-0000-4000-8000-000000000001', 'Detail', 'Admin'),
  ('6a000000-0000-4000-8000-000000000002', '5a000000-0000-4000-8000-000000000001', 'Detail', 'Coordinator'),
  ('6a000000-0000-4000-8000-000000000003', '5a000000-0000-4000-8000-000000000001', 'Detail', 'Target');

insert into public.membership_invitations (
  id, group_id, membership_id, invited_email, invited_email_normalized,
  role, token_digest_sha256, token_key_version, status, issued_at, expires_at,
  inviter_user_id, accepted_at, revoked_at, expired_at, version
)
values
  ('7a000000-0000-4000-8000-000000000001', '5a000000-0000-4000-8000-000000000001', '6a000000-0000-4000-8000-000000000003', 'accepted-invite@example.test', 'accepted-invite@example.test', 'member', repeat('a', 64), 1, 'accepted', '2026-07-01T00:00:00Z', '2026-08-01T00:00:00Z', '1a000000-0000-4000-8000-000000000001', '2026-07-02T00:00:00Z', null, null, 2),
  ('7a000000-0000-4000-8000-000000000002', '5a000000-0000-4000-8000-000000000001', '6a000000-0000-4000-8000-000000000003', 'revoked-invite@example.test', 'revoked-invite@example.test', 'member', repeat('b', 64), 1, 'revoked', '2026-07-03T00:00:00Z', '2026-08-03T00:00:00Z', '1a000000-0000-4000-8000-000000000001', null, '2026-07-04T00:00:00Z', null, 3),
  ('7a000000-0000-4000-8000-000000000003', '5a000000-0000-4000-8000-000000000001', '6a000000-0000-4000-8000-000000000003', 'expired-invite@example.test', 'expired-invite@example.test', 'member', repeat('c', 64), 1, 'expired', '2026-07-05T00:00:00Z', '2026-07-06T00:00:00Z', '1a000000-0000-4000-8000-000000000001', null, null, '2026-07-07T00:00:00Z', 4),
  ('7a000000-0000-4000-8000-000000000004', '5a000000-0000-4000-8000-000000000001', '6a000000-0000-4000-8000-000000000003', 'pending-invite@example.test', 'pending-invite@example.test', 'member', repeat('d', 64), 1, 'pending', '2026-07-08T00:00:00Z', '2099-07-09T00:00:00Z', '1a000000-0000-4000-8000-000000000001', null, null, null, 5);

insert into public.notification_outbox_jobs (
  id, group_id, event_type, aggregate_type, aggregate_id, aggregate_version, idempotency_key
)
values
  ('8a000000-0000-4000-8000-000000000001', '5a000000-0000-4000-8000-000000000001', 'membership.invitation', 'membership_invitation', '7a000000-0000-4000-8000-000000000001', 1, 'detail-invite-1'),
  ('8a000000-0000-4000-8000-000000000002', '5a000000-0000-4000-8000-000000000001', 'membership.invitation', 'membership_invitation', '7a000000-0000-4000-8000-000000000002', 1, 'detail-invite-2'),
  ('8a000000-0000-4000-8000-000000000003', '5a000000-0000-4000-8000-000000000001', 'membership.invitation', 'membership_invitation', '7a000000-0000-4000-8000-000000000003', 1, 'detail-invite-3'),
  ('8a000000-0000-4000-8000-000000000004', '5a000000-0000-4000-8000-000000000001', 'membership.invitation', 'membership_invitation', '7a000000-0000-4000-8000-000000000004', 1, 'detail-invite-4'),
  ('8a000000-0000-4000-8000-000000000005', '5a000000-0000-4000-8000-000000000001', 'membership.role_changed', 'membership', '6a000000-0000-4000-8000-000000000003', 2, 'detail-role-1');

insert into public.notification_deliveries (
  id, group_id, outbox_job_id, recipient_membership_id, recipient_address,
  recipient_address_normalized, channel, provider_message_id, state, attempts,
  failure_reason, sent_at
)
values
  ('9a000000-0000-4000-8000-000000000001', '5a000000-0000-4000-8000-000000000001', '8a000000-0000-4000-8000-000000000001', '6a000000-0000-4000-8000-000000000003', 'detail-target@example.test', 'detail-target@example.test', 'email', 'provider-secret-1', 'sent', 1, null, now()),
  ('9a000000-0000-4000-8000-000000000002', '5a000000-0000-4000-8000-000000000001', '8a000000-0000-4000-8000-000000000002', '6a000000-0000-4000-8000-000000000003', 'detail-target@example.test', 'detail-target@example.test', 'email', null, 'failed_permanent', 2, 'hard_bounce', null),
  ('9a000000-0000-4000-8000-000000000003', '5a000000-0000-4000-8000-000000000001', '8a000000-0000-4000-8000-000000000003', '6a000000-0000-4000-8000-000000000003', 'detail-target@example.test', 'detail-target@example.test', 'email', null, 'suppressed', 3, 'provider_suppressed', null),
  ('9a000000-0000-4000-8000-000000000004', '5a000000-0000-4000-8000-000000000001', '8a000000-0000-4000-8000-000000000004', '6a000000-0000-4000-8000-000000000003', 'detail-target@example.test', 'detail-target@example.test', 'email', null, 'queued', 0, null, null),
  ('9a000000-0000-4000-8000-000000000005', '5a000000-0000-4000-8000-000000000001', '8a000000-0000-4000-8000-000000000005', '6a000000-0000-4000-8000-000000000003', 'detail-target@example.test', 'detail-target@example.test', 'email', null, 'retryable', 1, 'temporary_failure', null);

insert into public.email_suppressions (normalized_address, reason)
values ('detail-target@example.test', 'bounce');

insert into public.group_quota_settings (
  group_id, method, moving_average_history_length, precision, updated_by
)
values (
  '5a000000-0000-4000-8000-000000000001', 'moving_average', 4, 2,
  '1a000000-0000-4000-8000-000000000001'
);
insert into public.membership_quota_seed_totals (
  membership_id, group_id, position, point_total
)
values
  ('6a000000-0000-4000-8000-000000000003', '5a000000-0000-4000-8000-000000000001', 1, 10.50),
  ('6a000000-0000-4000-8000-000000000003', '5a000000-0000-4000-8000-000000000001', 2, 20.25);
insert into public.membership_quota_projections (
  membership_id, group_id, projection_version, settings_version,
  projection_ready, projected_quota, projection_source, effective_at
)
values (
  '6a000000-0000-4000-8000-000000000003', '5a000000-0000-4000-8000-000000000001',
  4, 1, true, 22.50, '{"kind":"seed_history","seed_positions":[1,2]}'::jsonb,
  '2026-07-27T12:00:00Z'
);

insert into public.membership_handicap_records (
  id, membership_id, group_id, handicap_id, handicap, source, as_of, created_at
)
values
  ('aa000000-0000-4000-8000-000000000001', '6a000000-0000-4000-8000-000000000003', '5a000000-0000-4000-8000-000000000001', 'GHIN-NEW', 12.3, 'import', '2026-07-27', '2026-07-27T12:00:00Z'),
  ('aa000000-0000-4000-8000-000000000002', '6a000000-0000-4000-8000-000000000003', '5a000000-0000-4000-8000-000000000001', 'GHIN-OLD', 11.8, 'manual', '2026-07-20', '2026-07-20T12:00:00Z');

insert into public.audit_events (
  id, group_id, actor_user_id, action, target_type, target_id,
  target_version, after_state, source, correlation_id, reason, occurred_at
)
values
  ('ab000000-0000-4000-8000-000000000001', '5a000000-0000-4000-8000-000000000001', '1a000000-0000-4000-8000-000000000001', 'member.updated', 'membership', '6a000000-0000-4000-8000-000000000003', 2, '{"safe":true}', 'portal', 'ac000000-0000-4000-8000-000000000001', 'Profile correction', '2026-07-27T12:00:00Z'),
  ('ab000000-0000-4000-8000-000000000002', '5a000000-0000-4000-8000-000000000001', '1a000000-0000-4000-8000-000000000001', 'membership.quota_bootstrap_configured', 'membership', '6a000000-0000-4000-8000-000000000003', 3, '{"membership_id":"6a000000-0000-4000-8000-000000000003","projection_version":3,"settings_version":1,"projection_ready":true,"projected_quota":21.25,"projection_source":{"kind":"seed_history","seed_positions":[1]},"initial_quota":18.50,"uses_initial_quota":true,"initial_quota_provenance":"member_bootstrap","seed_totals":[10.50]}', 'server', 'ac000000-0000-4000-8000-000000000002', 'Quota seed update', '2026-07-27T11:00:00Z'),
  ('ab000000-0000-4000-8000-000000000003', '5a000000-0000-4000-8000-000000000001', '1a000000-0000-4000-8000-000000000001', 'membership.invitation_issued', 'membership_invitation', '7a000000-0000-4000-8000-000000000001', 2, '{"invitation_id":"7a000000-0000-4000-8000-000000000001","membership_id":"6a000000-0000-4000-8000-000000000003","status":"accepted"}', 'server', 'ac000000-0000-4000-8000-000000000003', 'Invite lifecycle event', '2026-07-27T10:30:00Z'),
  ('ab000000-0000-4000-8000-000000000004', '5a000000-0000-4000-8000-000000000001', '1a000000-0000-4000-8000-000000000001', 'membership.quota_bootstrap_configured', 'membership', '6a000000-0000-4000-8000-000000000003', 4, '{"membership_id":"6a000000-0000-4000-8000-000000000003","projection_version":4,"settings_version":1,"projection_ready":true,"projected_quota":22.50,"projection_source":{"kind":"seed_history","seed_positions":[1,2]},"initial_quota":19.00,"uses_initial_quota":false,"initial_quota_provenance":"member_bootstrap","seed_totals":[10.50,20.25]}', 'server', 'ac000000-0000-4000-8000-000000000004', 'Quota seed update 2', '2026-07-27T11:30:00Z');

create temporary table detail_admin on commit drop as
select * from public.get_member_detail_projection(
  '1a000000-0000-4000-8000-000000000001',
  '6a000000-0000-4000-8000-000000000003'
);
select is((select actor_role from detail_admin), 'administrator'::public.membership_role, 'administrator role is returned');
select is((select account_email from detail_admin), 'detail-target@example.test', 'attached account e-mail is returned');
select is((select jsonb_array_length(invitations) from detail_admin), 4, 'all invitation lifecycle rows are returned');
select is((select invitations -> 0 ->> 'status' from detail_admin), 'pending', 'invitations are ordered newest-first');
select ok((select invitations::text from detail_admin) like '%accepted%', 'accepted invitations remain visible in lifecycle history');
select ok((select invitations::text from detail_admin) like '%revoked%', 'revoked invitations remain visible in lifecycle history');
select ok((select invitations::text from detail_admin) like '%expired%', 'expired invitations remain visible in lifecycle history');
select is((select account_email from detail_admin), 'detail-target@example.test', 'accepted invitation account address is available at the protected detail root');
select is((select jsonb_array_length(deliveries) from detail_admin), 5, 'invitation and role deliveries are returned');
select is((select deliveries -> 0 ->> 'suppression_reason' from detail_admin), 'bounce', 'administrators see safe suppression reason');
select ok((select deliveries::text from detail_admin) like '%hard_bounce%', 'administrators see safe delivery failure state');
select is((select quota -> 'current' ->> 'projected_quota' from detail_admin), '22.50', 'current quota preserves exact decimal text');
select is((select jsonb_array_length(quota -> 'history') from detail_admin), 2, 'quota history includes repeated bootstrap projections');
select is((select quota -> 'history' -> 0 ->> 'projection_version' from detail_admin), '4', 'quota history is ordered newest-first');
select is((select quota -> 'history' -> 0 -> 'admin' ->> 'initial_quota' from detail_admin), '19.00', 'administrator quota history includes the explicit initial quota');
select is((select quota -> 'history' -> 0 -> 'admin' -> 'seed_totals' -> 1 ->> 'point_total' from detail_admin), '20.25', 'administrator quota history preserves ordered seed totals');
select is((select quota -> 'admin' -> 'seed_totals' -> 0 ->> 'point_total' from detail_admin), '10.50', 'administrator sees ordered seed values');
select is((select quota -> 'admin' -> 'settings' ->> 'method' from detail_admin), 'moving_average', 'administrator sees quota settings');
select is((select handicaps -> 'current' ->> 'value' from detail_admin), '12.3', 'current handicap is newest by as-of and created time');
select is((select handicaps -> 'all' -> 1 ->> 'handicap_id' from detail_admin), 'GHIN-OLD', 'all handicap records are ordered newest-first');
select ok((select activity::text from detail_admin) like '%membership.quota_bootstrap_configured%', 'administrator sees all member-target audit actions');
select ok((select activity::text from detail_admin) like '%membership.invitation_issued%', 'administrator sees invitation-target audit actions joined to the member');
select ok((select to_jsonb(detail_admin)::text from detail_admin) not like '%provider-secret-1%', 'provider identifiers are never returned');
select ok((select to_jsonb(detail_admin)::text from detail_admin) not like '%private%', 'audit state and outbox payloads are never returned');

create temporary table detail_coordinator on commit drop as
select * from public.get_member_detail_projection(
  '1a000000-0000-4000-8000-000000000002',
  '6a000000-0000-4000-8000-000000000003'
);
select is((select actor_role from detail_coordinator), 'coordinator'::public.membership_role, 'coordinator role is returned');
select is((select quota -> 'admin' from detail_coordinator), 'null'::jsonb, 'coordinator cannot see initial quota, seeds, or settings');
select is((select deliveries -> 0 ->> 'suppression_reason' from detail_coordinator), null::text, 'coordinator cannot see suppression reason');
select ok((select activity::text from detail_coordinator) not like '%membership.quota_bootstrap_configured%', 'coordinator receives only operational audit actions');
select ok((select activity::text from detail_coordinator) like '%membership.invitation_issued%', 'coordinator sees operational invitation activity joined to the member');
select is((select quota -> 'current' ->> 'projected_quota' from detail_coordinator), '22.50', 'coordinator sees the operational current projection');
select is((select quota -> 'history' -> 0 -> 'admin' from detail_coordinator), 'null'::jsonb, 'coordinator quota history redacts administrator-only inputs');

select throws_ok(
  $$ select * from public.get_member_detail_projection('1a000000-0000-4000-8000-000000000002', '6a000000-0000-4000-8000-000000000009') $$,
  'P0002', 'member_not_found', 'cross-group target is unavailable to an authorized actor'
);
select throws_ok(
  $$ select * from public.get_member_detail_projection('1a000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000099') $$,
  'P0002', 'member_not_found', 'nonexistent target is unavailable after actor authorization'
);

select throws_ok(
  $$ select * from public.get_member_detail_projection('1a000000-0000-4000-8000-000000000004', '6a000000-0000-4000-8000-000000000003') $$,
  'P0003', 'actor_not_authorized', 'inactive actor is denied before target resolution'
);
select throws_ok(
  $$ select * from public.get_member_detail_projection('1a000000-0000-4000-8000-000000000005', 'aa000000-0000-4000-8000-000000000099') $$,
  'P0003', 'actor_not_authorized', 'unverified actor gets uniform denial for a guessed target'
);
select throws_ok(
  $$ select * from public.get_member_detail_projection('1a000000-0000-4000-8000-000000000006', '6a000000-0000-4000-8000-000000000003') $$,
  'P0003', 'actor_not_authorized', 'banned actor is denied'
);
select throws_ok(
  $$ select * from public.get_member_detail_projection('1a000000-0000-4000-8000-000000000007', '6a000000-0000-4000-8000-000000000003') $$,
  'P0003', 'actor_not_authorized', 'ordinary member cannot read the management projection'
);

select * from finish();
rollback;
