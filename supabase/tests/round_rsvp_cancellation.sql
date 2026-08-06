begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

select has_function(
  'public',
  'set_round_participant_rsvp',
  array['uuid','uuid','public.round_rsvp_status','bigint','text','uuid','uuid'],
  'member RSVP mutation RPC exists'
);
select has_function(
  'public',
  'cancel_round',
  array['uuid','uuid','text','bigint','uuid','uuid'],
  'round cancellation RPC exists'
);
select has_function(
  'public',
  'claim_round_cancelled_email',
  array['uuid','timestamptz'],
  'cancellation e-mail claim RPC exists'
);
select has_function(
  'public',
  'claim_round_cancelled_push',
  array['uuid','timestamptz'],
  'cancellation push claim RPC exists'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.set_round_participant_rsvp(uuid,uuid,public.round_rsvp_status,bigint,text,uuid,uuid)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.cancel_round(uuid,uuid,text,bigint,uuid,uuid)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.claim_round_cancelled_email(uuid,timestamptz)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.claim_round_cancelled_push(uuid,timestamptz)',
    'execute'
  ),
  'trusted server can call the round operation and notification boundaries'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.set_round_participant_rsvp(uuid,uuid,public.round_rsvp_status,bigint,text,uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.cancel_round(uuid,uuid,text,bigint,uuid,uuid)',
    'execute'
  ),
  'client roles cannot call privileged round mutations'
);
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class where oid = 'public.round_participants'::regclass),
  'participants remain force-RLS protected'
);

insert into auth.users (id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at)
values
  ('19000000-0000-4000-8000-000000000001', 'rsvp-admin@example.test', now(), false, false, now(), now()),
  ('19000000-0000-4000-8000-000000000002', 'rsvp-member@example.test', now(), false, false, now(), now()),
  ('19000000-0000-4000-8000-000000000003', 'rsvp-other@example.test', now(), false, false, now(), now()),
  ('19000000-0000-4000-8000-000000000004', 'rsvp-recovery@example.test', now(), false, false, now(), now());
insert into auth.users (id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at)
values ('19000000-0000-4000-8000-000000000005', 'rsvp-other-b@example.test', now(), false, false, now(), now());

update auth.users
set raw_app_meta_data = '{"greenroster_password_recovery":true}'::jsonb
where id = '19000000-0000-4000-8000-000000000004';

insert into public.user_profiles (user_id, first_name, last_name)
values
  ('19000000-0000-4000-8000-000000000001', 'Rsvp', 'Admin'),
  ('19000000-0000-4000-8000-000000000002', 'Rsvp', 'Member'),
  ('19000000-0000-4000-8000-000000000003', 'Rsvp', 'Other'),
  ('19000000-0000-4000-8000-000000000004', 'Rsvp', 'Recovery'),
  ('19000000-0000-4000-8000-000000000005', 'Rsvp', 'Other B');

insert into public.groups (id, name, time_zone)
values
  ('59000000-0000-4000-8000-000000000001', 'RSVP Group A', 'America/New_York'),
  ('59000000-0000-4000-8000-000000000002', 'RSVP Group B', 'UTC');

insert into public.memberships (id, group_id, user_id, role, status, activated_at)
values
  ('69000000-0000-4000-8000-000000000001', '59000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000001', 'administrator', 'active', now()),
  ('69000000-0000-4000-8000-000000000002', '59000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000002', 'member', 'active', now()),
  ('69000000-0000-4000-8000-000000000003', '59000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000003', 'member', 'active', now()),
  ('69000000-0000-4000-8000-000000000004', '59000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000004', 'member', 'active', now()),
  ('69000000-0000-4000-8000-000000000005', '59000000-0000-4000-8000-000000000002', '19000000-0000-4000-8000-000000000005', 'member', 'active', now());

insert into public.membership_golfer_profiles (membership_id, group_id, first_name, last_name, tee_location)
values
  ('69000000-0000-4000-8000-000000000001', '59000000-0000-4000-8000-000000000001', 'Rsvp', 'Admin', 'middle'),
  ('69000000-0000-4000-8000-000000000002', '59000000-0000-4000-8000-000000000001', 'Rsvp', 'Member', 'middle'),
  ('69000000-0000-4000-8000-000000000003', '59000000-0000-4000-8000-000000000001', 'Rsvp', 'Other', 'middle'),
  ('69000000-0000-4000-8000-000000000004', '59000000-0000-4000-8000-000000000001', 'Rsvp', 'Recovery', 'middle'),
  ('69000000-0000-4000-8000-000000000005', '59000000-0000-4000-8000-000000000002', 'Rsvp', 'Other B', 'middle');

