begin;

create extension if not exists pgtap with schema extensions;

create function pg_temp.test_non_quiet_timezone_announcement()
returns text
language plpgsql
stable
as $$
declare
  utc_hour integer := extract(hour from clock_timestamp())::integer;
  utc_delta integer := utc_hour - 12;
begin
  return case
    when utc_delta = 0 then 'Etc/GMT'
    when utc_delta > 0 then format('Etc/GMT+%s', utc_delta)
    else format('Etc/GMT-%s', -utc_delta)
  end;
end;
$$;

select plan(24);

select has_function(
  'public',
  'claim_round_announcement_push',
  array['uuid', 'timestamptz'],
  'announcement push claim RPC exists'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.claim_round_announcement_push(uuid,timestamptz)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.claim_round_announcement_push(uuid,timestamptz)',
    'execute'
  ),
  'announcement push claim remains service-only'
);
select has_function(
  'public',
  'record_round_announcement_push_send_success',
  array['uuid', 'uuid', 'text'],
  'announcement push success RPC exists'
);
select has_function(
  'public',
  'record_round_announcement_push_send_failure',
  array['uuid', 'uuid', 'text', 'timestamptz'],
  'announcement push failure RPC exists'
);
select has_function(
  'public',
  'record_round_announcement_push_invalid_device',
  array['uuid', 'uuid', 'uuid', 'uuid', 'uuid', 'uuid'],
  'announcement push invalid-device RPC exists'
);

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at
)
values (
  '73000000-0000-4000-8000-000000000001',
  'announcement-member@example.test',
  now(), false, false, now(), now()
);
insert into public.user_profiles (user_id, first_name, last_name)
values ('73000000-0000-4000-8000-000000000001', 'Announcement', 'Member');
insert into public.groups (id, name, time_zone)
values ('73000000-0000-4000-8000-000000000002', 'Announcement Group', 'UTC');
insert into public.memberships (
  id, group_id, user_id, role, status, activated_at
)
values (
  '73000000-0000-4000-8000-000000000003',
  '73000000-0000-4000-8000-000000000002',
  '73000000-0000-4000-8000-000000000001',
  'member', 'active', now()
);
insert into public.rounds (
  id, group_id, description, scheduled_at, group_time_zone, format,
  state, version, published_at, created_by
)
values (
  '73000000-0000-4000-8000-000000000004',
  '73000000-0000-4000-8000-000000000002',
  'Announcement Round', now() + interval '1 day', pg_temp.test_non_quiet_timezone_announcement(), 'individual_net',
  'published', 2, now(), '73000000-0000-4000-8000-000000000001'
);
insert into public.round_participants (id, round_id, group_id, membership_id)
values (
  '73000000-0000-4000-8000-000000000005',
  '73000000-0000-4000-8000-000000000004',
  '73000000-0000-4000-8000-000000000002',
  '73000000-0000-4000-8000-000000000003'
);
insert into public.push_devices (
  device_id, user_id, expo_push_token, platform, last_seen_at
)
values (
  '73000000-0000-4000-8000-000000000006',
  '73000000-0000-4000-8000-000000000001',
  'ExponentPushToken[announcement-fixture]', 'ios', now()
);

insert into public.notification_outbox_jobs (
  id, group_id, event_type, aggregate_type, aggregate_id, aggregate_version,
  idempotency_key
)
values (
  '73000000-0000-4000-8000-000000000007',
  '73000000-0000-4000-8000-000000000002',
  'round.published', 'round', '73000000-0000-4000-8000-000000000004', 2,
  'round.published:73000000-0000-4000-8000-000000000004:73000000-0000-4000-8000-000000000003'
);

select is(
  (select count(*) from public.notification_push_deliveries
   where outbox_job_id = '73000000-0000-4000-8000-000000000007'),
  1::bigint,
  'publication outbox fan-out creates one push child for the active device'
);
select is(
  (select state from public.notification_push_deliveries
   where outbox_job_id = '73000000-0000-4000-8000-000000000007'),
  'queued'::public.notification_delivery_state,
  'announcement push child starts queued'
);

create temporary table announcement_claim as
select * from public.claim_round_announcement_push(
  '73000000-0000-4000-8000-000000000008', now() - interval '1 minute'
);
select is((select count(*) from announcement_claim), 1::bigint, 'announcement push claim returns one device');
select is((select event_type from announcement_claim), 'round.published', 'claim preserves publication event type');
select is((select expo_push_token from announcement_claim), 'ExponentPushToken[announcement-fixture]', 'service claim receives the raw token');
select is(
  (select provider_message_id from public.notification_push_deliveries
   where id = (select delivery_id from announcement_claim)),
  null::text,
  'raw token is not persisted in push delivery rows'
);

select public.record_round_announcement_push_send_success(
  (select delivery_id from announcement_claim),
  '73000000-0000-4000-8000-000000000008',
  'expo-announcement-fixture-ticket'
);
select is(
  (select state from public.notification_push_deliveries
   where id = (select delivery_id from announcement_claim)),
  'sent'::public.notification_delivery_state,
  'announcement push success terminalizes the child'
);

