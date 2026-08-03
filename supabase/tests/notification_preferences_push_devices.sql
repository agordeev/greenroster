begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

select has_table('public', 'notification_category_policies', 'notification category policy catalog exists');
select has_table('public', 'notification_preferences', 'notification preferences exist');
select has_table('public', 'push_devices', 'push device registry exists');
select is((select count(*) from public.notification_category_policies), 10::bigint, 'the catalog has the ten specified event categories');
select is((select count(*) from public.notification_category_policies where mandatory), 5::bigint, 'five operational/account categories are mandatory');
select ok(
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'push_devices' and column_name = 'retired_at')
  and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'push_devices' and column_name = 'retirement_reason')
  and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'push_devices' and column_name = 'retirement_correlation_id'),
  'push-device retirement records safe time, reason, and correlation metadata'
);
select ok(
  not has_table_privilege('authenticated', 'public.notification_category_policies', 'select')
  and not has_table_privilege('authenticated', 'public.notification_preferences', 'select,insert,update,delete')
  and not has_table_privilege('authenticated', 'public.push_devices', 'select,insert,update,delete'),
  'authenticated clients cannot bypass the preference or device RPCs'
);
select ok(
  has_function_privilege('authenticated', 'public.resolve_mobile_member_notification_preferences()', 'execute')
  and has_function_privilege('authenticated', 'public.set_mobile_member_notification_preference(public.notification_preference_category,public.notification_preference_channel,boolean,bigint,uuid,uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.register_mobile_push_device(uuid,text,public.push_device_platform,uuid,uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.retire_mobile_push_device(uuid,uuid,uuid)', 'execute'),
  'authenticated clients can use only the constrained member notification boundaries'
);
select ok(
  not has_function_privilege('anon', 'public.resolve_mobile_member_notification_preferences()', 'execute')
  and not has_function_privilege('service_role', 'public.resolve_mobile_member_notification_preferences()', 'execute')
  and not has_function_privilege('anon', 'public.register_mobile_push_device(uuid,text,public.push_device_platform,uuid,uuid)', 'execute')
  and not has_function_privilege('service_role', 'public.register_mobile_push_device(uuid,text,public.push_device_platform,uuid,uuid)', 'execute'),
  'anonymous and service-role callers cannot use member self boundaries'
);
select ok(
  (select prosecdef from pg_catalog.pg_proc where oid = 'public.set_mobile_member_notification_preference(public.notification_preference_category,public.notification_preference_channel,boolean,bigint,uuid,uuid)'::regprocedure)
  and (select prosecdef from pg_catalog.pg_proc where oid = 'public.register_mobile_push_device(uuid,text,public.push_device_platform,uuid,uuid)'::regprocedure),
  'member preference and device mutations are security definer functions'
);
select ok(
  not has_function_privilege('service_role', 'public.set_member_status_impl(uuid,uuid,public.membership_status,bigint,boolean,text,uuid,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.set_member_status_impl(uuid,uuid,public.membership_status,bigint,boolean,text,uuid,uuid)', 'execute'),
  'the correlation-bearing member-status implementation is not directly callable'
);

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at
)
values
  ('b1600000-0000-4000-8000-000000000001', 'notify-a@example.test', now(), false, false, now(), now()),
  ('b1600000-0000-4000-8000-000000000002', 'notify-b@example.test', now(), false, false, now(), now()),
  ('b1600000-0000-4000-8000-000000000003', 'notify-inactive@example.test', now(), false, false, now(), now()),
  ('b1600000-0000-4000-8000-000000000004', 'notify-recovery@example.test', now(), false, false, now(), now());

update auth.users
set raw_app_meta_data = jsonb_build_object(
  'greenroster_password_recovery', jsonb_build_object('session_id', 'b2600000-0000-4000-8000-000000000001')
)
where id = 'b1600000-0000-4000-8000-000000000004';

insert into public.user_profiles (user_id, first_name, last_name)
values
  ('b1600000-0000-4000-8000-000000000001', 'Notify', 'A'),
  ('b1600000-0000-4000-8000-000000000002', 'Notify', 'B'),
  ('b1600000-0000-4000-8000-000000000003', 'Notify', 'Inactive'),
  ('b1600000-0000-4000-8000-000000000004', 'Notify', 'Recovery');

insert into public.groups (id, name, time_zone)
values
  ('b5600000-0000-4000-8000-000000000001', 'Notify Group A', 'UTC'),
  ('b5600000-0000-4000-8000-000000000002', 'Notify Group B', 'UTC');