insert into public.rounds (
  id, group_id, description, scheduled_at, group_time_zone, format, state,
  version, published_at, created_by, rsvp_deadline_at
)
values
  ('79000000-0000-4000-8000-000000000001', '59000000-0000-4000-8000-000000000001', 'Published RSVP', now() + interval '2 hours', 'America/New_York', 'individual_gross', 'published', 1, now(), '19000000-0000-4000-8000-000000000001', now() + interval '1 hour'),
  ('79000000-0000-4000-8000-000000000002', '59000000-0000-4000-8000-000000000001', 'Live RSVP', now() + interval '2 hours', 'America/New_York', 'individual_gross', 'live', 1, now(), '19000000-0000-4000-8000-000000000001', now() + interval '1 hour'),
  ('79000000-0000-4000-8000-000000000003', '59000000-0000-4000-8000-000000000001', 'Deadline RSVP', now() + interval '2 hours', 'America/New_York', 'individual_gross', 'published', 1, now(), '19000000-0000-4000-8000-000000000001', now() - interval '1 minute'),
  ('79000000-0000-4000-8000-000000000004', '59000000-0000-4000-8000-000000000001', 'Draft cancellation', now() + interval '2 hours', 'America/New_York', 'individual_gross', 'draft', 1, null, '19000000-0000-4000-8000-000000000001', null),
  ('79000000-0000-4000-8000-000000000005', '59000000-0000-4000-8000-000000000002', 'Cross group', now() + interval '2 hours', 'UTC', 'individual_gross', 'published', 1, now(), '19000000-0000-4000-8000-000000000003', now() + interval '1 hour');

insert into public.round_participants (id, round_id, group_id, membership_id)
values
  ('89000000-0000-4000-8000-000000000001', '79000000-0000-4000-8000-000000000001', '59000000-0000-4000-8000-000000000001', '69000000-0000-4000-8000-000000000002'),
  ('89000000-0000-4000-8000-000000000002', '79000000-0000-4000-8000-000000000002', '59000000-0000-4000-8000-000000000001', '69000000-0000-4000-8000-000000000002'),
  ('89000000-0000-4000-8000-000000000003', '79000000-0000-4000-8000-000000000003', '59000000-0000-4000-8000-000000000001', '69000000-0000-4000-8000-000000000002'),
  ('89000000-0000-4000-8000-000000000004', '79000000-0000-4000-8000-000000000001', '59000000-0000-4000-8000-000000000001', '69000000-0000-4000-8000-000000000004'),
  ('89000000-0000-4000-8000-000000000005', '79000000-0000-4000-8000-000000000001', '59000000-0000-4000-8000-000000000001', '69000000-0000-4000-8000-000000000003');

create temporary table rsvp_first as
select * from public.set_round_participant_rsvp(
  '19000000-0000-4000-8000-000000000002',
  '79000000-0000-4000-8000-000000000001',
  'playing', 1, 'mobile',
  '29000000-0000-4000-8000-000000000001',
  '39000000-0000-4000-8000-000000000001'
);
select is((select rsvp_status from rsvp_first), 'playing'::public.round_rsvp_status, 'member can set own published RSVP');
select is((select version from rsvp_first), 2::bigint, 'RSVP advances participant version');
select is(
  (select count(*) from public.audit_events where action = 'round.participant_rsvp_changed' and operation_id = '39000000-0000-4000-8000-000000000001'),
  1::bigint,
  'RSVP writes one audit event'
);
select is(
  (select source from public.audit_events where action = 'round.participant_rsvp_changed' and operation_id = '39000000-0000-4000-8000-000000000001'),
  'mobile',
  'RSVP audit preserves the client source'
);

create temporary table rsvp_retry as
select * from public.set_round_participant_rsvp(
  '19000000-0000-4000-8000-000000000002',
  '79000000-0000-4000-8000-000000000001',
  'playing', 1, 'mobile',
  '29000000-0000-4000-8000-000000000001',
  '39000000-0000-4000-8000-000000000001'
);
select is((select version from rsvp_retry), 2::bigint, 'same RSVP operation replays the committed response');
select is(
  (select count(*) from public.audit_events where action = 'round.participant_rsvp_changed' and operation_id = '39000000-0000-4000-8000-000000000001'),
  1::bigint,
  'same RSVP operation does not duplicate the audit event'
);

