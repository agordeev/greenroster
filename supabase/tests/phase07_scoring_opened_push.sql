begin;

create extension if not exists pgtap with schema extensions;

select plan(35);

select has_function(
  'public', 'claim_scoring_opened_push', array['uuid', 'timestamptz'],
  'scoring-opened claim RPC exists'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.claim_scoring_opened_push(uuid,timestamptz)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.claim_scoring_opened_push(uuid,timestamptz)',
    'execute'
  ),
  'scoring-opened claim remains service-only'
);
select has_function(
  'public', 'record_scoring_opened_push_send_success', array['uuid', 'uuid', 'text'],
  'scoring-opened success RPC exists'
);
select has_function(
  'public', 'record_scoring_opened_push_send_failure', array['uuid', 'uuid', 'text', 'timestamptz'],
  'scoring-opened failure RPC exists'
);
select has_function(
  'public', 'record_scoring_opened_push_invalid_device',
  array['uuid', 'uuid', 'uuid', 'uuid', 'uuid', 'uuid'],
  'scoring-opened invalid-device RPC exists'
);
select has_trigger(
  'public', 'rounds', 'rounds_scoring_opened_outbox',
  'Published-to-Live scoring trigger exists'
);
select is(
  (select count(*) from public.notification_category_policies
   where category = 'scoring_opened' and push_allowed and not email_allowed),
  1::bigint,
  'scoring-opened policy is push-only'
);

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at
)
values (
  '74000000-0000-4000-8000-000000000001',
  'scoring-member@example.test', now(), false, false, now(), now()
);
insert into public.user_profiles (user_id, first_name, last_name)
values ('74000000-0000-4000-8000-000000000001', 'Scoring', 'Member');
insert into public.groups (id, name, time_zone)
values ('74000000-0000-4000-8000-000000000002', 'Scoring Group', 'UTC');
insert into public.memberships (
  id, group_id, user_id, role, status, activated_at
)
values (
  '74000000-0000-4000-8000-000000000003',
  '74000000-0000-4000-8000-000000000002',
  '74000000-0000-4000-8000-000000000001',
  'member', 'active', now()
);
insert into public.push_devices (
  device_id, user_id, expo_push_token, platform, last_seen_at
)
values (
  '74000000-0000-4000-8000-000000000004',
  '74000000-0000-4000-8000-000000000001',
  'ExponentPushToken[scoring-fixture]', 'ios', now()
);

insert into public.rounds (
  id, group_id, description, scheduled_at, group_time_zone, format,
  state, version, published_at, created_by
)
values (
  '74000000-0000-4000-8000-000000000005',
  '74000000-0000-4000-8000-000000000002',
  'Scoring Round One', now() + interval '1 day', 'UTC', 'individual_net',
  'published', 1, now(), '74000000-0000-4000-8000-000000000001'
);
insert into public.round_participants (
  id, round_id, group_id, membership_id, participant_kind, rsvp_status
)
values (
  '74000000-0000-4000-8000-000000000006',
  '74000000-0000-4000-8000-000000000005',
  '74000000-0000-4000-8000-000000000002',
  '74000000-0000-4000-8000-000000000003',
  'member', 'playing'
);
insert into public.round_participants (
  id, round_id, group_id, participant_kind, sponsor_membership_id,
  guest_first_name, guest_last_name
)
values (
  '74000000-0000-4000-8000-000000000007',
  '74000000-0000-4000-8000-000000000005',
  '74000000-0000-4000-8000-000000000002',
  'guest', '74000000-0000-4000-8000-000000000003', 'Guest', 'Player'
);

update public.rounds
set state = 'live', version = 2
where id = '74000000-0000-4000-8000-000000000005';