insert into public.memberships (id, group_id, user_id, role, status, activated_at, inactivated_at)
values
  ('b6600000-0000-4000-8000-000000000001', 'b5600000-0000-4000-8000-000000000001', 'b1600000-0000-4000-8000-000000000001', 'member', 'active', now(), null),
  ('b6600000-0000-4000-8000-000000000002', 'b5600000-0000-4000-8000-000000000002', 'b1600000-0000-4000-8000-000000000002', 'member', 'active', now(), null),
  ('b6600000-0000-4000-8000-000000000003', 'b5600000-0000-4000-8000-000000000001', 'b1600000-0000-4000-8000-000000000003', 'member', 'inactive', null, now()),
  ('b6600000-0000-4000-8000-000000000004', 'b5600000-0000-4000-8000-000000000001', 'b1600000-0000-4000-8000-000000000004', 'member', 'active', now(), null);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b1600000-0000-4000-8000-000000000001', true);

select is(
  (select count(*) from public.resolve_mobile_member_notification_preferences()),
  10::bigint,
  'an active member sees every category'
);
select is(
  (select email_enabled from public.resolve_mobile_member_notification_preferences() where category = 'round_published'),
  true,
  'optional e-mail is enabled by default'
);
select is(
  (select version from public.resolve_mobile_member_notification_preferences() where category = 'round_published'),
  0::bigint,
  'an untouched preference reports version zero'
);
select is(
  (select version from public.resolve_mobile_member_notification_preferences() where category = 'round_cancelled'),
  0::bigint,
  'mandatory defaults do not need a mutable row'
);

select is(
  (select version from public.set_mobile_member_notification_preference(
    'round_published', 'email', false, 0,
    'b2600000-0000-4000-8000-000000000001', 'b3600000-0000-4000-8000-000000000001'
  )),
  1::bigint,
  'an optional channel update is versioned by the server'
);
select is(
  (select email_enabled from public.resolve_mobile_member_notification_preferences() where category = 'round_published'),
  false,
  'the optional e-mail choice persists for the actor membership'
);
set local role postgres;
select is(
  (select count(*) from public.audit_events where action = 'member.notification_preference_changed'),
  1::bigint,
  'one preference update writes one audit event'
);
select ok(
  not exists (
    select 1
    from public.audit_events
    where action = 'member.notification_preference_changed'
      and after_state::text like '%notify-a@example.test%'
  ),
  'preference audit state contains no account e-mail'
);
set local role authenticated;
select is(
  (select version from public.set_mobile_member_notification_preference(
    'round_published', 'email', false, 0,
    'b2600000-0000-4000-8000-000000000099', 'b3600000-0000-4000-8000-000000000001'
  )),
  1::bigint,
  'an exact preference retry returns the original version'
);
set local role postgres;
select is(
  (select count(*) from public.audit_events where action = 'member.notification_preference_changed'),
  1::bigint,
  'an exact preference retry does not duplicate audit'
);
set local role authenticated;
select throws_ok(
  $$ select * from public.set_mobile_member_notification_preference('round_published', 'email', true, 0, 'b2600000-0000-4000-8000-000000000099', 'b3600000-0000-4000-8000-000000000001') $$,
  '23505', 'operation_id_reused', 'a preference operation id cannot be reused with another payload'
);
select throws_ok(
  $$ select * from public.set_mobile_member_notification_preference('round_published', 'push', false, 0, 'b2600000-0000-4000-8000-000000000002', 'b3600000-0000-4000-8000-000000000002') $$,
  '40001', 'notification_preference_version_changed', 'a stale preference version is rejected'
);
select is(
  (select version from public.set_mobile_member_notification_preference(
    'round_published', 'push', false, 1,
    'b2600000-0000-4000-8000-000000000003', 'b3600000-0000-4000-8000-000000000003'
  )),
  2::bigint,
  'a later optional channel update advances its version'
);
select throws_ok(
  $$ select * from public.set_mobile_member_notification_preference('round_cancelled', 'email', false, 0, 'b2600000-0000-4000-8000-000000000004', 'b3600000-0000-4000-8000-000000000004') $$,
  '22023', 'notification_preference_mandatory', 'mandatory categories cannot be disabled'
);
select throws_ok(
  $$ select * from public.set_mobile_member_notification_preference('scoring_opened', 'email', true, 0, 'b2600000-0000-4000-8000-000000000005', 'b3600000-0000-4000-8000-000000000005') $$,
  '22023', 'notification_preference_channel_forbidden', 'unsupported channels are rejected by the policy catalog'
);