create temporary table member_read_version as
select * from public.read_round_participants(
  '19000000-0000-4000-8000-000000000002',
  '79000000-0000-4000-8000-000000000001'
);
select is((select count(*) from member_read_version), 1::bigint, 'member read remains scoped to own participant');
select is((select version from member_read_version), 2::bigint, 'member read exposes current participant version');
create temporary table rsvp_after_read as
select * from public.set_round_participant_rsvp(
  '19000000-0000-4000-8000-000000000002',
  '79000000-0000-4000-8000-000000000001',
  'not_playing',
  (select version from member_read_version),
  'member_web',
  '29000000-0000-4000-8000-000000000013',
  '39000000-0000-4000-8000-000000000013'
);
select is((select version from rsvp_after_read), 3::bigint, 'read version is accepted by RSVP mutation');

select throws_ok(
  $$ select * from public.set_round_participant_rsvp(
    '19000000-0000-4000-8000-000000000002',
    '79000000-0000-4000-8000-000000000001',
    'not_playing', 2, 'member_web',
    '29000000-0000-4000-8000-000000000002',
    '39000000-0000-4000-8000-000000000001'
  ) $$,
  '23505', 'operation_id_reused', 'reusing an RSVP operation for another request is rejected'
);
select throws_ok(
  $$ select * from public.set_round_participant_rsvp(
    '19000000-0000-4000-8000-000000000002',
    '79000000-0000-4000-8000-000000000002',
    'playing', 1, 'mobile',
    '29000000-0000-4000-8000-000000000003',
    '39000000-0000-4000-8000-000000000003'
  ) $$,
  'P0001', 'round_rsvp_closed', 'Live rounds reject member RSVP'
);
select throws_ok(
  $$ select * from public.set_round_participant_rsvp(
    '19000000-0000-4000-8000-000000000002',
    '79000000-0000-4000-8000-000000000003',
    'playing', 1, 'mobile',
    '29000000-0000-4000-8000-000000000004',
    '39000000-0000-4000-8000-000000000004'
  ) $$,
  'P0001', 'round_rsvp_closed', 'expired RSVP deadline rejects member RSVP'
);
select throws_ok(
  $$ select * from public.set_round_participant_rsvp(
    '19000000-0000-4000-8000-000000000002',
    '79000000-0000-4000-8000-000000000005',
    'playing', 1, 'mobile',
    '29000000-0000-4000-8000-000000000005',
    '39000000-0000-4000-8000-000000000005'
  ) $$,
  'P0002', 'round_not_found', 'cross-group round is not disclosed to member'
);
select throws_ok(
  $$ select * from public.set_round_participant_rsvp(
    '19000000-0000-4000-8000-000000000004',
    '79000000-0000-4000-8000-000000000001',
    'playing', 1, 'mobile',
    '29000000-0000-4000-8000-000000000006',
    '39000000-0000-4000-8000-000000000006'
  ) $$,
  'P0003', 'recovery_session_forbidden', 'password-recovery session cannot RSVP'
);
update public.memberships
set status = 'inactive', inactivated_at = now()
where id = '69000000-0000-4000-8000-000000000002';
select throws_ok(
  $$ select * from public.set_round_participant_rsvp(
    '19000000-0000-4000-8000-000000000002',
    '79000000-0000-4000-8000-000000000001',
    'playing', 1, 'mobile',
    '29000000-0000-4000-8000-000000000012',
    '39000000-0000-4000-8000-000000000012'
  ) $$,
  'P0003', 'actor_not_authorized', 'inactive member cannot RSVP'
);
update public.memberships
set status = 'active', activated_at = now(), inactivated_at = null
where id = '69000000-0000-4000-8000-000000000002';
update public.memberships
set status = 'inactive', inactivated_at = now()
where id = '69000000-0000-4000-8000-000000000003';

insert into public.push_devices (
  device_id, user_id, expo_push_token, platform, last_seen_at
)
values (
  'b9000000-0000-4000-8000-000000000001',
  '19000000-0000-4000-8000-000000000002',
  'ExponentPushToken[rsvp-member-device]',
  'ios',
  now()
);

