begin;

create extension if not exists pgtap with schema extensions;

select plan(51);

select has_type(
  'public',
  'notification_push_receipt_state',
  'Expo push receipt lifecycle has an explicit enum'
);
select has_table(
  'public',
  'notification_push_receipts',
  'Expo push receipt queue exists'
);
select has_trigger(
  'public',
  'notification_push_deliveries',
  'notification_push_deliveries_enqueue_receipt',
  'sent push deliveries enqueue provider receipt polling'
);
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class
   where oid = 'public.notification_push_receipts'::regclass),
  'receipt queue is force-RLS'
);
select ok(
  has_table_privilege('service_role', 'public.notification_push_receipts', 'select')
  and not has_table_privilege('anon', 'public.notification_push_receipts', 'select,insert,update,delete')
  and not has_table_privilege('authenticated', 'public.notification_push_receipts', 'select,insert,update,delete'),
  'receipt rows are directly readable only by service_role'
);
select ok(
  not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'notification_push_receipts'
      and column_name in ('expo_push_token', 'push_token', 'token', 'raw_token')
  ),
  'receipt rows never persist raw Expo tokens'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.claim_results_push_receipt(uuid,timestamp with time zone)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.claim_results_push_receipt(uuid,timestamp with time zone)',
    'execute'
  ),
  'receipt claims are service-only'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.record_results_push_receipt_success(uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.record_results_push_receipt_success(uuid,uuid)',
    'execute'
  ),
  'receipt success finalization is service-only'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.record_results_push_receipt_failure(uuid,uuid,text,timestamp with time zone)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.record_results_push_receipt_failure(uuid,uuid,text,timestamp with time zone)',
    'execute'
  ),
  'receipt failure finalization is service-only'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.record_results_push_receipt_invalid_device(uuid,uuid,uuid,uuid,uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.record_results_push_receipt_invalid_device(uuid,uuid,uuid,uuid,uuid,uuid)',
    'execute'
  ),
  'receipt invalid-device finalization is service-only'
);
select ok(
  (select prosecdef and proconfig = array['search_path=""']
   from pg_catalog.pg_proc
   where oid = 'public.claim_results_push_receipt(uuid,timestamp with time zone)'::regprocedure),
  'receipt claim pins a security-definer search path'
);

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at
)
values (
  'a1000000-0000-4000-8000-000000000001',
  'receipt-member@example.test',
  now(), false, false, now(), now()
);

insert into public.user_profiles (user_id, display_name, first_name, last_name)
values (
  'a1000000-0000-4000-8000-000000000001',
  'Receipt Member', 'Receipt', 'Member'
);

insert into public.groups (id, name, time_zone)
values (
  'a2000000-0000-4000-8000-000000000001',
  'Receipt Group', 'UTC'
);

insert into public.memberships (
  id, group_id, user_id, role, status, activated_at
)
values (
  'a3000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'member', 'active', now()
);

insert into public.notification_preferences (
  membership_id, group_id, category, email_enabled, push_enabled
)
values (
  'a3000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001',
  'results_published', true, true
);