select is(
  (select version from public.register_mobile_push_device(
    'b7600000-0000-4000-8000-000000000001', 'ExponentPushToken[notifytoken001]', 'ios',
    'b2600000-0000-4000-8000-000000000006', 'b3600000-0000-4000-8000-000000000006'
  )),
  1::bigint,
  'a member can register one owned push device'
);
select is(
  (select version from public.register_mobile_push_device(
    'b7600000-0000-4000-8000-000000000001', 'ExponentPushToken[notifytoken001]', 'ios',
    'b2600000-0000-4000-8000-000000000007', 'b3600000-0000-4000-8000-000000000006'
  )),
  1::bigint,
  'an exact device registration retry is idempotent'
);
set local role postgres;
select is(
  (select count(*) from public.audit_events where action = 'member.push_device_registered'),
  1::bigint,
  'an exact device retry does not duplicate audit'
);
select ok(
  not exists (
    select 1 from public.audit_events
    where action = 'member.push_device_registered'
      and after_state::text like '%ExponentPushToken%'
  ),
  'raw push tokens never enter audit state'
);
set local role authenticated;
select throws_ok(
  $$ select * from public.register_mobile_push_device('b7600000-0000-4000-8000-000000000002', 'ExponentPushToken[notifytoken001]', 'android', 'b2600000-0000-4000-8000-000000000008', 'b3600000-0000-4000-8000-000000000008') $$,
  '23505', 'push_device_token_in_use', 'a push token cannot be claimed by another device'
);
select set_config('request.jwt.claim.sub', 'b1600000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$ select * from public.register_mobile_push_device('b7600000-0000-4000-8000-000000000001', 'ExponentPushToken[notifytoken003]', 'ios', 'b2600000-0000-4000-8000-000000000009', 'b3600000-0000-4000-8000-000000000009') $$,
  'P0003', 'push_device_unavailable', 'a device id cannot be claimed by another user'
);
select set_config('request.jwt.claim.sub', 'b1600000-0000-4000-8000-000000000001', true);
select is(
  (select active from public.retire_mobile_push_device('b7600000-0000-4000-8000-000000000001', 'b2600000-0000-4000-8000-000000000010', 'b3600000-0000-4000-8000-000000000010')),
  false,
  'a member can retire an owned device'
);
select is(
  (select active from public.retire_mobile_push_device('b7600000-0000-4000-8000-000000000001', 'b2600000-0000-4000-8000-000000000011', 'b3600000-0000-4000-8000-000000000010')),
  false,
  'an exact device retirement retry is idempotent'
);
select throws_ok(
  $$ select * from public.retire_mobile_push_device('b7600000-0000-4000-8000-000000000004', 'b2600000-0000-4000-8000-000000000012', 'b3600000-0000-4000-8000-000000000010') $$,
  '23505', 'operation_id_reused', 'a device retirement operation cannot be reused with another correlation context'
);