select is(
  (select count(*) from public.notification_outbox_jobs
   where event_type = 'scoring_opened'
     and aggregate_id = '74000000-0000-4000-8000-000000000005'),
  1::bigint,
  'Published-to-Live queues one scoring-opened parent'
);
select is(
  (select idempotency_key from public.notification_outbox_jobs
   where event_type = 'scoring_opened'
     and aggregate_id = '74000000-0000-4000-8000-000000000005'),
  'round.scoring_opened:74000000-0000-4000-8000-000000000005:2:74000000-0000-4000-8000-000000000003',
  'scoring-opened parent is recipient-scoped and versioned'
);
select is(
  (select count(*) from public.notification_push_deliveries as delivery
   join public.notification_outbox_jobs as outbox on outbox.id = delivery.outbox_job_id
   where outbox.event_type = 'scoring_opened'
     and outbox.aggregate_id = '74000000-0000-4000-8000-000000000005'),
  1::bigint,
  'fan-out creates one device child for the Playing member only'
);
select is(
  (select delivery.state from public.notification_push_deliveries as delivery
   join public.notification_outbox_jobs as outbox on outbox.id = delivery.outbox_job_id
   where outbox.event_type = 'scoring_opened'
     and outbox.aggregate_id = '74000000-0000-4000-8000-000000000005'),
  'queued'::public.notification_delivery_state,
  'scoring-opened device child starts queued'
);
select is(
  (select state from public.notification_outbox_jobs
   where event_type = 'scoring_opened'
     and aggregate_id = '74000000-0000-4000-8000-000000000005'),
  'queued'::public.notification_outbox_job_state,
  'scoring-opened parent starts queued'
);

insert into public.notification_preferences (
  membership_id, group_id, category, email_enabled, push_enabled
)
values (
  '74000000-0000-4000-8000-000000000003',
  '74000000-0000-4000-8000-000000000002',
  'scoring_opened', false, false
);
select is(
  (select delivery.state from public.notification_push_deliveries as delivery
   join public.notification_outbox_jobs as outbox on outbox.id = delivery.outbox_job_id
   where outbox.event_type = 'scoring_opened'
     and outbox.aggregate_id = '74000000-0000-4000-8000-000000000005'),
  'cancelled'::public.notification_delivery_state,
  'disabling scoring-opened preference cancels queued child'
);
select is(
  (select state from public.notification_outbox_jobs
   where event_type = 'scoring_opened'
     and aggregate_id = '74000000-0000-4000-8000-000000000005'),
  'cancelled'::public.notification_outbox_job_state,
  'disabling scoring-opened preference cancels parent'
);

update public.notification_preferences
set push_enabled = true
where membership_id = '74000000-0000-4000-8000-000000000003'
  and group_id = '74000000-0000-4000-8000-000000000002'
  and category = 'scoring_opened';
insert into public.rounds (
  id, group_id, description, scheduled_at, group_time_zone, format,
  state, version, published_at, created_by
)
values (
  '74000000-0000-4000-8000-000000000008',
  '74000000-0000-4000-8000-000000000002',
  'Scoring Round Two', now() + interval '2 days', 'UTC', 'individual_net',
  'published', 1, now(), '74000000-0000-4000-8000-000000000001'
);
insert into public.round_participants (
  id, round_id, group_id, membership_id, participant_kind, rsvp_status
)
values (
  '74000000-0000-4000-8000-000000000009',
  '74000000-0000-4000-8000-000000000008',
  '74000000-0000-4000-8000-000000000002',
  '74000000-0000-4000-8000-000000000003',
  'member', 'playing'
);
update public.rounds
set state = 'live', version = 2
where id = '74000000-0000-4000-8000-000000000008';

create temporary table scoring_claim as
select * from public.claim_scoring_opened_push(
  '74000000-0000-4000-8000-000000000010', now() - interval '1 minute'
);
select is((select count(*) from scoring_claim), 1::bigint, 'service claim returns one Playing member device');
select is((select event_type from scoring_claim), 'scoring_opened', 'claim preserves scoring-opened event type');
select is((select round_id::text from scoring_claim), '74000000-0000-4000-8000-000000000008', 'claim returns the live round');
select is((select expo_push_token from scoring_claim), 'ExponentPushToken[scoring-fixture]', 'service claim receives the raw token');
select is(
  (select provider_message_id from public.notification_push_deliveries
   where id = (select delivery_id from scoring_claim)),
  null::text,
  'raw token is not persisted in push delivery rows'
);

