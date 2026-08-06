begin;

create extension if not exists pgtap with schema extensions;

select plan(54);

select has_table(
  'public',
  'notification_push_deliveries',
  'push delivery projection exists'
);
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class
   where oid = 'public.notification_push_deliveries'::regclass),
  'push deliveries are force-RLS'
);
select ok(
  has_table_privilege('service_role', 'public.notification_push_deliveries', 'select')
  and not has_table_privilege('authenticated', 'public.notification_push_deliveries', 'select'),
  'push delivery rows remain service-only through table grants'
);
select has_function(
  'public',
  'record_results_push_invalid_device',
  array['uuid', 'uuid', 'uuid', 'uuid', 'uuid', 'uuid'],
  'atomic provider-invalid push boundary exists'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.record_results_push_invalid_device(uuid,uuid,uuid,uuid,uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.record_results_push_invalid_device(uuid,uuid,uuid,uuid,uuid,uuid)',
    'execute'
  ),
  'atomic provider-invalid push boundary is service-only'
);

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at
)
values
  ('f1000000-0000-4000-8000-000000000001', 'fanout-admin@example.test', now(), false, false, now(), now()),
  ('f1000000-0000-4000-8000-000000000002', 'fanout-member@example.test', now(), false, false, now(), now()),
  ('f1000000-0000-4000-8000-000000000003', 'fanout-disabled@example.test', now(), false, false, now(), now()),
  ('f1000000-0000-4000-8000-000000000004', 'fanout-inactive@example.test', now(), false, false, now(), now());

insert into public.user_profiles (user_id, display_name, first_name, last_name)
values
  ('f1000000-0000-4000-8000-000000000001', 'Fanout Admin', 'Fanout', 'Admin'),
  ('f1000000-0000-4000-8000-000000000002', 'Fanout Member', 'Fanout', 'Member'),
  ('f1000000-0000-4000-8000-000000000003', 'Fanout Disabled', 'Fanout', 'Disabled'),
  ('f1000000-0000-4000-8000-000000000004', 'Fanout Inactive', 'Fanout', 'Inactive');

insert into public.groups (id, name, time_zone)
values
  ('f2000000-0000-4000-8000-000000000001', 'Fanout Group', 'UTC'),
  ('f2000000-0000-4000-8000-000000000002', 'Other Fanout Group', 'UTC');

insert into public.memberships (
  id, group_id, user_id, role, status, activated_at, inactivated_at
)
values
  ('f3000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'administrator', 'active', now(), null),
  ('f3000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000002', 'member', 'active', now(), null),
  ('f3000000-0000-4000-8000-000000000003', 'f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000003', 'member', 'active', now(), null),
  ('f3000000-0000-4000-8000-000000000004', 'f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000004', 'member', 'inactive', now(), now());

insert into public.notification_preferences (
  membership_id, group_id, category, email_enabled, push_enabled
)
values (
  'f3000000-0000-4000-8000-000000000003',
  'f2000000-0000-4000-8000-000000000001',
  'results_published', false, false
);

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at
)
values (
  'f1000000-0000-4000-8000-000000000005', 'fanout-email-only@example.test', now(), false, false, now(), now()
);

insert into public.user_profiles (user_id, display_name, first_name, last_name)
values (
  'f1000000-0000-4000-8000-000000000005', 'Fanout E-mail Only', 'Fanout', 'E-mail Only'
);

insert into public.memberships (
  id, group_id, user_id, role, status, activated_at, inactivated_at
)
values (
  'f3000000-0000-4000-8000-000000000005', 'f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000005', 'member', 'active', now(), null
);

insert into public.notification_preferences (
  membership_id, group_id, category, email_enabled, push_enabled
)
values (
  'f3000000-0000-4000-8000-000000000005',
  'f2000000-0000-4000-8000-000000000001',
  'results_published', true, false
);

insert into public.push_devices (
  device_id, user_id, expo_push_token, platform, last_seen_at
)
values (
  'f3100000-0000-4000-8000-000000000005', 'f1000000-0000-4000-8000-000000000005', 'ExponentPushToken[fanout-email-only]', 'ios', now()
);

