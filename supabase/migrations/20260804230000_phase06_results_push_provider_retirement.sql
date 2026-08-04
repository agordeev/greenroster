-- Phase 06: trusted provider feedback retires invalid Expo devices.
--
-- Provider workers never expose tokens to clients.  When Expo permanently
-- rejects a token, this service-only boundary retires the install and records
-- a redacted audit event so future result fan-out excludes it.

create function public.retire_results_push_device_on_provider_invalid(
  p_device_id uuid,
  p_group_id uuid,
  p_correlation_id uuid,
  p_operation_id uuid
)
returns table (
  device_id app.entity_id,
  user_id app.entity_id,
  active boolean,
  retirement_reason text,
  retired_at app.utc_instant,
  version bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  device_record public.push_devices%rowtype;
  saved_device public.push_devices%rowtype;
  prior_event public.audit_events%rowtype;
begin
  if p_device_id is null
    or p_group_id is null
    or p_correlation_id is null
    or p_operation_id is null
  then
    raise exception 'push_provider_retirement_context_required' using errcode = '22004';
  end if;

  select device.*
  into device_record
  from public.push_devices as device
  where device.device_id = p_device_id
  for update;
  if not found then
    raise exception 'push_device_not_found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.memberships as membership
    where membership.group_id = p_group_id
      and membership.user_id = device_record.user_id
  ) then
    raise exception 'push_device_group_mismatch' using errcode = 'P0003';
  end if;

  select event.*
  into prior_event
  from public.audit_events as event
  where event.group_id = p_group_id
    and event.action = 'member.push_device_retired'
    and event.target_type = 'push_device'
    and event.target_id = p_device_id
    and event.operation_id = p_operation_id
    and event.source = 'provider';
  if found then
    return query
    select device_record.device_id,
           device_record.user_id,
           (prior_event.after_state ->> 'active')::boolean,
           prior_event.after_state ->> 'retirement_reason',
           (prior_event.after_state ->> 'retired_at')::app.utc_instant,
           (prior_event.after_state ->> 'version')::bigint;
    return;
  end if;

  if device_record.active then
    update public.push_devices as device
    set active = false,
        retired_at = pg_catalog.clock_timestamp(),
        retirement_reason = 'provider_invalid',
        retirement_correlation_id = p_correlation_id,
        version = device.version + 1
    where device.device_id = device_record.device_id
    returning * into saved_device;
  else
    saved_device := device_record;
  end if;

  insert into public.audit_events (
    group_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    target_version,
    after_state,
    source,
    correlation_id,
    operation_id,
    reason
  )
  values (
    p_group_id,
    null,
    'member.push_device_retired',
    'push_device',
    saved_device.device_id,
    saved_device.version,
    pg_catalog.jsonb_build_object(
      'device_id', saved_device.device_id,
      'platform', saved_device.platform,
      'active', saved_device.active,
      'retired_at', saved_device.retired_at,
      'retirement_reason', saved_device.retirement_reason,
      'retirement_correlation_id', saved_device.retirement_correlation_id,
      'version', saved_device.version
    ),
    'provider',
    p_correlation_id,
    p_operation_id,
    'provider_invalid'
  );

  return query
  select saved_device.device_id,
         saved_device.user_id,
         saved_device.active,
         saved_device.retirement_reason,
         saved_device.retired_at,
         saved_device.version;
end;
$$;

comment on function public.retire_results_push_device_on_provider_invalid(uuid, uuid, uuid, uuid) is
  'Service-only idempotent provider feedback boundary. Retires one invalid Expo device without recording its raw token.';

revoke all on function public.retire_results_push_device_on_provider_invalid(uuid, uuid, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.retire_results_push_device_on_provider_invalid(uuid, uuid, uuid, uuid)
to service_role;
grant usage on schema app to service_role;
grant usage on type app.entity_id, app.utc_instant to service_role;
