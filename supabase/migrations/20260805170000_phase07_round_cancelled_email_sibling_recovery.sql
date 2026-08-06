-- Phase 07: keep cancellation channel siblings independently claimable.
--
-- The generic e-mail finalizers update the shared outbox parent. For
-- round.cancelled, a retryable e-mail must not push a queued mandatory push
-- sibling behind the e-mail's future retry timestamp. Reconcile all child
-- timestamps whenever the generic finalizer marks this parent retryable.

create or replace function app.reconcile_round_cancelled_parent_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The refresh helper itself updates the parent, so nested trigger calls
  -- must stop after the first reconciliation pass.
  if pg_catalog.pg_trigger_depth() > 1 then
    return new;
  end if;

  if new.event_type = 'round.cancelled'
    and new.aggregate_type = 'round'
    and new.state in (
      'retryable'::public.notification_outbox_job_state,
      'succeeded'::public.notification_outbox_job_state,
      'abandoned'::public.notification_outbox_job_state,
      'cancelled'::public.notification_outbox_job_state
    )
  then
    perform app.refresh_round_cancelled_outbox_state(new.id, new.group_id);
    return new;
  end if;

  return new;
end;
$$;

comment on function app.reconcile_round_cancelled_parent_state() is
  'Reconciles terminal and retryable round-cancelled parent updates so e-mail backoff cannot delay a queued push sibling.';