-- A signed-out install can return to a new authenticated owner only when the
-- inactive device id and its original Expo token are presented together.
select set_config('request.jwt.claim.sub', 'b1600000-0000-4000-8000-000000000002', true);
select is(
  (select version from public.register_mobile_push_device(
    'b7600000-0000-4000-8000-000000000001', 'ExponentPushToken[notifytoken001]', 'android',
    'b2600000-0000-4000-8000-000000000015', 'b3600000-0000-4000-8000-000000000015'
  )),
  3::bigint,
  'a signed-out inactive install can be handed off with its original token'
);
set local role postgres;
select is(
  (select user_id::text from public.push_devices where device_id = 'b7600000-0000-4000-8000-000000000001'),
  'b1600000-0000-4000-8000-000000000002',
  'a handed-off install belongs to the new authenticated member'
);
select ok(
  (select active and retired_at is null and retirement_reason is null and retirement_correlation_id is null
   from public.push_devices where device_id = 'b7600000-0000-4000-8000-000000000001'),
  'a successful handoff clears prior retirement metadata'
);
select ok(
  not exists (
    select 1 from public.audit_events
    where action = 'member.push_device_registered'
      and (before_state::text like '%ExponentPushToken%' or after_state::text like '%ExponentPushToken%')
  ),
  'handoff audit state still contains no raw push token'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b1600000-0000-4000-8000-000000000001', true);

-- A second active device is retired automatically when membership status is
-- revoked; the trigger is the database invariant used by admin status flows.
select is(
  (select version from public.register_mobile_push_device(
    'b7600000-0000-4000-8000-000000000004', 'ExponentPushToken[notifytoken004]', 'android',
    'b2600000-0000-4000-8000-000000000013', 'b3600000-0000-4000-8000-000000000013'
  )),
  1::bigint,
  'a second device can be registered'
);

-- The public service wrapper supplies an exact operation correlation to the
-- automatic device retirement trigger while keeping the implementation
-- inaccessible to client roles.
set local role postgres;
update public.memberships
set role = 'coordinator'
where id = 'b6600000-0000-4000-8000-000000000001';
update public.memberships
set activated_at = now()
where id = 'b6600000-0000-4000-8000-000000000003';
set local role service_role;
select is(
  (select status from public.set_member_status(
    'b1600000-0000-4000-8000-000000000001',
    'b6600000-0000-4000-8000-000000000003',
    'active',
    2,
    true,
    'correlation wrapper fixture activation',
    'b2600000-0000-4000-8000-000000000016',
    'b3600000-0000-4000-8000-000000000016'
  )),
  'active'::public.membership_status,
  'the public member-status wrapper preserves the service transition'
);
set local role postgres;
insert into public.push_devices (
  device_id,
  user_id,
  expo_push_token,
  platform,
  last_seen_at,
  active,
  version
)
values (
  'b7600000-0000-4000-8000-000000000005',
  'b1600000-0000-4000-8000-000000000003',
  'ExponentPushToken[notifytoken006]',
  'ios',
  now(),
  true,
  1
);
set local role service_role;
select is(
  (select status from public.set_member_status(
    'b1600000-0000-4000-8000-000000000001',
    'b6600000-0000-4000-8000-000000000003',
    'inactive',
    3,
    true,
    'correlation wrapper fixture retirement',
    'b2600000-0000-4000-8000-000000000017',
    'b3600000-0000-4000-8000-000000000017'
  )),
  'inactive'::public.membership_status,
  'the public member-status wrapper preserves the service retirement'
);
set local role postgres;
select is(
  (select retirement_correlation_id::text from public.push_devices where device_id = 'b7600000-0000-4000-8000-000000000005'),
  'b2600000-0000-4000-8000-000000000017',
  'the service wrapper correlation reaches device retirement metadata'
);
select is(
  (select correlation_id::text from public.audit_events where action = 'member.push_device_retired' and target_id = 'b7600000-0000-4000-8000-000000000005'),
  'b2600000-0000-4000-8000-000000000017',
  'the service wrapper correlation reaches the automatic retirement audit'
);

update public.memberships
set status = 'inactive', inactivated_at = now()
where id = 'b6600000-0000-4000-8000-000000000001';
select is((select active from public.push_devices where device_id = 'b7600000-0000-4000-8000-000000000004'), false, 'membership inactivation retires active devices');
select is((select version from public.push_devices where device_id = 'b7600000-0000-4000-8000-000000000004'), 2::bigint, 'membership inactivation versions retired devices');
select is((select retirement_reason from public.push_devices where device_id = 'b7600000-0000-4000-8000-000000000004'), 'membership_inactive', 'automatic retirement records its reason');
select ok((select retired_at is not null and retirement_correlation_id is not null from public.push_devices where device_id = 'b7600000-0000-4000-8000-000000000004'), 'automatic retirement records time and correlation');
select is(
  (select count(*) from public.audit_events where action = 'member.push_device_retired' and target_id = 'b7600000-0000-4000-8000-000000000004'),
  1::bigint,
  'automatic retirement writes one safe device audit event'
);
select ok(
  exists (
    select 1
    from public.audit_events as event
    join public.push_devices as device on device.device_id = event.target_id
    where event.action = 'member.push_device_retired'
      and event.target_id = 'b7600000-0000-4000-8000-000000000004'
      and event.correlation_id = device.retirement_correlation_id
      and event.after_state::text not like '%ExponentPushToken%'
  ),
  'automatic retirement audit uses the device correlation without raw token data'
);
set local role authenticated;

select set_config('request.jwt.claim.sub', 'b1600000-0000-4000-8000-000000000003', true);
select throws_ok($$ select * from public.resolve_mobile_member_notification_preferences() $$, 'P0003', 'actor_not_authorized', 'inactive members cannot read notification preferences');
select set_config('request.jwt.claim.sub', 'b1600000-0000-4000-8000-000000000004', true);
select throws_ok($$ select * from public.resolve_mobile_member_notification_preferences() $$, 'P0003', 'recovery_session_forbidden', 'recovery sessions cannot read notification preferences');
select throws_ok($$ select * from public.register_mobile_push_device('b7600000-0000-4000-8000-000000000005', 'ExponentPushToken[notifytoken005]', 'ios', 'b2600000-0000-4000-8000-000000000014', 'b3600000-0000-4000-8000-000000000014') $$, 'P0003', 'recovery_session_forbidden', 'recovery sessions cannot register push devices');

select * from finish();
rollback;