insert into public.push_devices (
  device_id, user_id, expo_push_token, platform, last_seen_at
)
values
  ('f3100000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000002', 'ExponentPushToken[fanout-member-one]', 'ios', now()),
  ('f3100000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000002', 'ExponentPushToken[fanout-member-two]', 'android', now()),
  ('f3100000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000003', 'ExponentPushToken[fanout-disabled]', 'ios', now()),
  ('f3100000-0000-4000-8000-000000000004', 'f1000000-0000-4000-8000-000000000004', 'ExponentPushToken[fanout-inactive]', 'ios', now());

insert into public.rounds (
  id, group_id, description, scheduled_at, group_time_zone, format, state,
  published_at, created_by, version
)
values
  ('f4000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'Fanout round', now(), 'UTC', 'individual_net', 'completed', now(), 'f1000000-0000-4000-8000-000000000001', 3),
  ('f4000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000002', 'Other tenant round', now(), 'UTC', 'individual_net', 'completed', now(), 'f1000000-0000-4000-8000-000000000001', 2);

insert into public.round_completion_runs (
  id, round_id, group_id, completion_number, state, completed_at,
  completed_by, round_version, correlation_id, operation_id
)
values
  ('f4100000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 1, 'official', now(), 'f1000000-0000-4000-8000-000000000001', 3, 'f4200000-0000-4000-8000-000000000001', 'f4300000-0000-4000-8000-000000000001');

insert into public.round_participants (
  id, round_id, group_id, membership_id, participant_kind, sponsor_membership_id,
  guest_first_name, guest_last_name, rsvp_status
)
values
  ('f5000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000002', 'member', null, null, null, 'playing'),
  ('f5000000-0000-4000-8000-000000000002', 'f4000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000003', 'member', null, null, null, 'playing'),
  ('f5000000-0000-4000-8000-000000000003', 'f4000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', null, 'guest', 'f3000000-0000-4000-8000-000000000001', 'Round', 'Guest', 'playing'),
  ('f5000000-0000-4000-8000-000000000004', 'f4000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000004', 'member', null, null, null, 'playing');

insert into public.notification_outbox_jobs (
  id, group_id, event_type, aggregate_type, aggregate_id, aggregate_version,
  idempotency_key
)
values (
  'f6000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000001',
  'results_published', 'round_completion', 'f4100000-0000-4000-8000-000000000001', 3,
  'results_published:f4100000-0000-4000-8000-000000000001'
);

select is((select count(*) from public.notification_deliveries where outbox_job_id = 'f6000000-0000-4000-8000-000000000001'), 1::bigint, 'default-enabled member receives one result e-mail');
select is((select state from public.notification_deliveries where outbox_job_id = 'f6000000-0000-4000-8000-000000000001'), 'queued'::public.notification_delivery_state, 'result e-mail starts queued');
select is((select count(*) from public.notification_push_deliveries where outbox_job_id = 'f6000000-0000-4000-8000-000000000001'), 2::bigint, 'each active member device receives one result push row');
select is((select count(*) from public.notification_push_deliveries where recipient_membership_id = 'f3000000-0000-4000-8000-000000000002'), 2::bigint, 'push rows retain membership scope without copying tokens');
select is((select count(*) from public.notification_deliveries where recipient_membership_id = 'f3000000-0000-4000-8000-000000000003'), 0::bigint, 'disabled e-mail preference suppresses queueing');
select is((select count(*) from public.notification_push_deliveries where recipient_membership_id = 'f3000000-0000-4000-8000-000000000003'), 0::bigint, 'disabled push preference suppresses queueing');
select is((select count(*) from public.notification_deliveries where recipient_membership_id = 'f3000000-0000-4000-8000-000000000004'), 0::bigint, 'inactive participants are excluded from e-mail');
select is((select count(*) from public.notification_push_deliveries where recipient_membership_id = 'f3000000-0000-4000-8000-000000000004'), 0::bigint, 'inactive participants are excluded from push');
select is((select count(*) from public.notification_deliveries where recipient_membership_id is null), 0::bigint, 'guests are excluded from e-mail');
select is((select count(*) from public.notification_push_deliveries where recipient_membership_id is null), 0::bigint, 'guests are excluded from push');
select is((select state from public.notification_outbox_jobs where id = 'f6000000-0000-4000-8000-000000000001'), 'queued'::public.notification_outbox_job_state, 'parent remains queued while child work is sendable');
select ok(
  not exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = 'public.notification_push_deliveries'::regclass
      and attribute.attname = 'expo_push_token'
      and not attribute.attisdropped
  ),
  'push delivery rows never persist raw Expo tokens'
);

-- A retryable push that wakes during quiet hours is deferred without erasing
-- the previous provider outcome.  Choose a valid fixed-offset zone whose
-- current local clock is inside the 21:00–07:00 window so this stays
-- deterministic across test runners.
create temporary table quiet_zone as
select candidate
from unnest(array[
  'UTC', 'Etc/GMT+12', 'Etc/GMT-12', 'Etc/GMT+10', 'Etc/GMT-10',
  'Etc/GMT+8', 'Etc/GMT-8', 'Etc/GMT+6', 'Etc/GMT-6', 'Etc/GMT+4',
  'Etc/GMT-4', 'Etc/GMT+2', 'Etc/GMT-2'
]::text[]) as candidates(candidate)
where (now() at time zone candidate)::time >= time '21:00'
   or (now() at time zone candidate)::time < time '07:00'
order by candidate
limit 1;
select is((select count(*) from quiet_zone), 1::bigint, 'quiet-hours fixture finds a valid local window');
update public.rounds
set group_time_zone = (select candidate from quiet_zone)
where id = 'f4000000-0000-4000-8000-000000000001';
update public.notification_push_deliveries
set state = 'retryable'::public.notification_delivery_state,
    failure_reason = 'provider_unavailable',
    next_attempt_at = now()
where outbox_job_id = 'f6000000-0000-4000-8000-000000000001';
update public.notification_outbox_jobs
set next_attempt_at = now()
where id = 'f6000000-0000-4000-8000-000000000001';
select is((select count(*) from public.claim_results_published_push('f6500000-0000-4000-8000-000000000001', now() - interval '1 hour')), 0::bigint, 'quiet-hours push is deferred instead of claimed');
select ok((select bool_and(failure_reason = 'provider_unavailable') from public.notification_push_deliveries where outbox_job_id = 'f6000000-0000-4000-8000-000000000001'), 'quiet-hours deferral preserves the prior provider failure');
select ok((select bool_and(next_attempt_at > now()) from public.notification_push_deliveries where outbox_job_id = 'f6000000-0000-4000-8000-000000000001'), 'quiet-hours deferral schedules a future retry');

-- Make claim assertions independent of the wall clock while preserving the
-- production quiet-hours predicate.  The fixture timezone is shifted into
-- the local daytime window, and due timestamps are explicitly made claimable.
update public.rounds
set group_time_zone = case
  when extract(hour from (now() at time zone 'UTC')) < 7 then 'Etc/GMT+12'
  when extract(hour from (now() at time zone 'UTC')) >= 21 then 'Etc/GMT-12'
  else 'UTC'
end
where id = 'f4000000-0000-4000-8000-000000000001';
update public.notification_push_deliveries
set next_attempt_at = now()
where outbox_job_id = 'f6000000-0000-4000-8000-000000000001';
update public.notification_outbox_jobs
set next_attempt_at = now()
where id = 'f6000000-0000-4000-8000-000000000001';

create temporary table claimed_email_initial as
select *
from public.claim_results_published_email(
  'f7000000-0000-4000-8000-000000000001',
  now() - interval '1 hour'
);
select is((select count(*) from claimed_email_initial), 1::bigint, 'result e-mail claim leases one child');
select is((select recipient_address from claimed_email_initial), 'fanout-member@example.test', 'e-mail claim resolves the current verified address');
select is((select state from public.notification_deliveries where outbox_job_id = 'f6000000-0000-4000-8000-000000000001'), 'sending'::public.notification_delivery_state, 'claimed e-mail is sending');
select is((select state from public.notification_outbox_jobs where id = 'f6000000-0000-4000-8000-000000000001'), 'processing'::public.notification_outbox_job_state, 'parent remains processing while children are in flight');
select lives_ok(
  $$ select public.record_results_email_send_failure(
       (select delivery_id from claimed_email_initial),
       'f7000000-0000-4000-8000-000000000001',
       'provider_unavailable',
       now() + interval '1 hour'
     ) $$,
  'retryable result e-mail failure releases the first claim'
);
select is((select state from public.notification_deliveries where outbox_job_id = 'f6000000-0000-4000-8000-000000000001' and channel = 'email'), 'retryable'::public.notification_delivery_state, 'retryable result e-mail remains retryable for a later drain');
select is((select failure_reason from public.notification_deliveries where outbox_job_id = 'f6000000-0000-4000-8000-000000000001' and channel = 'email'), 'provider_unavailable', 'retryable result e-mail preserves a safe provider error');
select ok((select next_attempt_at > now() from public.notification_deliveries where outbox_job_id = 'f6000000-0000-4000-8000-000000000001' and channel = 'email'), 'retryable result e-mail schedules a future attempt');
select is((select count(*) from public.claim_results_published_email('f7040000-0000-4000-8000-000000000001', now() - interval '1 hour')), 0::bigint, 'future retryable result e-mail is not claimable before its scheduled attempt');
update public.notification_deliveries
set state = 'sending'::public.notification_delivery_state,
    claim_token = 'f7045000-0000-4000-8000-000000000001',
    claimed_at = now() - interval '2 hours',
    next_attempt_at = now()
where outbox_job_id = 'f6000000-0000-4000-8000-000000000001'
  and channel = 'email';
update public.notification_outbox_jobs
set state = 'processing'::public.notification_outbox_job_state,
    claimed_at = now() - interval '2 hours',
    next_attempt_at = now()
where id = 'f6000000-0000-4000-8000-000000000001';
create temporary table claimed_email as
select *
from public.claim_results_published_email(
  'f7050000-0000-4000-8000-000000000001',
  now() - interval '1 hour'
);
select is((select count(*) from claimed_email), 1::bigint, 'stale result e-mail claim is recovered on the next drain');
select is((select attempt_number from claimed_email), 2, 'stale result e-mail reclaim increments the attempt number');
select ok((select state = 'sending'::public.notification_delivery_state and claim_token = 'f7050000-0000-4000-8000-000000000001'::uuid from public.notification_deliveries where id = (select delivery_id from claimed_email)), 'stale result e-mail reclaim owns the refreshed lease');
select lives_ok(
  $$ select public.record_results_email_send_success(
       (select delivery_id from claimed_email),
       'f7050000-0000-4000-8000-000000000001',
       'res-email-1'
     ) $$,
  'result e-mail success finalizes only its child'
);
select is((select state from public.notification_deliveries where outbox_job_id = 'f6000000-0000-4000-8000-000000000001' and channel = 'email'), 'sent'::public.notification_delivery_state, 'result e-mail is terminally sent');
select is((select state from public.notification_outbox_jobs where id = 'f6000000-0000-4000-8000-000000000001'), 'retryable'::public.notification_outbox_job_state, 'parent remains retryable while push children remain pending');

create temporary table claimed_push_one as
select *
from public.claim_results_published_push(
  'f7100000-0000-4000-8000-000000000001',
  now() - interval '1 hour'
);
select is((select count(*) from claimed_push_one), 1::bigint, 'result push claim leases one device child');
select is((select expo_push_token from claimed_push_one), 'ExponentPushToken[fanout-member-one]', 'push claim resolves the current token only to the trusted worker');
select is((select state from public.notification_push_deliveries where id = (select delivery_id from claimed_push_one)), 'sending'::public.notification_delivery_state, 'claimed push is sending');
select lives_ok(
  $$ select public.record_results_push_invalid_device(
       (select delivery_id from claimed_push_one),
       'f7100000-0000-4000-8000-000000000001',
       'f3100000-0000-4000-8000-000000000001',
       'f2000000-0000-4000-8000-000000000001',
       'f7400000-0000-4000-8000-000000000001',
       'f7500000-0000-4000-8000-000000000001'
     ) $$,
  'provider-invalid push finalizes and retires atomically'
);
select is((select state from public.notification_push_deliveries where id = (select delivery_id from claimed_push_one)), 'failed_permanent'::public.notification_delivery_state, 'provider-invalid child is terminally failed');
select is((select active from public.push_devices where device_id = 'f3100000-0000-4000-8000-000000000001'), false, 'provider-invalid feedback retires the device in the same transaction');
select is((select state from public.notification_outbox_jobs where id = 'f6000000-0000-4000-8000-000000000001'), 'retryable'::public.notification_outbox_job_state, 'parent remains retryable while another push device is pending');

create temporary table claimed_push_two as
select *
from public.claim_results_published_push(
  'f7200000-0000-4000-8000-000000000001',
  now() - interval '1 hour'
);
select is((select count(*) from claimed_push_two), 1::bigint, 'second active device is independently claimable');
select lives_ok(
  $$ select public.record_results_push_send_success(
       (select delivery_id from claimed_push_two),
       'f7200000-0000-4000-8000-000000000001',
       'expo-ticket-2'
     ) $$,
  'second result push success finalizes the final child'
);
select is((select state from public.notification_outbox_jobs where id = 'f6000000-0000-4000-8000-000000000001'), 'abandoned'::public.notification_outbox_job_state, 'parent abandons when a child has a permanent provider failure');
select is((select count(*) from public.claim_results_published_email('f7300000-0000-4000-8000-000000000001', now() - interval '1 hour')), 0::bigint, 'terminal result parent has no further e-mail claim');

insert into public.notification_outbox_jobs (
  id, group_id, event_type, aggregate_type, aggregate_id, aggregate_version,
  idempotency_key
)
values (
  'f6000000-0000-4000-8000-000000000002',
  'f2000000-0000-4000-8000-000000000002',
  'results_published', 'round_completion', 'f4100000-0000-4000-8000-000000000001', 2,
  'results_published:other-tenant'
);
select is((select state from public.notification_outbox_jobs where id = 'f6000000-0000-4000-8000-000000000002'), 'succeeded'::public.notification_outbox_job_state, 'a tenant with no eligible participants closes its parent job');
select is((select safe_error from public.notification_outbox_jobs where id = 'f6000000-0000-4000-8000-000000000002'), 'no_sendable_recipients', 'no-recipient completion is retained with a safe reason');

insert into public.notification_outbox_jobs (
  group_id, event_type, aggregate_type, aggregate_id, aggregate_version,
  idempotency_key
)
values (
  'f2000000-0000-4000-8000-000000000001',
  'results_published', 'round_completion', 'f4100000-0000-4000-8000-000000000001', 3,
  'results_published:f4100000-0000-4000-8000-000000000001'
)
on conflict (idempotency_key) do nothing;
select is((select count(*) from public.notification_deliveries where outbox_job_id = 'f6000000-0000-4000-8000-000000000001'), 1::bigint, 'replayed outbox insertion does not duplicate e-mail');
select is((select count(*) from public.notification_push_deliveries where outbox_job_id = 'f6000000-0000-4000-8000-000000000001'), 2::bigint, 'replayed outbox insertion does not duplicate push devices');

-- A member who opts into results e-mail while opting out of push still gets
-- exactly the e-mail child; the active device must not create a push child.
insert into public.round_participants (
  id, round_id, group_id, membership_id, participant_kind, sponsor_membership_id,
  guest_first_name, guest_last_name, rsvp_status
)
values (
  'f5000000-0000-4000-8000-000000000005', 'f4000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000005', 'member', null, null, null, 'playing'
);

insert into public.notification_outbox_jobs (
  id, group_id, event_type, aggregate_type, aggregate_id, aggregate_version,
  idempotency_key
)
values (
  'f6000000-0000-4000-8000-000000000003',
  'f2000000-0000-4000-8000-000000000001',
  'results_published', 'round_completion', 'f4100000-0000-4000-8000-000000000001', 3,
  'results_published:f4100000-0000-4000-8000-000000000001:email-only'
);

select is((select count(*) from public.notification_deliveries where outbox_job_id = 'f6000000-0000-4000-8000-000000000003' and recipient_membership_id = 'f3000000-0000-4000-8000-000000000005'), 1::bigint, 'e-mail-enabled member receives a results e-mail');
select is((select count(*) from public.notification_push_deliveries where outbox_job_id = 'f6000000-0000-4000-8000-000000000003' and recipient_membership_id = 'f3000000-0000-4000-8000-000000000005'), 0::bigint, 'push-disabled member receives no results push child');

select throws_ok(
  $$ insert into public.notification_push_deliveries (
       group_id, outbox_job_id, recipient_membership_id, recipient_user_id,
       device_id
     ) values (
       'f2000000-0000-4000-8000-000000000001',
       'f6000000-0000-4000-8000-000000000001',
       'f3000000-0000-4000-8000-000000000002',
       'f1000000-0000-4000-8000-000000000003',
       'f3100000-0000-4000-8000-000000000001'
     ) $$,
  '23514',
  'push_delivery_recipient_mismatch',
  'push delivery cannot cross an identity boundary'
);

select * from finish();

rollback;