insert into public.notification_preferences (
  membership_id, group_id, category, email_enabled, push_enabled
)
values (
  '73000000-0000-4000-8000-000000000003',
  '73000000-0000-4000-8000-000000000002',
  'round_details_changed', false, true
);
insert into public.notification_outbox_jobs (
  id, group_id, event_type, aggregate_type, aggregate_id, aggregate_version,
  idempotency_key
)
values (
  '73000000-0000-4000-8000-000000000009',
  '73000000-0000-4000-8000-000000000002',
  'round.details_changed', 'round', '73000000-0000-4000-8000-000000000004', 3,
  'round.details_changed:73000000-0000-4000-8000-000000000004:3:73000000-0000-4000-8000-000000000003'
);
insert into public.notification_deliveries (
  id, group_id, outbox_job_id, recipient_membership_id,
  recipient_address, recipient_address_normalized, channel
)
values (
  '73000000-0000-4000-8000-000000000010',
  '73000000-0000-4000-8000-000000000002',
  '73000000-0000-4000-8000-000000000009',
  '73000000-0000-4000-8000-000000000003',
  'announcement-member@example.test', 'announcement-member@example.test', 'email'
);
select is(
  (select state from public.notification_outbox_jobs
   where id = '73000000-0000-4000-8000-000000000009'),
  'queued'::public.notification_outbox_job_state,
  'email preference suppression does not cancel a still-enabled push parent'
);
select is(
  (select count(*) from public.notification_push_deliveries
   where outbox_job_id = '73000000-0000-4000-8000-000000000009'),
  1::bigint,
  'push remains queued when optional e-mail is disabled'
);
select is(
  (select event_type from public.notification_outbox_jobs
   where id = '73000000-0000-4000-8000-000000000009'),
  'round.details_changed',
  'detail-change announcement keeps its event type'
);
create temporary table announcement_details_claim as
select * from public.claim_round_announcement_push(
  '73000000-0000-4000-8000-000000000011', now() - interval '1 minute'
);
select is(
  (select count(*) from announcement_details_claim),
  1::bigint,
  'detail-change announcement claim returns the queued push child'
);
select is(
  (select event_type from announcement_details_claim),
  'round.details_changed',
  'detail-change claim preserves its event type'
);

update public.notification_preferences
set email_enabled = true,
    push_enabled = true
where membership_id = '73000000-0000-4000-8000-000000000003'
  and group_id = '73000000-0000-4000-8000-000000000002'
  and category = 'round_details_changed';
insert into public.notification_outbox_jobs (
  id, group_id, event_type, aggregate_type, aggregate_id, aggregate_version,
  idempotency_key
)
values (
  '73000000-0000-4000-8000-000000000012',
  '73000000-0000-4000-8000-000000000002',
  'round.details_changed', 'round', '73000000-0000-4000-8000-000000000004', 4,
  'round.details_changed:73000000-0000-4000-8000-000000000004:4:73000000-0000-4000-8000-000000000003'
);
insert into public.notification_deliveries (
  id, group_id, outbox_job_id, recipient_membership_id,
  recipient_address, recipient_address_normalized, channel
)
values (
  '73000000-0000-4000-8000-000000000013',
  '73000000-0000-4000-8000-000000000002',
  '73000000-0000-4000-8000-000000000012',
  '73000000-0000-4000-8000-000000000003',
  'announcement-member@example.test', 'announcement-member@example.test', 'email'
);
update public.notification_preferences
set email_enabled = false
where membership_id = '73000000-0000-4000-8000-000000000003'
  and group_id = '73000000-0000-4000-8000-000000000002'
  and category = 'round_details_changed';
select is(
  (select count(*) from public.notification_push_deliveries
   where outbox_job_id = '73000000-0000-4000-8000-000000000012'),
  1::bigint,
  'disabling e-mail after fan-out preserves the push sibling'
);
select is(
  (select state from public.notification_deliveries
   where id = '73000000-0000-4000-8000-000000000013'),
  'cancelled'::public.notification_delivery_state,
  'disabling e-mail cancels its queued child'
);
select is(
  (select state from public.notification_push_deliveries
   where outbox_job_id = '73000000-0000-4000-8000-000000000012'),
  'queued'::public.notification_delivery_state,
  'push remains queued after e-mail preference change'
);
select is(
  (select state from public.notification_outbox_jobs
   where id = '73000000-0000-4000-8000-000000000012'),
  'queued'::public.notification_outbox_job_state,
  'parent remains claimable after e-mail preference change'
);
update auth.users
set is_anonymous = true
where id = '73000000-0000-4000-8000-000000000001';
create temporary table ineligible_announcement_claim as
select * from public.claim_round_announcement_push(
  '73000000-0000-4000-8000-000000000014', now() - interval '1 minute'
);
select is(
  (select count(*) from ineligible_announcement_claim),
  0::bigint,
  'claim revalidates Auth identity eligibility at send time'
);
select is(
  (select state from public.notification_push_deliveries
   where outbox_job_id = '73000000-0000-4000-8000-000000000012'),
  'cancelled'::public.notification_delivery_state,
  'ineligible Auth identity cancels its queued push child'
);
select is(
  (select state from public.notification_outbox_jobs
   where id = '73000000-0000-4000-8000-000000000012'),
  'cancelled'::public.notification_outbox_job_state,
  'ineligible Auth identity cancels the announcement parent'
);

rollback;
