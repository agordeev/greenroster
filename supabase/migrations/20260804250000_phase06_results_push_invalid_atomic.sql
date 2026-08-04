-- Phase 06: atomically terminalize an invalid push and retire its device.
--
-- Provider-invalid feedback must not leave a failed child with an active
-- device when the retirement call is unavailable. One service transaction
-- owns both effects; a failure rolls both back for a later trusted retry.

create function public.record_results_push_invalid_device(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_device_id uuid,
  p_group_id uuid,
  p_correlation_id uuid,
  p_operation_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  delivery_record public.notification_push_deliveries%rowtype;
  now_at timestamptz := pg_catalog.clock_timestamp();
begin
  if p_delivery_id is null
    or p_claim_token is null
    or p_device_id is null
    or p_group_id is null
    or p_correlation_id is null
    or p_operation_id is null
  then
    raise exception 'delivery_context_required' using errcode = '22004';
  end if;

  select delivery.*
  into delivery_record
  from public.notification_push_deliveries as delivery
  join public.notification_outbox_jobs as outbox
    on outbox.id = delivery.outbox_job_id
   and outbox.group_id = delivery.group_id
  where delivery.id = p_delivery_id
    and delivery.state = 'sending'::public.notification_delivery_state
    and delivery.claim_token = p_claim_token
    and delivery.device_id = p_device_id
    and delivery.group_id = p_group_id
    and outbox.event_type = 'results_published'
    and outbox.aggregate_type = 'round_completion'
  for update of delivery, outbox;
  if not found then
    raise exception 'delivery_claim_invalid' using errcode = 'P0002';
  end if;

  perform public.retire_results_push_device_on_provider_invalid(
    p_device_id,
    p_group_id,
    p_correlation_id,
    p_operation_id
  );

  if app.results_outbox_withdrawn(
    delivery_record.outbox_job_id,
    delivery_record.group_id
  ) then
    update public.notification_push_deliveries as target
    set state = 'cancelled'::public.notification_delivery_state,
        failure_reason = 'round_reopened',
        claim_token = null,
        claimed_at = null,
        sent_at = null,
        next_attempt_at = now_at
    where target.id = delivery_record.id
      and target.group_id = delivery_record.group_id;
  else
    update public.notification_push_deliveries as target
    set state = 'failed_permanent'::public.notification_delivery_state,
        failure_reason = 'provider_invalid',
        claim_token = null,
        claimed_at = null,
        sent_at = null,
        next_attempt_at = now_at
    where target.id = delivery_record.id
      and target.group_id = delivery_record.group_id;
  end if;

  perform app.refresh_results_outbox_state(
    delivery_record.outbox_job_id,
    delivery_record.group_id
  );
end;
$$;

comment on function public.record_results_push_invalid_device(uuid, uuid, uuid, uuid, uuid, uuid) is
  'Service-only atomic provider-invalid finalization and Expo-device retirement boundary.';

revoke all on function public.record_results_push_invalid_device(uuid, uuid, uuid, uuid, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.record_results_push_invalid_device(uuid, uuid, uuid, uuid, uuid, uuid)
to service_role;