select public.record_scoring_opened_push_send_success(
  (select delivery_id from scoring_claim),
  '74000000-0000-4000-8000-000000000010',
  'expo-scoring-fixture-ticket'
);
select is(
  (select state from public.notification_push_deliveries
   where id = (select delivery_id from scoring_claim)),
  'sent'::public.notification_delivery_state,
  'scoring-opened success terminalizes the child'
);
select is(
  (select state from public.notification_outbox_jobs
   where id = (select outbox_job_id from scoring_claim)),
  'succeeded'::public.notification_outbox_job_state,
  'scoring-opened success terminalizes the parent'
);

update auth.users
set is_anonymous = false
where id = '74000000-0000-4000-8000-000000000001';
insert into public.rounds (
  id, group_id, description, scheduled_at, group_time_zone, format,
  state, version, published_at, created_by
)
values (
  '74000000-0000-4000-8000-000000000011',
  '74000000-0000-4000-8000-000000000002',
  'Scoring Round Three', now() + interval '3 days', 'UTC', 'individual_net',
  'published', 1, now(), '74000000-0000-4000-8000-000000000001'
);
insert into public.round_participants (
  id, round_id, group_id, membership_id, participant_kind, rsvp_status
)
values (
  '74000000-0000-4000-8000-000000000012',
  '74000000-0000-4000-8000-000000000011',
  '74000000-0000-4000-8000-000000000002',
  '74000000-0000-4000-8000-000000000003',
  'member', 'playing'
);
update public.rounds
set state = 'live', version = 2
where id = '74000000-0000-4000-8000-000000000011';
update auth.users
set is_anonymous = true
where id = '74000000-0000-4000-8000-000000000001';
create temporary table anonymous_claim as
select * from public.claim_scoring_opened_push(
  '74000000-0000-4000-8000-000000000013', now() - interval '1 minute'
);
select is((select count(*) from anonymous_claim), 0::bigint, 'claim revalidates Auth identity eligibility');
select is(
  (select delivery.state from public.notification_push_deliveries as delivery
   join public.notification_outbox_jobs as outbox on outbox.id = delivery.outbox_job_id
   where outbox.event_type = 'scoring_opened'
     and outbox.aggregate_id = '74000000-0000-4000-8000-000000000011'),
  'cancelled'::public.notification_delivery_state,
  'ineligible Auth identity cancels queued scoring child'
);
select is(
  (select state from public.notification_outbox_jobs
   where event_type = 'scoring_opened'
     and aggregate_id = '74000000-0000-4000-8000-000000000011'),
  'cancelled'::public.notification_outbox_job_state,
  'ineligible Auth identity cancels scoring parent'
);

update auth.users
set is_anonymous = false
where id = '74000000-0000-4000-8000-000000000001';
insert into public.rounds (
  id, group_id, description, scheduled_at, group_time_zone, format,
  state, version, published_at, created_by
)
values (
  '74000000-0000-4000-8000-000000000014',
  '74000000-0000-4000-8000-000000000002',
  'Scoring Round Four', now() + interval '4 days', 'UTC', 'individual_net',
  'published', 1, now(), '74000000-0000-4000-8000-000000000001'
);
insert into public.round_participants (
  id, round_id, group_id, membership_id, participant_kind, rsvp_status
)
values (
  '74000000-0000-4000-8000-000000000015',
  '74000000-0000-4000-8000-000000000014',
  '74000000-0000-4000-8000-000000000002',
  '74000000-0000-4000-8000-000000000003',
  'member', 'playing'
);
do $$
declare
  utc_hour integer := extract(hour from clock_timestamp())::integer;
  utc_delta integer := utc_hour - 12;
  safe_time_zone text := case
    when utc_delta = 0 then 'Etc/GMT'
    when utc_delta > 0 then format('Etc/GMT+%s', utc_delta)
    else format('Etc/GMT-%s', -utc_delta)
  end;
begin
  update public.rounds
  set group_time_zone = safe_time_zone
  where id = '74000000-0000-4000-8000-000000000014';