-- Seed one pending publication delivery; cancellation must terminalize it.
insert into public.notification_outbox_jobs (
  id, group_id, event_type, aggregate_type, aggregate_id, aggregate_version, idempotency_key
)
values (
  '99000000-0000-4000-8000-000000000001', '59000000-0000-4000-8000-000000000001',
  'round.published', 'round', '79000000-0000-4000-8000-000000000001', 1,
  'rsvp-test-published-job'
);
insert into public.notification_deliveries (
  id, group_id, outbox_job_id, recipient_membership_id, recipient_address,
  recipient_address_normalized, channel
)
values (
  'a9000000-0000-4000-8000-000000000001', '59000000-0000-4000-8000-000000000001',
  '99000000-0000-4000-8000-000000000001', '69000000-0000-4000-8000-000000000002',
  'rsvp-member@example.test', 'rsvp-member@example.test', 'email'
);

create temporary table cancelled_round as
select * from public.cancel_round(
  '19000000-0000-4000-8000-000000000001',
  '79000000-0000-4000-8000-000000000001',
  'Weather closure', 1,
  '29000000-0000-4000-8000-000000000007',
  '39000000-0000-4000-8000-000000000007'
);
select is((select state from cancelled_round), 'cancelled'::public.round_state, 'administrator can cancel published round');
select is((select cancellation_reason from cancelled_round), 'Weather closure', 'cancellation reason is retained');
select is((select participant_count from cancelled_round), 3::bigint, 'cancellation counts all participants');
select is((select notification_count from cancelled_round), 2::bigint, 'cancellation reports only queued participant deliveries');
select is(
  (select state from public.notification_deliveries where id = 'a9000000-0000-4000-8000-000000000001'),
  'cancelled'::public.notification_delivery_state,
  'pending publication delivery is cancelled atomically'
);
select is(
  (select state from public.notification_outbox_jobs where id = '99000000-0000-4000-8000-000000000001'),
  'cancelled'::public.notification_outbox_job_state,
  'pending publication outbox job is cancelled atomically'
);
select is(
  (select count(*) from public.notification_outbox_jobs where aggregate_id = '79000000-0000-4000-8000-000000000001' and event_type = 'round.cancelled'),
  3::bigint,
  'cancellation creates durable participant outbox jobs'
);
select is(
  (select count(*)
   from public.notification_push_deliveries as delivery
   join public.notification_outbox_jobs as outbox
     on outbox.id = delivery.outbox_job_id
    and outbox.group_id = delivery.group_id
   where outbox.aggregate_id = '79000000-0000-4000-8000-000000000001'
     and outbox.event_type = 'round.cancelled'
     and delivery.recipient_membership_id = '69000000-0000-4000-8000-000000000002'),
  1::bigint,
  'cancellation fan-out creates one push child for each active device'
);
select is(
  (select delivery.state
   from public.notification_push_deliveries as delivery
   join public.notification_outbox_jobs as outbox
     on outbox.id = delivery.outbox_job_id
    and outbox.group_id = delivery.group_id
   where outbox.aggregate_id = '79000000-0000-4000-8000-000000000001'
     and outbox.event_type = 'round.cancelled'
     and delivery.recipient_membership_id = '69000000-0000-4000-8000-000000000002'),
  'queued'::public.notification_delivery_state,
  'cancellation push child starts queued'
);
select is(
  (select delivery.state
   from public.notification_deliveries as delivery
   join public.notification_outbox_jobs as outbox
     on outbox.id = delivery.outbox_job_id
    and outbox.group_id = delivery.group_id
   where outbox.aggregate_id = '79000000-0000-4000-8000-000000000001'
     and outbox.event_type = 'round.cancelled'
     and delivery.recipient_membership_id = '69000000-0000-4000-8000-000000000003'),
  'cancelled'::public.notification_delivery_state,
  'inactive participant cancellation delivery is terminal'
);
select is(
  (select outbox.state
   from public.notification_outbox_jobs as outbox
   join public.notification_deliveries as delivery
     on delivery.outbox_job_id = outbox.id
    and delivery.group_id = outbox.group_id
   where outbox.aggregate_id = '79000000-0000-4000-8000-000000000001'
     and outbox.event_type = 'round.cancelled'
     and delivery.recipient_membership_id = '69000000-0000-4000-8000-000000000003'),
  'cancelled'::public.notification_outbox_job_state,
  'inactive participant cancellation outbox job is terminal'
);
select is(
  (select outbox.safe_error
   from public.notification_outbox_jobs as outbox
   join public.notification_deliveries as delivery
     on delivery.outbox_job_id = outbox.id
    and delivery.group_id = outbox.group_id
   where outbox.aggregate_id = '79000000-0000-4000-8000-000000000001'
     and outbox.event_type = 'round.cancelled'
     and delivery.recipient_membership_id = '69000000-0000-4000-8000-000000000003'),
  'member_inactive',
  'inactive cancellation outbox preserves delivery failure reason'
);
select ok(
  (select outbox.finished_at is not null
   from public.notification_outbox_jobs as outbox
   join public.notification_deliveries as delivery
     on delivery.outbox_job_id = outbox.id
    and delivery.group_id = outbox.group_id
   where outbox.aggregate_id = '79000000-0000-4000-8000-000000000001'
     and outbox.event_type = 'round.cancelled'
     and delivery.recipient_membership_id = '69000000-0000-4000-8000-000000000003'),
  'inactive participant cancellation outbox job records completion time'
);
select is(
  (select count(*) from public.audit_events where action = 'round.cancelled' and operation_id = '39000000-0000-4000-8000-000000000007'),
  1::bigint,
  'cancellation history is append-only and audited'
);