insert into public.push_devices (
  device_id, user_id, expo_push_token, platform, last_seen_at
)
values
  ('a6100000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'ExponentPushToken[receipt-one]', 'ios', now()),
  ('a6100000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'ExponentPushToken[receipt-two]', 'android', now()),
  ('a6100000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'ExponentPushToken[receipt-three]', 'ios', now());

insert into public.rounds (
  id, group_id, description, scheduled_at, group_time_zone, format, state,
  published_at, created_by, version
)
values (
  'a4000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001',
  'Receipt round', now(), 'UTC', 'individual_net', 'completed', now(),
  'a1000000-0000-4000-8000-000000000001', 1
);

insert into public.round_completion_runs (
  id, round_id, group_id, completion_number, state, completed_at,
  completed_by, round_version, correlation_id, operation_id
)
values (
  'a4100000-0000-4000-8000-000000000001',
  'a4000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001',
  1, 'official', now(), 'a1000000-0000-4000-8000-000000000001', 1,
  'a4200000-0000-4000-8000-000000000001',
  'a4300000-0000-4000-8000-000000000001'
);

insert into public.round_participants (
  id, round_id, group_id, membership_id, participant_kind, rsvp_status
)
values (
  'a5000000-0000-4000-8000-000000000001',
  'a4000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000001',
  'member', 'playing'
);

insert into public.notification_outbox_jobs (
  id, group_id, event_type, aggregate_type, aggregate_id, aggregate_version,
  idempotency_key
)
values (
  'a6000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001',
  'results_published', 'round_completion',
  'a4100000-0000-4000-8000-000000000001', 1,
  'results_published:a4100000-0000-4000-8000-000000000001'
);

select is(
  (select count(*) from public.notification_push_deliveries
   where outbox_job_id = 'a6000000-0000-4000-8000-000000000001'),
  3::bigint,
  'the result event has one push child per active device'
);

-- Transition each push child through the real sent boundary.  The trigger
-- creates one receipt per delivery and never exposes the raw device token.
update public.notification_push_deliveries as delivery
set state = 'sending',
    claim_token = 'a7000000-0000-4000-8000-000000000001'::uuid,
    claimed_at = now()
where delivery.outbox_job_id = 'a6000000-0000-4000-8000-000000000001'
  and delivery.device_id = 'a6100000-0000-4000-8000-000000000001';

update public.notification_push_deliveries
set provider_message_id = 'expo-receipt-ticket-one',
    state = 'sent',
    sent_at = now(),
    claim_token = null,
    claimed_at = null
where outbox_job_id = 'a6000000-0000-4000-8000-000000000001'
  and device_id = 'a6100000-0000-4000-8000-000000000001';

update public.notification_push_deliveries as delivery
set state = 'sending',
    claim_token = case
      when delivery.device_id = 'a6100000-0000-4000-8000-000000000002'
        then 'a7000000-0000-4000-8000-000000000002'::uuid
      else 'a7000000-0000-4000-8000-000000000003'::uuid
    end,
    claimed_at = now()
where delivery.outbox_job_id = 'a6000000-0000-4000-8000-000000000001'
  and delivery.device_id in (
    'a6100000-0000-4000-8000-000000000002',
    'a6100000-0000-4000-8000-000000000003'
  );

update public.notification_push_deliveries
set provider_message_id = case
      when device_id = 'a6100000-0000-4000-8000-000000000002' then 'expo-receipt-ticket-two'
      else 'expo-receipt-ticket-three'
    end,
    state = 'sent',
    sent_at = now(),
    claim_token = null,
    claimed_at = null
where outbox_job_id = 'a6000000-0000-4000-8000-000000000001'
  and device_id in (
    'a6100000-0000-4000-8000-000000000002',
    'a6100000-0000-4000-8000-000000000003'
  );

select is(
  (select count(*) from public.notification_push_receipts),
  3::bigint,
  'sent transitions enqueue one receipt per push delivery'
);
select ok(
  (select min(next_attempt_at) > now() from public.notification_push_receipts),
  'new receipts wait for the provider recommendation before the first poll'
);
select is(
  (select count(*) from public.notification_push_receipts
   where provider_message_id = 'expo-receipt-ticket-one'),
  1::bigint,
  'receipt retains the provider ticket identifier'
);

update public.notification_push_receipts
set next_attempt_at = case provider_message_id
  when 'expo-receipt-ticket-one' then now() - interval '3 seconds'
  when 'expo-receipt-ticket-two' then now() - interval '2 seconds'
  else now() - interval '1 second'
end;

-- Replay the sent update.  The delivery uniqueness key keeps receipt enqueue
-- idempotent even if a provider finalization is retried.
update public.notification_push_deliveries
set provider_message_id = provider_message_id
where outbox_job_id = 'a6000000-0000-4000-8000-000000000001'
  and device_id = 'a6100000-0000-4000-8000-000000000001';
select is(
  (select count(*) from public.notification_push_receipts
   where delivery_id = (
     select id from public.notification_push_deliveries
     where outbox_job_id = 'a6000000-0000-4000-8000-000000000001'
       and device_id = 'a6100000-0000-4000-8000-000000000001'
   )),
  1::bigint,
  'receipt enqueue replay does not duplicate a delivery receipt'
);

set local role service_role;
create temporary table claimed_receipt as
select *
from public.claim_results_push_receipt(
  'a7100000-0000-4000-8000-000000000001',
  now() - interval '1 hour'
);
reset role;

select is((select count(*) from claimed_receipt), 1::bigint, 'receipt claim leases one due provider ticket');
select is((select delivery_id from claimed_receipt), (select id from public.notification_push_deliveries where outbox_job_id = 'a6000000-0000-4000-8000-000000000001' and device_id = 'a6100000-0000-4000-8000-000000000001'), 'receipt claim returns its push delivery');
select is((select device_id from claimed_receipt), 'a6100000-0000-4000-8000-000000000001'::app.entity_id, 'receipt claim returns its install identifier');
select is((select provider_message_id from claimed_receipt), 'expo-receipt-ticket-one', 'receipt claim returns the provider message identifier');
select is((select attempt_number from claimed_receipt), 1, 'first receipt claim starts at attempt one');
select is((select state from public.notification_push_receipts where id = (select receipt_id from claimed_receipt)), 'sending'::public.notification_push_receipt_state, 'claimed receipt is sending');

set local role service_role;
select lives_ok(
  $$ select public.record_results_push_receipt_success(
       (select receipt_id from claimed_receipt),
       'a7100000-0000-4000-8000-000000000001'
     ) $$,
  'receipt success finalizes the provider ticket'
);
reset role;
select is((select state from public.notification_push_receipts where id = (select receipt_id from claimed_receipt)), 'succeeded'::public.notification_push_receipt_state, 'successful Expo receipt is terminal');
select ok((select resolved_at is not null from public.notification_push_receipts where id = (select receipt_id from claimed_receipt)), 'successful Expo receipt records resolution time');
select is((select state from public.notification_push_deliveries where outbox_job_id = 'a6000000-0000-4000-8000-000000000001' and device_id = 'a6100000-0000-4000-8000-000000000001'), 'sent'::public.notification_delivery_state, 'receipt success preserves the sent delivery');

update public.notification_push_receipts
set next_attempt_at = now() + interval '1 hour'
where provider_message_id = 'expo-receipt-ticket-three';

-- Receipt two exercises stale lease recovery and retryable failure.  The stale
-- lease is reclaimed and immediately returned as attempt two.
update public.notification_push_receipts
set next_attempt_at = now() + interval '1 hour'
where provider_message_id = 'expo-receipt-ticket-three';
set local role service_role;
create temporary table claimed_receipt_two as
select *
from public.claim_results_push_receipt(
  'a7100000-0000-4000-8000-000000000002',
  now() - interval '1 hour'
);
reset role;
update public.notification_push_receipts
set claimed_at = now() - interval '2 hours'
where id = (select receipt_id from claimed_receipt_two);
set local role service_role;
create temporary table reclaimed_receipt_two as
select *
from public.claim_results_push_receipt(
  'a7100000-0000-4000-8000-000000000003',
  now() - interval '1 hour'
);
reset role;
select is((select attempt_number from reclaimed_receipt_two), 2, 'stale receipt leases recover at the next attempt');
select is((select failure_reason from public.notification_push_receipts where id = (select receipt_id from reclaimed_receipt_two)), null, 'reclaimed receipt clears the stale lease reason before retry');
set local role service_role;
select lives_ok(
  $$ select public.record_results_push_receipt_failure(
       (select receipt_id from reclaimed_receipt_two),
       'a7100000-0000-4000-8000-000000000003',
       'provider_rate_limited',
       now() + interval '1 hour'
     ) $$,
  'retryable provider feedback releases the receipt for later polling'
);
reset role;
select is((select state from public.notification_push_receipts where id = (select receipt_id from reclaimed_receipt_two)), 'retryable'::public.notification_push_receipt_state, 'retryable receipt remains queued for a future poll');
select is((select failure_reason from public.notification_push_receipts where id = (select receipt_id from reclaimed_receipt_two)), 'provider_rate_limited', 'retryable receipt keeps a safe provider reason');

-- Receipt three exercises atomic invalid-device finalization.  A provider error
-- retires the install and terminalizes its receipt in one transaction.
update public.notification_push_receipts
set next_attempt_at = now()
where delivery_id = (
  select id from public.notification_push_deliveries
  where outbox_job_id = 'a6000000-0000-4000-8000-000000000001'
    and device_id = 'a6100000-0000-4000-8000-000000000003'
);
set local role service_role;
create temporary table claimed_receipt_three as
select *
from public.claim_results_push_receipt(
  'a7100000-0000-4000-8000-000000000004',
  now() - interval '1 hour'
);
select lives_ok(
  $$ select public.record_results_push_receipt_invalid_device(
       (select receipt_id from claimed_receipt_three),
       'a7100000-0000-4000-8000-000000000004',
       'a6100000-0000-4000-8000-000000000003',
       'a2000000-0000-4000-8000-000000000001',
       'a7400000-0000-4000-8000-000000000001',
       'a7500000-0000-4000-8000-000000000001'
     ) $$,
  'invalid Expo receipt retires its device atomically'
);
reset role;
select is((select state from public.notification_push_receipts where id = (select receipt_id from claimed_receipt_three)), 'failed_permanent'::public.notification_push_receipt_state, 'invalid Expo receipt is terminally failed');
select is((select failure_reason from public.notification_push_receipts where id = (select receipt_id from claimed_receipt_three)), 'provider_invalid', 'invalid Expo receipt retains a safe provider reason');
select is((select active from public.push_devices where device_id = 'a6100000-0000-4000-8000-000000000003'), false, 'invalid Expo receipt retires the device');
select is((select count(*) from public.audit_events where action = 'member.push_device_retired' and source = 'provider' and target_id = 'a6100000-0000-4000-8000-000000000003'), 1::bigint, 'invalid Expo receipt writes one provider retirement audit event');
select ok(
  not exists (
    select 1
    from public.audit_events as event
    where event.action = 'member.push_device_retired'
      and event.source = 'provider'
      and event.target_id = 'a6100000-0000-4000-8000-000000000003'
      and event.after_state::text like '%ExponentPushToken%'
  ),
  'invalid receipt retirement audit never stores the raw token'
);

-- A result reopen withdraws outstanding provider polling without changing the
-- already-sent push delivery.  The receipt worker observes that withdrawal at
-- its own claim/finalize boundary.
update public.round_completion_runs
set state = 'reopened',
    reopened_at = now(),
    reopened_by = 'a1000000-0000-4000-8000-000000000001',
    reopen_reason = 'receipt test reopen'
where id = 'a4100000-0000-4000-8000-000000000001';
select is((select state from public.round_completion_runs where id = 'a4100000-0000-4000-8000-000000000001'), 'reopened'::public.round_completion_run_state, 'receipt reopen fixture withdraws the official result');
update public.notification_push_receipts
set next_attempt_at = now()
where provider_message_id = 'expo-receipt-ticket-two';
set local role service_role;
create temporary table reopened_receipt as
select *
from public.claim_results_push_receipt(
  'a7100000-0000-4000-8000-000000000005',
  now() - interval '1 hour'
);
select is((select count(*) from reopened_receipt), 1::bigint, 'withdrawn receipt remains claimable for terminal cancellation');
select lives_ok(
  $$ select public.record_results_push_receipt_failure(
       (select receipt_id from reopened_receipt),
       'a7100000-0000-4000-8000-000000000005',
       'provider_unavailable',
       now() + interval '1 hour'
     ) $$,
  'withdrawn receipt finalization cancels instead of retrying'
);
reset role;
select is((select state from public.notification_push_receipts where id = (select receipt_id from reopened_receipt)), 'cancelled'::public.notification_push_receipt_state, 'withdrawn receipt is terminally cancelled');
select is((select failure_reason from public.notification_push_receipts where id = (select receipt_id from reopened_receipt)), 'round_reopened', 'withdrawn receipt records the safe reopen reason');
select is((select state from public.notification_push_deliveries where outbox_job_id = 'a6000000-0000-4000-8000-000000000001' and device_id = 'a6100000-0000-4000-8000-000000000002'), 'sent'::public.notification_delivery_state, 'receipt reopen cancellation preserves the sent delivery');

-- Provider retention is bounded independently of the normal retry cadence. A
-- queued, retryable, and sending ticket older than twenty-four hours is
-- terminalized before a provider request; the sent delivery itself remains
-- historical evidence. The fixture stays official so expiry is not confused
-- with the separate Reopen cancellation path above.
update public.round_completion_runs
set state = 'official'::public.round_completion_run_state,
    reopened_at = null,
    reopened_by = null,
    reopen_reason = null
where id = 'a4100000-0000-4000-8000-000000000001';
update public.notification_outbox_jobs
set state = 'queued'::public.notification_outbox_job_state,
    safe_error = null,
    claimed_at = null,
    finished_at = null,
    next_attempt_at = now()
where id = 'a6000000-0000-4000-8000-000000000001';
insert into public.push_devices (
  device_id, user_id, expo_push_token, platform, last_seen_at
)
values
  ('a6100000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'ExponentPushToken[receipt-four]', 'ios', now()),
  ('a6100000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'ExponentPushToken[receipt-five]', 'android', now()),
  ('a6100000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000001', 'ExponentPushToken[receipt-six]', 'ios', now());

insert into public.notification_push_deliveries (
  id, group_id, outbox_job_id, recipient_membership_id, recipient_user_id,
  device_id, provider_message_id, state, sent_at
)
values
  ('a7600000-0000-4000-8000-000000000004', 'a2000000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'a6100000-0000-4000-8000-000000000004', 'expo-expired-ticket-four', 'sent', now()),
  ('a7600000-0000-4000-8000-000000000005', 'a2000000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'a6100000-0000-4000-8000-000000000005', 'expo-expired-ticket-five', 'sent', now()),
  ('a7600000-0000-4000-8000-000000000006', 'a2000000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'a6100000-0000-4000-8000-000000000006', 'expo-expired-ticket-six', 'sent', now());

update public.notification_push_receipts
set created_at = now() - interval '25 hours',
    next_attempt_at = now(),
    state = case provider_message_id
      when 'expo-expired-ticket-four' then 'queued'::public.notification_push_receipt_state
      when 'expo-expired-ticket-five' then 'retryable'::public.notification_push_receipt_state
      else 'sending'::public.notification_push_receipt_state
    end,
    claim_token = case
      when provider_message_id = 'expo-expired-ticket-six' then 'a7700000-0000-4000-8000-000000000006'::uuid
      else null
    end,
    claimed_at = case
      when provider_message_id = 'expo-expired-ticket-six' then now() - interval '2 hours'
      else null
    end
where provider_message_id in (
  'expo-expired-ticket-four',
  'expo-expired-ticket-five',
  'expo-expired-ticket-six'
);

set local role service_role;
create temporary table expired_receipts as
select *
from public.claim_results_push_receipt(
  'a7800000-0000-4000-8000-000000000001',
  now() - interval '1 hour'
);
reset role;
select is((select count(*) from expired_receipts), 0::bigint, 'expired provider tickets are never leased');
select is(
  (select count(*) from public.notification_push_receipts
   where provider_message_id in ('expo-expired-ticket-four', 'expo-expired-ticket-five', 'expo-expired-ticket-six')
     and state = 'failed_permanent'::public.notification_push_receipt_state),
  3::bigint,
  'queued, retryable, and sending tickets expire to permanent failure'
);
select is(
  (select count(*) from public.notification_push_receipts
   where provider_message_id in ('expo-expired-ticket-four', 'expo-expired-ticket-five', 'expo-expired-ticket-six')
     and failure_reason = 'provider_receipt_expired'),
  3::bigint,
  'expired tickets retain one safe provider-retention reason'
);
select ok(
  (select bool_and(resolved_at is not null)
   from public.notification_push_receipts
   where provider_message_id in ('expo-expired-ticket-four', 'expo-expired-ticket-five', 'expo-expired-ticket-six')),
  'expired tickets record terminal resolution time'
);
select is(
  (select count(*) from public.notification_push_deliveries
   where id in ('a7600000-0000-4000-8000-000000000004', 'a7600000-0000-4000-8000-000000000005', 'a7600000-0000-4000-8000-000000000006')
     and state = 'sent'::public.notification_delivery_state),
  3::bigint,
  'receipt expiry preserves the sent delivery history'
);

-- An aged receipt is cancelled, rather than permanently failed, when its
-- result run has been withdrawn. This is the explicit cancellation precedence
-- over the provider retention boundary.
update public.round_completion_runs
set state = 'reopened'::public.round_completion_run_state,
    reopened_at = now(),
    reopened_by = 'a1000000-0000-4000-8000-000000000001',
    reopen_reason = 'receipt aged withdrawal precedence'
where id = 'a4100000-0000-4000-8000-000000000001';
insert into public.push_devices (
  device_id, user_id, expo_push_token, platform, last_seen_at
)
values ('a6100000-0000-4000-8000-000000000007', 'a1000000-0000-4000-8000-000000000001', 'ExponentPushToken[receipt-seven]', 'ios', now());
insert into public.notification_push_deliveries (
  id, group_id, outbox_job_id, recipient_membership_id, recipient_user_id,
  device_id, provider_message_id, state, sent_at
)
values (
  'a7600000-0000-4000-8000-000000000007', 'a2000000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'a6100000-0000-4000-8000-000000000007', 'expo-withdrawn-expired-ticket', 'sent', now()
);
update public.notification_push_receipts
set created_at = now() - interval '25 hours', next_attempt_at = now()
where provider_message_id = 'expo-withdrawn-expired-ticket';
set local role service_role;
create temporary table withdrawn_expired_receipt as
select *
from public.claim_results_push_receipt(
  'a7800000-0000-0000-8000-000000000002',
  now() - interval '1 hour'
);
reset role;
select is((select count(*) from withdrawn_expired_receipt), 0::bigint, 'withdrawn expired tickets are not leased');
select is((select state from public.notification_push_receipts where provider_message_id = 'expo-withdrawn-expired-ticket'), 'cancelled'::public.notification_push_receipt_state, 'withdrawn expired tickets cancel before provider expiry');
select is((select failure_reason from public.notification_push_receipts where provider_message_id = 'expo-withdrawn-expired-ticket'), 'round_reopened', 'withdrawn expiry keeps the reopen reason');

select * from finish();

rollback;