end;
$$;
update public.rounds
set state = 'live', version = 2
where id = '74000000-0000-4000-8000-000000000014';
create temporary table scoring_retry_initial as
select * from public.claim_scoring_opened_push(
  '74000000-0000-4000-8000-000000000016', now() - interval '1 minute'
);
select is((select count(*) from scoring_retry_initial), 1::bigint, 'retry fixture claims the first scoring push');
select is((select attempt_number from scoring_retry_initial), 1, 'first scoring claim starts at attempt one');
select public.record_scoring_opened_push_send_failure(
  (select delivery_id from scoring_retry_initial),
  '74000000-0000-4000-8000-000000000016',
  'provider_unavailable',
  now() + interval '1 hour'
);
select is(
  (select state from public.notification_push_deliveries
   where id = (select delivery_id from scoring_retry_initial)),
  'retryable'::public.notification_delivery_state,
  'provider outage releases the scoring child for retry'
);
select is(
  (select state from public.notification_outbox_jobs
   where id = (select outbox_job_id from scoring_retry_initial)),
  'retryable'::public.notification_outbox_job_state,
  'provider outage releases the scoring parent for retry'
);
select ok(
  (select next_attempt_at > now() from public.notification_push_deliveries
   where id = (select delivery_id from scoring_retry_initial)),
  'provider outage schedules a future scoring attempt'
);
update public.notification_push_deliveries
set next_attempt_at = now()
where id = (select delivery_id from scoring_retry_initial);
update public.notification_outbox_jobs
set next_attempt_at = now()
where id = (select outbox_job_id from scoring_retry_initial);
create temporary table scoring_retry_reclaim as
select * from public.claim_scoring_opened_push(
  '74000000-0000-4000-8000-000000000017', now() - interval '1 minute'
);
select is((select count(*) from scoring_retry_reclaim), 1::bigint, 'due scoring retry is claimable on the next drain');
select is((select attempt_number from scoring_retry_reclaim), 2, 'scoring retry increments the attempt number');
select public.record_scoring_opened_push_send_success(
  (select delivery_id from scoring_retry_reclaim),
  '74000000-0000-4000-8000-000000000017',
  'expo-scoring-recovered-ticket'
);
select is(
  (select state from public.notification_push_deliveries
   where id = (select delivery_id from scoring_retry_reclaim)),
  'sent'::public.notification_delivery_state,
  'recovered scoring push terminalizes the child'
);
select is(
  (select state from public.notification_outbox_jobs
   where id = (select outbox_job_id from scoring_retry_reclaim)),
  'succeeded'::public.notification_outbox_job_state,
  'recovered scoring push terminalizes the parent'
);

insert into public.rounds (
  id, group_id, description, scheduled_at, group_time_zone, format,
  state, version, published_at, created_by
)
values (
  '74000000-0000-4000-8000-000000000019',
  '74000000-0000-4000-8000-000000000002',
  'Scoring Round Five', now() + interval '5 days', 'UTC', 'individual_net',
  'published', 1, now(), '74000000-0000-4000-8000-000000000001'
);
insert into public.round_participants (
  id, round_id, group_id, membership_id, participant_kind, rsvp_status
)
values (
  '74000000-0000-4000-8000-000000000020',
  '74000000-0000-4000-8000-000000000019',
  '74000000-0000-4000-8000-000000000002',
  '74000000-0000-4000-8000-000000000003',
  'member', 'playing'
);
update public.rounds
set state = 'live', version = 2
where id = '74000000-0000-4000-8000-000000000019';
create temporary table invalid_device_claim as
select * from public.claim_scoring_opened_push(
  '74000000-0000-4000-8000-000000000021', now() - interval '1 minute'
);
select public.record_scoring_opened_push_invalid_device(
  (select delivery_id from invalid_device_claim),
  '74000000-0000-4000-8000-000000000021',
  '74000000-0000-4000-8000-000000000004',
  '74000000-0000-4000-8000-000000000002',
  '74000000-0000-4000-8000-000000000022',
  '74000000-0000-4000-8000-000000000023'
);
select is(
  (select active from public.push_devices
   where device_id = '74000000-0000-4000-8000-000000000004'),
  false,
  'provider-invalid scoring push retires the device in its tenant'
);
select is(
  (select state from public.notification_push_deliveries
   where id = (select delivery_id from invalid_device_claim)),
  'failed_permanent'::public.notification_delivery_state,
  'provider-invalid scoring push terminalizes the child'
);

rollback;