-- A retryable cancellation e-mail must not delay its queued mandatory push
-- sibling. The child keeps its future e-mail retry timestamp while the shared
-- parent is reconciled to the earliest due sibling.
-- Keep the member-with-device outbox deterministic; the other active member
-- has no push sibling and is covered by the later e-mail claim assertions.
update public.notification_deliveries as delivery
set state = 'cancelled',
    failure_reason = 'test_other_recipient'
from public.notification_outbox_jobs as outbox
where delivery.outbox_job_id = outbox.id
  and delivery.group_id = outbox.group_id
  and outbox.event_type = 'round.cancelled'
  and outbox.aggregate_id = '79000000-0000-4000-8000-000000000001'
  and delivery.recipient_membership_id <> '69000000-0000-4000-8000-000000000002';

create temporary table cancellation_email_retry_claim as
select * from public.claim_round_cancelled_email(
  'b9000000-0000-4000-8000-000000000004',
  now() - interval '1 minute'
);
select is(
  (select count(*) from cancellation_email_retry_claim),
  1::bigint,
  'cancellation e-mail retry regression claims the due e-mail child'
);
select public.record_email_send_failure(
  (select delivery_id from cancellation_email_retry_claim),
  'b9000000-0000-4000-8000-000000000004',
  'provider_unavailable',
  now() + interval '1 hour'
);
select is(
  (select state
   from public.notification_deliveries
   where id = (select delivery_id from cancellation_email_retry_claim)),
  'retryable'::public.notification_delivery_state,
  'cancellation e-mail retry remains durable'
);
select ok(
  (select next_attempt_at > now()
   from public.notification_deliveries
   where id = (select delivery_id from cancellation_email_retry_claim)),
  'cancellation e-mail keeps its future retry timestamp'
);
select ok(
  (select next_attempt_at <= pg_catalog.clock_timestamp() + interval '1 second'
   from public.notification_outbox_jobs
   where id = (select outbox_job_id from cancellation_email_retry_claim)),
  'queued cancellation push sibling keeps the aggregate parent due'
);
select is(
  (select next_attempt_at
   from public.notification_outbox_jobs
   where id = (select outbox_job_id from cancellation_email_retry_claim)),
  (select next_attempt_at
   from public.notification_push_deliveries
   where outbox_job_id = (select outbox_job_id from cancellation_email_retry_claim)
     and state = 'queued'),
  'cancellation parent uses the queued push sibling due time'
);

