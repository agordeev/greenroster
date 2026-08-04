begin;

create extension if not exists pgtap with schema extensions;

select plan(13);

select has_function(
  'public',
  'retire_results_push_device_on_provider_invalid',
  array['uuid', 'uuid', 'uuid', 'uuid'],
  'provider-invalid push retirement boundary exists'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.retire_results_push_device_on_provider_invalid(uuid,uuid,uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.retire_results_push_device_on_provider_invalid(uuid,uuid,uuid,uuid)',
    'execute'
  ),
  'only service_role can retire a provider-invalid device'
);

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at
)
values (
  'a1000000-0000-4000-8000-000000000001',
  'provider-retirement@example.test',
  now(), false, false, now(), now()
);
insert into public.user_profiles (user_id, display_name, first_name, last_name)
values ('a1000000-0000-4000-8000-000000000001', 'Provider Retirement', 'Provider', 'Retirement');
insert into public.groups (id, name, time_zone)
values ('a2000000-0000-4000-8000-000000000001', 'Provider Retirement Group', 'UTC');
insert into public.memberships (
  id, group_id, user_id, role, status, activated_at
)
values (
  'a3000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'member', 'active', now()
);
insert into public.push_devices (
  device_id, user_id, expo_push_token, platform, last_seen_at
)
values (
  'a4000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'ExponentPushToken[provider-invalid]',
  'ios', now()
);

set local role service_role;
create temporary table retired_device as
select *
from public.retire_results_push_device_on_provider_invalid(
  'a4000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001',
  'a5000000-0000-4000-8000-000000000001',
  'a6000000-0000-4000-8000-000000000001'
);
reset role;

select is((select active from retired_device), false, 'provider-invalid feedback retires the device');
select is((select retirement_reason from retired_device), 'provider_invalid', 'provider-invalid reason is durable');
select ok((select retired_at is not null from retired_device), 'provider-invalid retirement records a timestamp');
select is((select version from retired_device), 2::bigint, 'provider-invalid retirement advances the device version');
select is((select expo_push_token from public.push_devices where device_id = 'a4000000-0000-4000-8000-000000000001'), 'ExponentPushToken[provider-invalid]', 'the device row retains its token only in the protected device table');
select is((select count(*) from public.audit_events where action = 'member.push_device_retired' and source = 'provider' and target_id = 'a4000000-0000-4000-8000-000000000001'), 1::bigint, 'provider retirement writes one audit event');
select ok(
  not exists (
    select 1
    from public.audit_events as event
    where event.action = 'member.push_device_retired'
      and event.source = 'provider'
      and event.target_id = 'a4000000-0000-4000-8000-000000000001'
      and event.after_state::text like '%ExponentPushToken%'
  ),
  'provider retirement audit never stores the raw token'
);

set local role service_role;
create temporary table retired_replay as
select *
from public.retire_results_push_device_on_provider_invalid(
  'a4000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001',
  'a5000000-0000-4000-8000-000000000001',
  'a6000000-0000-4000-8000-000000000001'
);
reset role;
select is((select active from retired_replay), false, 'provider-invalid retirement replays its saved receipt');
select is((select version from retired_replay), 2::bigint, 'provider-invalid replay does not advance the device twice');
select is((select count(*) from public.audit_events where action = 'member.push_device_retired' and source = 'provider' and target_id = 'a4000000-0000-4000-8000-000000000001'), 1::bigint, 'provider-invalid replay does not duplicate its audit');

select throws_ok(
  $$ select * from public.retire_results_push_device_on_provider_invalid(
  'a4000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000002',
  'a5000000-0000-4000-8000-000000000002',
  'a6000000-0000-4000-8000-000000000002'
     ) $$,
  'P0003',
  'push_device_group_mismatch',
  'provider retirement cannot cross a tenant boundary'
);

select * from finish();

rollback;