-- Cancellation push is mandatory and quiet-hours exempt. The claim returns the
-- raw token only to service_role and never stores it in the delivery row.
create temporary table cancellation_push_claim as
select * from public.claim_round_cancelled_push(
  'b9000000-0000-4000-8000-000000000002',
  now() - interval '1 minute'
);
select is((select count(*) from cancellation_push_claim), 1::bigint, 'cancellation push claim returns one due device');
select is((select cancellation_reason from cancellation_push_claim), 'Weather closure', 'push claim preserves cancellation reason');
select is((select expo_push_token from cancellation_push_claim), 'ExponentPushToken[rsvp-member-device]', 'push claim returns token only to trusted worker');
select is(
  (select state from public.notification_push_deliveries where id = (select delivery_id from cancellation_push_claim)),
  'sending'::public.notification_delivery_state,
  'cancellation push claim leases the child'
);
select ok(
  (select count(*) from public.notification_push_deliveries
   where id = (select delivery_id from cancellation_push_claim)
     and provider_message_id is null) = 1,
  'raw push token is not persisted in the delivery row'
);
select public.record_round_cancelled_push_send_failure(
  (select delivery_id from cancellation_push_claim),
  'b9000000-0000-4000-8000-000000000002',
  'provider_unavailable',
  now() + interval '1 hour'
);
select is(
  (select state from public.notification_push_deliveries where id = (select delivery_id from cancellation_push_claim)),
  'retryable'::public.notification_delivery_state,
  'provider-unavailable cancellation push releases a retryable child'
);
select is(
  (select state from public.notification_outbox_jobs where id = (select outbox_job_id from cancellation_push_claim)),
  'retryable'::public.notification_outbox_job_state,
  'provider-unavailable cancellation push keeps the parent retryable'
);
select ok(
  (select next_attempt_at > now() from public.notification_push_deliveries where id = (select delivery_id from cancellation_push_claim)),
  'provider-unavailable cancellation push schedules a future retry'
);
update public.notification_push_deliveries
set next_attempt_at = now()
where id = (select delivery_id from cancellation_push_claim);
update public.notification_outbox_jobs
set next_attempt_at = now()
where id = (select outbox_job_id from cancellation_push_claim);
create temporary table cancellation_push_retry_claim as
select * from public.claim_round_cancelled_push(
  'b9000000-0000-4000-8000-000000000003',
  now() - interval '1 minute'
);
select is((select count(*) from cancellation_push_retry_claim), 1::bigint, 'due cancellation push retry is claimable on the next drain');
select is((select attempt_number from cancellation_push_retry_claim), 2, 'cancellation push retry increments the attempt number');
select public.record_round_cancelled_push_send_success(
  (select delivery_id from cancellation_push_retry_claim),
  'b9000000-0000-4000-8000-000000000003',
  'expo-cancel-ticket-1'
);
select is(
  (select state from public.notification_push_deliveries where id = (select delivery_id from cancellation_push_claim)),
  'sent'::public.notification_delivery_state,
  'cancellation push success terminalizes the child'
);
select is(
  (select count(*) from public.notification_push_receipts
   where delivery_id = (select delivery_id from cancellation_push_claim)),
  0::bigint,
  'results-only receipt worker does not strand a cancellation push receipt'
);

-- Make the e-mail due again for the later claim-shape assertion below.
update public.notification_deliveries
set next_attempt_at = now()
where id = (select delivery_id from cancellation_email_retry_claim);
update public.notification_outbox_jobs
set next_attempt_at = now()
where id = (select outbox_job_id from cancellation_email_retry_claim);

-- A permanent push failure must remain visible when the sibling e-mail later
-- succeeds; the aggregate parent cannot be marked succeeded prematurely.
update public.notification_push_deliveries
set state = 'failed_permanent'::public.notification_delivery_state,
    failure_reason = 'provider_invalid',
    sent_at = null
where id = (select delivery_id from cancellation_push_claim);

create temporary table cancelled_retry as
select * from public.cancel_round(
  '19000000-0000-4000-8000-000000000001',
  '79000000-0000-4000-8000-000000000001',
  'Weather closure', 1,
  '29000000-0000-4000-8000-000000000007',
  '39000000-0000-4000-8000-000000000007'
);
select is((select version from cancelled_retry), 2::bigint, 'same cancellation operation replays committed response');
select is(
  (select count(*) from public.notification_outbox_jobs where aggregate_id = '79000000-0000-4000-8000-000000000001' and event_type = 'round.cancelled'),
  3::bigint,
  'same cancellation operation does not duplicate notifications'
);
select throws_ok(
  $$ select * from public.cancel_round(
    '19000000-0000-4000-8000-000000000001',
    '79000000-0000-4000-8000-000000000001',
    'Second reason', 2,
    '29000000-0000-4000-8000-000000000008',
    '39000000-0000-4000-8000-000000000008'
  ) $$,
  'P0001', 'round_state_locked', 'second cancellation is rejected'
);
select throws_ok(
  $$ select * from public.set_round_participant_rsvp(
    '19000000-0000-4000-8000-000000000002',
    '79000000-0000-4000-8000-000000000001',
    'not_playing', 2, 'member_web',
    '29000000-0000-4000-8000-000000000009',
    '39000000-0000-4000-8000-000000000009'
  ) $$,
  'P0001', 'round_rsvp_closed', 'cancelled round rejects RSVP'
);

insert into public.email_suppressions (
  normalized_address, reason, first_occurred_at, last_occurred_at
)
values (
  'rsvp-admin@example.test', 'complaint', now(), now()
);
insert into public.email_suppressions (
  normalized_address, reason, first_occurred_at, last_occurred_at
)
values (
  'rsvp-recovery@example.test', 'complaint', now(), now()
);
insert into public.email_suppressions (
  normalized_address, reason, first_occurred_at, last_occurred_at
)
values (
  'rsvp-member@example.test', 'complaint', now(), now()
);

-- Leave only the suppressed member's mandatory cancellation delivery due so
-- the claim assertion is deterministic; optional suppression must not block it.
update public.notification_deliveries as delivery
set state = 'cancelled',
    failure_reason = 'test_other_recipient'
from public.notification_outbox_jobs as outbox
where delivery.outbox_job_id = outbox.id
  and delivery.group_id = outbox.group_id
  and outbox.event_type = 'round.cancelled'
  and outbox.aggregate_id = '79000000-0000-4000-8000-000000000001'
  and delivery.recipient_membership_id <> '69000000-0000-4000-8000-000000000002';

create temporary table cancellation_claim as
select * from public.claim_round_cancelled_email(
  'b9000000-0000-4000-8000-000000000001',
  now() - interval '1 minute'
);
select is((select count(*) from cancellation_claim), 1::bigint, 'cancellation claim returns one due delivery');
select is((select group_time_zone from cancellation_claim), 'America/New_York', 'claim preserves round snapshot time zone');
select is((select cancellation_reason from cancellation_claim), 'Weather closure', 'claim preserves cancellation reason');
select is((select recipient_address from cancellation_claim), 'rsvp-member@example.test', 'claim resolves current verified e-mail');
select is(
  (select state from public.notification_deliveries where id = (select delivery_id from cancellation_claim)),
  'sending'::public.notification_delivery_state,
  'mandatory cancellation claim ignores optional e-mail suppression'
);
select is(
  (select state
   from public.notification_outbox_jobs
   where id = (select outbox_job_id from cancellation_claim)),
  'processing'::public.notification_outbox_job_state,
  'cancellation e-mail claim keeps the sibling aggregate processing'
);
select public.record_email_send_success(
  (select delivery_id from cancellation_claim),
  'b9000000-0000-4000-8000-000000000001',
  'resend-cancel-ticket-1'
);
select is(
  (select state
   from public.notification_outbox_jobs
   where id = (select outbox_job_id from cancellation_claim)),
  'abandoned'::public.notification_outbox_job_state,
  'permanent cancellation push failure remains visible after e-mail success'
);

select throws_ok(
  $$ select * from public.cancel_round(
    '19000000-0000-4000-8000-000000000001',
    '79000000-0000-4000-8000-000000000004',
    'Draft closure', 9,
    '29000000-0000-4000-8000-000000000010',
    '39000000-0000-4000-8000-000000000010'
  ) $$,
  '40001', 'round_version_changed', 'stale cancellation version is rejected'
);
select is(
  (select state from public.rounds where id = '79000000-0000-4000-8000-000000000004'),
  'draft'::public.round_state,
  'stale cancellation leaves Draft unchanged'
);
select throws_ok(
  $$ select * from public.cancel_round(
    '19000000-0000-4000-8000-000000000001',
    '79000000-0000-4000-8000-000000000004',
    ' ', 1,
    '29000000-0000-4000-8000-000000000011',
    '39000000-0000-4000-8000-000000000011'
  ) $$,
  '22023', 'round_cancellation_reason_required', 'blank cancellation reason is rejected'
);

select * from finish();
rollback;
