-- Phase 06: claim/finalize boundaries for completion result notifications.
--
-- Result completion owns one aggregate outbox row with many e-mail and push
-- children.  These service-only functions lease one child at a time, resolve
-- current recipient eligibility, and terminalize the parent only after every
-- child is terminal.

create function app.refresh_results_outbox_state(
  p_outbox_job_id uuid,
  p_group_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  now_at timestamptz := pg_catalog.clock_timestamp();
  has_sending boolean;
  has_retryable boolean;
  has_queued boolean;
  has_failed_permanent boolean;
  next_retry_at timestamptz;
  completion_state public.round_completion_run_state;
  round_state public.round_state;
  reopened_at timestamptz;
begin
  if p_outbox_job_id is null or p_group_id is null then
    return;
  end if;

  -- A result event is no longer dispatchable once its official completion has
  -- been reopened (or the round has left completed state).  Reopen cancels
  -- queued work immediately; this guard also closes the race where a trusted
  -- provider was already processing a child when the lifecycle changed.
  select completion.state, round_record.state, completion.reopened_at
  into completion_state, round_state, reopened_at
  from public.notification_outbox_jobs as outbox
  join public.round_completion_runs as completion
    on completion.id = outbox.aggregate_id
   and completion.group_id = outbox.group_id
  join public.rounds as round_record
    on round_record.id = completion.round_id
   and round_record.group_id = completion.group_id
  where outbox.id = p_outbox_job_id
    and outbox.group_id = p_group_id
    and outbox.event_type = 'results_published'
    and outbox.aggregate_type = 'round_completion';

  if found
    and (
      completion_state <> 'official'::public.round_completion_run_state
      or round_state <> 'completed'::public.round_state
    )
  then
    update public.notification_outbox_jobs as target
    set state = 'cancelled'::public.notification_outbox_job_state,
        safe_error = 'round_reopened',
        claimed_at = null,
        finished_at = coalesce(reopened_at, now_at),
        next_attempt_at = coalesce(reopened_at, now_at)
    where target.id = p_outbox_job_id
      and target.group_id = p_group_id
      and target.state in (
        'queued'::public.notification_outbox_job_state,
        'retryable'::public.notification_outbox_job_state,
        'processing'::public.notification_outbox_job_state
      );
    return;
  end if;

  select
    exists (
      select 1
      from public.notification_deliveries as delivery
      where delivery.outbox_job_id = p_outbox_job_id
        and delivery.group_id = p_group_id
        and delivery.state = 'sending'::public.notification_delivery_state
    )
    or exists (
      select 1
      from public.notification_push_deliveries as delivery
      where delivery.outbox_job_id = p_outbox_job_id
        and delivery.group_id = p_group_id
        and delivery.state = 'sending'::public.notification_delivery_state
    ),
    exists (
      select 1
      from public.notification_deliveries as delivery
      where delivery.outbox_job_id = p_outbox_job_id
        and delivery.group_id = p_group_id
        and delivery.state = 'retryable'::public.notification_delivery_state
    )
    or exists (
      select 1
      from public.notification_push_deliveries as delivery
      where delivery.outbox_job_id = p_outbox_job_id
        and delivery.group_id = p_group_id
        and delivery.state = 'retryable'::public.notification_delivery_state
    ),
    exists (
      select 1
      from public.notification_deliveries as delivery
      where delivery.outbox_job_id = p_outbox_job_id
        and delivery.group_id = p_group_id
        and delivery.state = 'queued'::public.notification_delivery_state
    )
    or exists (
      select 1
      from public.notification_push_deliveries as delivery
      where delivery.outbox_job_id = p_outbox_job_id
        and delivery.group_id = p_group_id
        and delivery.state = 'queued'::public.notification_delivery_state
    ),
    exists (
      select 1
      from public.notification_deliveries as delivery
      where delivery.outbox_job_id = p_outbox_job_id
        and delivery.group_id = p_group_id
        and delivery.state = 'failed_permanent'::public.notification_delivery_state
    )
    or exists (
      select 1
      from public.notification_push_deliveries as delivery
      where delivery.outbox_job_id = p_outbox_job_id
        and delivery.group_id = p_group_id
        and delivery.state = 'failed_permanent'::public.notification_delivery_state
    )
  into has_sending, has_retryable, has_queued, has_failed_permanent;

  if has_sending then
    update public.notification_outbox_jobs
    set state = 'processing'::public.notification_outbox_job_state,
        claimed_at = coalesce(claimed_at, now_at),
        finished_at = null,
        next_attempt_at = now_at
    where id = p_outbox_job_id
      and group_id = p_group_id
      and state <> 'cancelled'::public.notification_outbox_job_state;
    return;
  end if;

  if has_retryable or has_queued then
    select least(
      coalesce((
        select min(delivery.next_attempt_at)
        from public.notification_deliveries as delivery
        where delivery.outbox_job_id = p_outbox_job_id
          and delivery.group_id = p_group_id
          and delivery.state in ('queued', 'retryable')
      ), 'infinity'::timestamptz),
      coalesce((
        select min(delivery.next_attempt_at)
        from public.notification_push_deliveries as delivery
        where delivery.outbox_job_id = p_outbox_job_id
          and delivery.group_id = p_group_id
          and delivery.state in ('queued', 'retryable')
      ), 'infinity'::timestamptz)
    )
    into next_retry_at;

    update public.notification_outbox_jobs
    set state = case
          when has_retryable then 'retryable'::public.notification_outbox_job_state
          else 'queued'::public.notification_outbox_job_state
        end,
        claimed_at = null,
        finished_at = null,
        safe_error = null,
        next_attempt_at = coalesce(next_retry_at, now_at)
    where id = p_outbox_job_id
      and group_id = p_group_id
      and state <> 'cancelled'::public.notification_outbox_job_state;
    return;
  end if;

  update public.notification_outbox_jobs
  set state = case
        when has_failed_permanent then 'abandoned'::public.notification_outbox_job_state
        else 'succeeded'::public.notification_outbox_job_state
      end,
      safe_error = case
        when has_failed_permanent then 'child_delivery_failed'
        else null
      end,
      claimed_at = null,
      finished_at = now_at,
      next_attempt_at = now_at
  where id = p_outbox_job_id
    and group_id = p_group_id
    and state <> 'cancelled'::public.notification_outbox_job_state;
end;
$$;

-- Reopen can race with a provider lease.  Extend the earlier push-only
-- trigger so both channels and the aggregate parent are terminalized for all
-- unsent work; an already sent child remains immutable provider history.
create or replace function app.cancel_results_push_deliveries_on_reopen()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.state is distinct from new.state
    and new.state = 'reopened'::public.round_completion_run_state
  then
    update public.notification_deliveries as delivery
    set state = 'cancelled'::public.notification_delivery_state,
        failure_reason = 'round_reopened',
        next_attempt_at = coalesce(new.reopened_at, pg_catalog.clock_timestamp())
    from public.notification_outbox_jobs as outbox
    where delivery.outbox_job_id = outbox.id
      and delivery.group_id = outbox.group_id
      and outbox.group_id = new.group_id
      and outbox.event_type = 'results_published'
      and outbox.aggregate_type = 'round_completion'
      and outbox.aggregate_id = new.id
      and delivery.state in ('queued', 'retryable');

    update public.notification_push_deliveries as delivery
    set state = 'cancelled'::public.notification_delivery_state,
        failure_reason = 'round_reopened',
        next_attempt_at = coalesce(new.reopened_at, pg_catalog.clock_timestamp())
    from public.notification_outbox_jobs as outbox
    where delivery.outbox_job_id = outbox.id
      and delivery.group_id = outbox.group_id
      and outbox.group_id = new.group_id
      and outbox.event_type = 'results_published'
      and outbox.aggregate_type = 'round_completion'
      and outbox.aggregate_id = new.id
      and delivery.state in ('queued', 'retryable');

    update public.notification_outbox_jobs as outbox
    set state = 'cancelled'::public.notification_outbox_job_state,
        safe_error = 'round_reopened',
        claimed_at = null,
        finished_at = coalesce(new.reopened_at, pg_catalog.clock_timestamp()),
        next_attempt_at = coalesce(new.reopened_at, pg_catalog.clock_timestamp())
    where outbox.group_id = new.group_id
      and outbox.event_type = 'results_published'
      and outbox.aggregate_type = 'round_completion'
      and outbox.aggregate_id = new.id
      and outbox.state in (
        'queued'::public.notification_outbox_job_state,
        'retryable'::public.notification_outbox_job_state,
        'processing'::public.notification_outbox_job_state
      );
  end if;

  return new;
end;
$$;

revoke all on function app.cancel_results_push_deliveries_on_reopen()
from public, anon, authenticated, service_role;

create function app.results_outbox_withdrawn(
  p_outbox_job_id uuid,
  p_group_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.notification_outbox_jobs as outbox
    left join public.round_completion_runs as completion
      on completion.id = outbox.aggregate_id
     and completion.group_id = outbox.group_id
    left join public.rounds as round_record
      on round_record.id = completion.round_id
     and round_record.group_id = completion.group_id
    where outbox.id = p_outbox_job_id
      and outbox.group_id = p_group_id
      and outbox.event_type = 'results_published'
      and outbox.aggregate_type = 'round_completion'
      and (
        outbox.state = 'cancelled'::public.notification_outbox_job_state
        or completion.id is null
        or completion.state <> 'official'::public.round_completion_run_state
        or round_record.id is null
        or round_record.state <> 'completed'::public.round_state
      )
  );
$$;

revoke all on function app.results_outbox_withdrawn(uuid, uuid)
from public, anon, authenticated, service_role;

revoke all on function app.refresh_results_outbox_state(uuid, uuid)
from public, anon, authenticated, service_role;

create function public.claim_results_published_email(
  p_claim_token uuid,
  p_stale_before timestamptz
)
returns table (
  delivery_id app.entity_id,
  outbox_job_id app.entity_id,
  completion_id app.entity_id,
  round_id app.entity_id,
  group_id app.entity_id,
  group_name text,
  group_time_zone text,
  round_description text,
  completed_at app.utc_instant,
  recipient_address text,
  attempt_number integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  now_at timestamptz := pg_catalog.clock_timestamp();
  selected_delivery record;
  invalid_delivery record;
  stale_delivery record;
begin
  if p_claim_token is null then
    raise exception 'delivery_claim_token_required' using errcode = '22004';
  end if;
  if p_stale_before is null or p_stale_before > now_at then
    raise exception 'delivery_stale_boundary_invalid' using errcode = '22023';
  end if;

  for stale_delivery in
    select
      delivery.id,
      delivery.group_id,
      delivery.outbox_job_id,
      app.results_outbox_withdrawn(delivery.outbox_job_id, delivery.group_id) as withdrawn
    from public.notification_deliveries as delivery
    join public.notification_outbox_jobs as outbox
      on outbox.id = delivery.outbox_job_id
     and outbox.group_id = delivery.group_id
    where delivery.channel = 'email'::public.notification_channel
      and delivery.state = 'sending'::public.notification_delivery_state
      and delivery.claimed_at <= p_stale_before
      and outbox.event_type = 'results_published'
      and outbox.aggregate_type = 'round_completion'
      and outbox.state in (
        'processing'::public.notification_outbox_job_state,
        'cancelled'::public.notification_outbox_job_state
      )
    for update of delivery, outbox skip locked
  loop
    update public.notification_deliveries as target
    set state = case
          when stale_delivery.withdrawn
            then 'cancelled'::public.notification_delivery_state
          else 'retryable'::public.notification_delivery_state
        end,
        failure_reason = case
          when stale_delivery.withdrawn then 'round_reopened'
          else 'claim_expired'
        end,
        claim_token = null,
        claimed_at = null,
        next_attempt_at = now_at
    where target.id = stale_delivery.id
      and target.group_id = stale_delivery.group_id;
    perform app.refresh_results_outbox_state(stale_delivery.outbox_job_id, stale_delivery.group_id);
  end loop;

  for invalid_delivery in
    select
      delivery.id,
      delivery.group_id,
      delivery.outbox_job_id,
      case
        when completion.state <> 'official'::public.round_completion_run_state
          or round_record.state <> 'completed'::public.round_state
          then 'round_reopened'
        when membership.status <> 'active'::public.membership_status
          then 'member_inactive'
        when profile.user_id is null or profile.disabled_at is not null
          or identity.id is null
          or identity.email_confirmed_at is null
          or identity.deleted_at is not null
          or identity.is_anonymous
          or (identity.banned_until is not null and identity.banned_until > now_at)
          or identity.email is null
          or pg_catalog.length(pg_catalog.btrim(identity.email)) not between 3 and 320
          or pg_catalog.btrim(identity.email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
          then 'member_identity_unavailable'
        when exists (
          select 1
          from public.email_suppressions as suppression
          where suppression.normalized_address = pg_catalog.lower(pg_catalog.btrim(identity.email))
        ) then 'email_suppressed'
        when not coalesce(preference.email_enabled, policy.default_email_enabled)
          then 'preference_disabled'
        else null
      end as safe_reason
    from public.notification_deliveries as delivery
    join public.notification_outbox_jobs as outbox
      on outbox.id = delivery.outbox_job_id
     and outbox.group_id = delivery.group_id
    join public.round_completion_runs as completion
      on completion.id = outbox.aggregate_id
     and completion.group_id = outbox.group_id
    join public.rounds as round_record
      on round_record.id = completion.round_id
     and round_record.group_id = completion.group_id
    join public.round_participants as participant
      on participant.round_id = completion.round_id
     and participant.group_id = completion.group_id
     and participant.membership_id = delivery.recipient_membership_id
    join public.memberships as membership
      on membership.id = participant.membership_id
     and membership.group_id = participant.group_id
    left join public.user_profiles as profile
      on profile.user_id = membership.user_id
    left join auth.users as identity
      on identity.id = membership.user_id
    join public.notification_category_policies as policy
      on policy.category = 'results_published'::public.notification_preference_category
    left join public.notification_preferences as preference
      on preference.membership_id = membership.id
     and preference.group_id = membership.group_id
     and preference.category = policy.category
    where delivery.channel = 'email'::public.notification_channel
      and delivery.state in ('queued', 'retryable')
      and outbox.event_type = 'results_published'
      and outbox.aggregate_type = 'round_completion'
      and outbox.state in (
        'queued'::public.notification_outbox_job_state,
        'retryable'::public.notification_outbox_job_state,
        'processing'::public.notification_outbox_job_state
      )
      and delivery.next_attempt_at <= now_at
      and outbox.next_attempt_at <= now_at
      and (
        completion.state <> 'official'::public.round_completion_run_state
        or round_record.state <> 'completed'::public.round_state
        or membership.status <> 'active'::public.membership_status
        or profile.user_id is null
        or profile.disabled_at is not null
        or identity.id is null
        or identity.email_confirmed_at is null
        or identity.deleted_at is not null
        or identity.is_anonymous
        or (identity.banned_until is not null and identity.banned_until > now_at)
        or identity.email is null
        or pg_catalog.length(pg_catalog.btrim(identity.email)) not between 3 and 320
        or pg_catalog.btrim(identity.email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        or exists (
          select 1
          from public.email_suppressions as suppression
          where suppression.normalized_address = pg_catalog.lower(pg_catalog.btrim(identity.email))
        )
        or not coalesce(preference.email_enabled, policy.default_email_enabled)
      )
    order by delivery.next_attempt_at, delivery.created_at, delivery.id
    for update of delivery, outbox skip locked
  loop
    update public.notification_deliveries as target
    set state = case
          when invalid_delivery.safe_reason = 'email_suppressed'
            then 'suppressed'::public.notification_delivery_state
          else 'cancelled'::public.notification_delivery_state
        end,
        failure_reason = invalid_delivery.safe_reason,
        claim_token = null,
        claimed_at = null,
        next_attempt_at = now_at
    where target.id = invalid_delivery.id
      and target.group_id = invalid_delivery.group_id;
    perform app.refresh_results_outbox_state(invalid_delivery.outbox_job_id, invalid_delivery.group_id);
  end loop;

  select
    delivery.id as delivery_id,
    outbox.id as outbox_job_id,
    completion.id as completion_id,
    completion.round_id,
    delivery.group_id,
    group_record.name as group_name,
    round_record.group_time_zone::text as group_time_zone,
    round_record.description as round_description,
    completion.completed_at,
    pg_catalog.btrim(identity.email) as recipient_address,
    delivery.attempts + 1 as attempt_number
  into selected_delivery
  from public.notification_deliveries as delivery
  join public.notification_outbox_jobs as outbox
    on outbox.id = delivery.outbox_job_id
   and outbox.group_id = delivery.group_id
  join public.round_completion_runs as completion
    on completion.id = outbox.aggregate_id
   and completion.group_id = outbox.group_id
   and completion.state = 'official'::public.round_completion_run_state
  join public.rounds as round_record
    on round_record.id = completion.round_id
   and round_record.group_id = completion.group_id
   and round_record.state = 'completed'::public.round_state
  join public.round_participants as participant
    on participant.round_id = completion.round_id
   and participant.group_id = completion.group_id
   and participant.membership_id = delivery.recipient_membership_id
  join public.memberships as membership
    on membership.id = participant.membership_id
   and membership.group_id = participant.group_id
   and membership.status = 'active'::public.membership_status
  join public.user_profiles as profile
    on profile.user_id = membership.user_id
   and profile.disabled_at is null
  join auth.users as identity
    on identity.id = membership.user_id
   and identity.email_confirmed_at is not null
   and identity.deleted_at is null
   and not identity.is_anonymous
   and (identity.banned_until is null or identity.banned_until <= now_at)
   and identity.email is not null
   and pg_catalog.length(pg_catalog.btrim(identity.email)) between 3 and 320
   and pg_catalog.btrim(identity.email) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  join public.notification_category_policies as policy
    on policy.category = 'results_published'::public.notification_preference_category
  left join public.notification_preferences as preference
    on preference.membership_id = membership.id
   and preference.group_id = membership.group_id
   and preference.category = policy.category
  join public.groups as group_record on group_record.id = delivery.group_id
  where delivery.channel = 'email'::public.notification_channel
    and delivery.state in ('queued', 'retryable')
    and delivery.next_attempt_at <= now_at
    and outbox.event_type = 'results_published'
    and outbox.aggregate_type = 'round_completion'
    and outbox.state in (
      'queued'::public.notification_outbox_job_state,
      'retryable'::public.notification_outbox_job_state,
      'processing'::public.notification_outbox_job_state
    )
    and outbox.next_attempt_at <= now_at
    and coalesce(preference.email_enabled, policy.default_email_enabled)
    and not exists (
      select 1
      from public.email_suppressions as suppression
      where suppression.normalized_address = pg_catalog.lower(pg_catalog.btrim(identity.email))
    )
  order by delivery.next_attempt_at, delivery.created_at, delivery.id
    for update of delivery, outbox skip locked
    limit 1;

  if not found then
    return;
  end if;

  update public.notification_deliveries as target
  set state = 'sending'::public.notification_delivery_state,
      claim_token = p_claim_token,
      claimed_at = now_at,
      attempts = selected_delivery.attempt_number,
      failure_reason = null,
      recipient_address = selected_delivery.recipient_address,
      recipient_address_normalized = pg_catalog.lower(selected_delivery.recipient_address)
  where target.id = selected_delivery.delivery_id
    and target.group_id = selected_delivery.group_id;

  update public.notification_outbox_jobs as target
  set state = 'processing'::public.notification_outbox_job_state,
      claimed_at = now_at,
      attempts = greatest(target.attempts, selected_delivery.attempt_number),
      safe_error = null,
      finished_at = null
  where target.id = selected_delivery.outbox_job_id
    and target.group_id = selected_delivery.group_id
    and target.state <> 'cancelled'::public.notification_outbox_job_state;

  return query
  select
    selected_delivery.delivery_id::app.entity_id,
    selected_delivery.outbox_job_id::app.entity_id,
    selected_delivery.completion_id::app.entity_id,
    selected_delivery.round_id::app.entity_id,
    selected_delivery.group_id::app.entity_id,
    selected_delivery.group_name::text,
    selected_delivery.group_time_zone::text,
    selected_delivery.round_description::text,
    selected_delivery.completed_at::app.utc_instant,
    selected_delivery.recipient_address::text,
    selected_delivery.attempt_number::integer;
end;
$$;

comment on function public.claim_results_published_email(uuid, timestamptz) is
  'Service-only atomic claim for one completion-result e-mail. It revalidates the current official run, member identity, preference, and suppression state before exposing the current address.';

revoke all on function public.claim_results_published_email(uuid, timestamptz)
from public, anon, authenticated;
grant execute on function public.claim_results_published_email(uuid, timestamptz)
to service_role;

create function public.record_results_email_send_success(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_provider_message_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  delivery_record public.notification_deliveries%rowtype;
  now_at timestamptz := pg_catalog.clock_timestamp();
begin
  if p_delivery_id is null or p_claim_token is null then
    raise exception 'delivery_context_required' using errcode = '22004';
  end if;
  if p_provider_message_id is null
    or pg_catalog.btrim(p_provider_message_id) <> p_provider_message_id
    or pg_catalog.length(p_provider_message_id) not between 1 and 255
  then
    raise exception 'provider_message_id_invalid' using errcode = '22023';
  end if;

  select delivery.*
  into delivery_record
  from public.notification_deliveries as delivery
  join public.notification_outbox_jobs as outbox
    on outbox.id = delivery.outbox_job_id
   and outbox.group_id = delivery.group_id
  where delivery.id = p_delivery_id
    and delivery.state = 'sending'::public.notification_delivery_state
    and delivery.claim_token = p_claim_token
    and outbox.event_type = 'results_published'
    and outbox.aggregate_type = 'round_completion'
  for update of delivery, outbox;
  if not found then
    raise exception 'delivery_claim_invalid' using errcode = 'P0002';
  end if;

  update public.notification_deliveries as target
  set provider_message_id = p_provider_message_id,
      state = 'sent'::public.notification_delivery_state,
      sent_at = now_at,
      claim_token = null,
      claimed_at = null,
      failure_reason = null,
      next_attempt_at = now_at
  where target.id = delivery_record.id
    and target.group_id = delivery_record.group_id;

  perform app.refresh_results_outbox_state(
    delivery_record.outbox_job_id,
    delivery_record.group_id
  );
end;
$$;

revoke all on function public.record_results_email_send_success(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.record_results_email_send_success(uuid, uuid, text)
to service_role;

create function public.record_results_email_send_failure(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_safe_error text,
  p_retry_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  delivery_record public.notification_deliveries%rowtype;
  now_at timestamptz := pg_catalog.clock_timestamp();
begin
  if p_delivery_id is null or p_claim_token is null then
    raise exception 'delivery_context_required' using errcode = '22004';
  end if;
  if p_safe_error is null
    or pg_catalog.length(pg_catalog.btrim(p_safe_error)) not between 1 and 200
    or p_safe_error !~ '^[a-z0-9][a-z0-9_.:-]{0,199}$'
  then
    raise exception 'safe_error_invalid' using errcode = '22023';
  end if;
  if p_retry_at is not null and p_retry_at <= now_at then
    raise exception 'retry_at_invalid' using errcode = '22023';
  end if;

  select delivery.*
  into delivery_record
  from public.notification_deliveries as delivery
  join public.notification_outbox_jobs as outbox
    on outbox.id = delivery.outbox_job_id
   and outbox.group_id = delivery.group_id
  where delivery.id = p_delivery_id
    and delivery.state = 'sending'::public.notification_delivery_state
    and delivery.claim_token = p_claim_token
    and outbox.event_type = 'results_published'
    and outbox.aggregate_type = 'round_completion'
  for update of delivery, outbox;
  if not found then
    raise exception 'delivery_claim_invalid' using errcode = 'P0002';
  end if;

  if app.results_outbox_withdrawn(
    delivery_record.outbox_job_id,
    delivery_record.group_id
  ) then
    update public.notification_deliveries as target
    set state = 'cancelled'::public.notification_delivery_state,
        failure_reason = 'round_reopened',
        claim_token = null,
        claimed_at = null,
        sent_at = null,
        next_attempt_at = now_at
    where target.id = delivery_record.id
      and target.group_id = delivery_record.group_id;
  elsif p_retry_at is null then
    update public.notification_deliveries as target
    set state = 'failed_permanent'::public.notification_delivery_state,
        failure_reason = p_safe_error,
        claim_token = null,
        claimed_at = null,
        sent_at = null,
        next_attempt_at = now_at
    where target.id = delivery_record.id
      and target.group_id = delivery_record.group_id;
  else
    update public.notification_deliveries as target
    set state = 'retryable'::public.notification_delivery_state,
        failure_reason = p_safe_error,
        claim_token = null,
        claimed_at = null,
        next_attempt_at = p_retry_at
    where target.id = delivery_record.id
      and target.group_id = delivery_record.group_id;
  end if;

  perform app.refresh_results_outbox_state(
    delivery_record.outbox_job_id,
    delivery_record.group_id
  );
end;
$$;

revoke all on function public.record_results_email_send_failure(uuid, uuid, text, timestamptz)
from public, anon, authenticated;
grant execute on function public.record_results_email_send_failure(uuid, uuid, text, timestamptz)
to service_role;

create function public.claim_results_published_push(
  p_claim_token uuid,
  p_stale_before timestamptz
)
returns table (
  delivery_id app.entity_id,
  outbox_job_id app.entity_id,
  completion_id app.entity_id,
  round_id app.entity_id,
  group_id app.entity_id,
  round_description text,
  completed_at app.utc_instant,
  recipient_user_id app.entity_id,
  device_id app.entity_id,
  expo_push_token text,
  attempt_number integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  now_at timestamptz := pg_catalog.clock_timestamp();
  selected_delivery record;
  invalid_delivery record;
  stale_delivery record;
  quiet_delivery record;
begin
  if p_claim_token is null then
    raise exception 'delivery_claim_token_required' using errcode = '22004';
  end if;
  if p_stale_before is null or p_stale_before > now_at then
    raise exception 'delivery_stale_boundary_invalid' using errcode = '22023';
  end if;

  for stale_delivery in
    select
      delivery.id,
      delivery.group_id,
      delivery.outbox_job_id,
      app.results_outbox_withdrawn(delivery.outbox_job_id, delivery.group_id) as withdrawn
    from public.notification_push_deliveries as delivery
    join public.notification_outbox_jobs as outbox
      on outbox.id = delivery.outbox_job_id
     and outbox.group_id = delivery.group_id
    where delivery.state = 'sending'::public.notification_delivery_state
      and delivery.claimed_at <= p_stale_before
      and outbox.event_type = 'results_published'
      and outbox.aggregate_type = 'round_completion'
      and outbox.state in (
        'processing'::public.notification_outbox_job_state,
        'cancelled'::public.notification_outbox_job_state
      )
    for update of delivery, outbox skip locked
  loop
    update public.notification_push_deliveries as target
    set state = case
          when stale_delivery.withdrawn
            then 'cancelled'::public.notification_delivery_state
          else 'retryable'::public.notification_delivery_state
        end,
        failure_reason = case
          when stale_delivery.withdrawn then 'round_reopened'
          else 'claim_expired'
        end,
        claim_token = null,
        claimed_at = null,
        next_attempt_at = now_at
    where target.id = stale_delivery.id
      and target.group_id = stale_delivery.group_id;
    perform app.refresh_results_outbox_state(stale_delivery.outbox_job_id, stale_delivery.group_id);
  end loop;

  -- A worker may wake while a queued child is inside the quiet window, or a
  -- previous lease may have been manually made due.  Recompute the next local
  -- 07:00 boundary instead of sending early.
  for quiet_delivery in
    select
      delivery.id,
      delivery.group_id,
      delivery.outbox_job_id,
      case
        when (now_at at time zone round_record.group_time_zone)::time >= time '21:00'
          then (
            (
              ((now_at at time zone round_record.group_time_zone)::date + 1)::timestamp
              + time '07:00'
            ) at time zone round_record.group_time_zone
          )
        else (
          (
            (now_at at time zone round_record.group_time_zone)::date::timestamp
            + time '07:00'
          ) at time zone round_record.group_time_zone
        )
      end as quiet_until
    from public.notification_push_deliveries as delivery
    join public.notification_outbox_jobs as outbox
      on outbox.id = delivery.outbox_job_id
     and outbox.group_id = delivery.group_id
    join public.round_completion_runs as completion
      on completion.id = outbox.aggregate_id
     and completion.group_id = outbox.group_id
    join public.rounds as round_record
      on round_record.id = completion.round_id
     and round_record.group_id = completion.group_id
    where delivery.state in ('queued', 'retryable')
      and delivery.next_attempt_at <= now_at
      and outbox.next_attempt_at <= now_at
      and outbox.event_type = 'results_published'
      and outbox.aggregate_type = 'round_completion'
      and outbox.state in (
        'queued'::public.notification_outbox_job_state,
        'retryable'::public.notification_outbox_job_state,
        'processing'::public.notification_outbox_job_state
      )
      and (
        (now_at at time zone round_record.group_time_zone)::time >= time '21:00'
        or (now_at at time zone round_record.group_time_zone)::time < time '07:00'
      )
    order by delivery.next_attempt_at, delivery.created_at, delivery.id
    for update of delivery, outbox skip locked
  loop
    update public.notification_push_deliveries as target
    set next_attempt_at = quiet_delivery.quiet_until
    where target.id = quiet_delivery.id
      and target.group_id = quiet_delivery.group_id;
    perform app.refresh_results_outbox_state(quiet_delivery.outbox_job_id, quiet_delivery.group_id);
  end loop;

  for invalid_delivery in
    select
      delivery.id,
      delivery.group_id,
      delivery.outbox_job_id,
      case
        when completion.state <> 'official'::public.round_completion_run_state
          or round_record.state <> 'completed'::public.round_state
          then 'round_reopened'
        when membership.status <> 'active'::public.membership_status
          then 'member_inactive'
        when profile.user_id is null or profile.disabled_at is not null
          or identity.id is null
          or identity.email_confirmed_at is null
          or identity.deleted_at is not null
          or identity.is_anonymous
          or (identity.banned_until is not null and identity.banned_until > now_at)
          then 'member_identity_unavailable'
        when device.user_id is distinct from membership.user_id or not device.active
          then 'push_device_unavailable'
        when not coalesce(preference.push_enabled, policy.default_push_enabled)
          then 'preference_disabled'
        else null
      end as safe_reason
    from public.notification_push_deliveries as delivery
    join public.notification_outbox_jobs as outbox
      on outbox.id = delivery.outbox_job_id
     and outbox.group_id = delivery.group_id
    join public.round_completion_runs as completion
      on completion.id = outbox.aggregate_id
     and completion.group_id = outbox.group_id
    join public.rounds as round_record
      on round_record.id = completion.round_id
     and round_record.group_id = completion.group_id
    join public.memberships as membership
      on membership.id = delivery.recipient_membership_id
     and membership.group_id = delivery.group_id
    left join public.user_profiles as profile
      on profile.user_id = membership.user_id
    left join auth.users as identity
      on identity.id = membership.user_id
    join public.push_devices as device
      on device.device_id = delivery.device_id
    join public.notification_category_policies as policy
      on policy.category = 'results_published'::public.notification_preference_category
    left join public.notification_preferences as preference
      on preference.membership_id = membership.id
     and preference.group_id = membership.group_id
     and preference.category = policy.category
    where delivery.state in ('queued', 'retryable')
      and outbox.event_type = 'results_published'
      and outbox.aggregate_type = 'round_completion'
      and outbox.state in (
        'queued'::public.notification_outbox_job_state,
        'retryable'::public.notification_outbox_job_state,
        'processing'::public.notification_outbox_job_state
      )
      and delivery.next_attempt_at <= now_at
      and outbox.next_attempt_at <= now_at
      and (
        completion.state <> 'official'::public.round_completion_run_state
        or round_record.state <> 'completed'::public.round_state
        or membership.status <> 'active'::public.membership_status
        or profile.user_id is null
        or profile.disabled_at is not null
        or identity.id is null
        or identity.email_confirmed_at is null
        or identity.deleted_at is not null
        or identity.is_anonymous
        or (identity.banned_until is not null and identity.banned_until > now_at)
        or device.user_id is distinct from membership.user_id
        or not device.active
        or not coalesce(preference.push_enabled, policy.default_push_enabled)
      )
    order by delivery.next_attempt_at, delivery.created_at, delivery.id
    for update of delivery, outbox skip locked
  loop
    update public.notification_push_deliveries as target
    set state = 'cancelled'::public.notification_delivery_state,
        failure_reason = invalid_delivery.safe_reason,
        claim_token = null,
        claimed_at = null,
        next_attempt_at = now_at
    where target.id = invalid_delivery.id
      and target.group_id = invalid_delivery.group_id;
    perform app.refresh_results_outbox_state(invalid_delivery.outbox_job_id, invalid_delivery.group_id);
  end loop;

  select
    delivery.id as delivery_id,
    outbox.id as outbox_job_id,
    completion.id as completion_id,
    completion.round_id,
    delivery.group_id,
    round_record.description as round_description,
    completion.completed_at,
    delivery.recipient_user_id,
    delivery.device_id,
    device.expo_push_token,
    delivery.attempts + 1 as attempt_number
  into selected_delivery
  from public.notification_push_deliveries as delivery
  join public.notification_outbox_jobs as outbox
    on outbox.id = delivery.outbox_job_id
   and outbox.group_id = delivery.group_id
  join public.round_completion_runs as completion
    on completion.id = outbox.aggregate_id
   and completion.group_id = outbox.group_id
   and completion.state = 'official'::public.round_completion_run_state
  join public.rounds as round_record
    on round_record.id = completion.round_id
   and round_record.group_id = completion.group_id
   and round_record.state = 'completed'::public.round_state
  join public.memberships as membership
    on membership.id = delivery.recipient_membership_id
   and membership.group_id = delivery.group_id
   and membership.status = 'active'::public.membership_status
  join public.user_profiles as profile
    on profile.user_id = membership.user_id
   and profile.disabled_at is null
  join auth.users as identity
    on identity.id = membership.user_id
   and identity.email_confirmed_at is not null
   and identity.deleted_at is null
   and not identity.is_anonymous
   and (identity.banned_until is null or identity.banned_until <= now_at)
  join public.push_devices as device
    on device.device_id = delivery.device_id
   and device.user_id = membership.user_id
   and device.active
  join public.notification_category_policies as policy
    on policy.category = 'results_published'::public.notification_preference_category
  left join public.notification_preferences as preference
    on preference.membership_id = membership.id
   and preference.group_id = membership.group_id
   and preference.category = policy.category
  where delivery.state in ('queued', 'retryable')
    and delivery.next_attempt_at <= now_at
    and outbox.event_type = 'results_published'
    and outbox.aggregate_type = 'round_completion'
    and outbox.state in (
      'queued'::public.notification_outbox_job_state,
      'retryable'::public.notification_outbox_job_state,
      'processing'::public.notification_outbox_job_state
    )
    and outbox.next_attempt_at <= now_at
    and coalesce(preference.push_enabled, policy.default_push_enabled)
    and (now_at at time zone round_record.group_time_zone)::time >= time '07:00'
    and (now_at at time zone round_record.group_time_zone)::time < time '21:00'
  order by delivery.next_attempt_at, device.device_id, delivery.created_at, delivery.id
  for update of delivery, outbox skip locked
  limit 1;

  if not found then
    return;
  end if;

  update public.notification_push_deliveries as target
  set state = 'sending'::public.notification_delivery_state,
      claim_token = p_claim_token,
      claimed_at = now_at,
      attempts = selected_delivery.attempt_number,
      failure_reason = null
  where target.id = selected_delivery.delivery_id
    and target.group_id = selected_delivery.group_id;

  update public.notification_outbox_jobs as target
  set state = 'processing'::public.notification_outbox_job_state,
      claimed_at = now_at,
      attempts = greatest(target.attempts, selected_delivery.attempt_number),
      safe_error = null,
      finished_at = null
  where target.id = selected_delivery.outbox_job_id
    and target.group_id = selected_delivery.group_id
    and target.state <> 'cancelled'::public.notification_outbox_job_state;

  return query
  select
    selected_delivery.delivery_id::app.entity_id,
    selected_delivery.outbox_job_id::app.entity_id,
    selected_delivery.completion_id::app.entity_id,
    selected_delivery.round_id::app.entity_id,
    selected_delivery.group_id::app.entity_id,
    selected_delivery.round_description::text,
    selected_delivery.completed_at::app.utc_instant,
    selected_delivery.recipient_user_id::app.entity_id,
    selected_delivery.device_id::app.entity_id,
    selected_delivery.expo_push_token::text,
    selected_delivery.attempt_number::integer;
end;
$$;

comment on function public.claim_results_published_push(uuid, timestamptz) is
  'Service-only atomic claim for one completion-result push. Raw Expo tokens are returned only to the trusted provider worker after current eligibility checks.';

revoke all on function public.claim_results_published_push(uuid, timestamptz)
from public, anon, authenticated;
grant execute on function public.claim_results_published_push(uuid, timestamptz)
to service_role;

create function public.record_results_push_send_success(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_provider_message_id text
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
  if p_delivery_id is null or p_claim_token is null then
    raise exception 'delivery_context_required' using errcode = '22004';
  end if;
  if p_provider_message_id is null
    or pg_catalog.btrim(p_provider_message_id) <> p_provider_message_id
    or pg_catalog.length(p_provider_message_id) not between 1 and 255
  then
    raise exception 'provider_message_id_invalid' using errcode = '22023';
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
    and outbox.event_type = 'results_published'
    and outbox.aggregate_type = 'round_completion'
  for update of delivery, outbox;
  if not found then
    raise exception 'delivery_claim_invalid' using errcode = 'P0002';
  end if;

  update public.notification_push_deliveries as target
  set provider_message_id = p_provider_message_id,
      state = 'sent'::public.notification_delivery_state,
      sent_at = now_at,
      claim_token = null,
      claimed_at = null,
      failure_reason = null,
      next_attempt_at = now_at
  where target.id = delivery_record.id
    and target.group_id = delivery_record.group_id;

  perform app.refresh_results_outbox_state(
    delivery_record.outbox_job_id,
    delivery_record.group_id
  );
end;
$$;

revoke all on function public.record_results_push_send_success(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.record_results_push_send_success(uuid, uuid, text)
to service_role;

create function public.record_results_push_send_failure(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_safe_error text,
  p_retry_at timestamptz
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
  if p_delivery_id is null or p_claim_token is null then
    raise exception 'delivery_context_required' using errcode = '22004';
  end if;
  if p_safe_error is null
    or pg_catalog.length(pg_catalog.btrim(p_safe_error)) not between 1 and 200
    or p_safe_error !~ '^[a-z0-9][a-z0-9_.:-]{0,199}$'
  then
    raise exception 'safe_error_invalid' using errcode = '22023';
  end if;
  if p_retry_at is not null and p_retry_at <= now_at then
    raise exception 'retry_at_invalid' using errcode = '22023';
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
    and outbox.event_type = 'results_published'
    and outbox.aggregate_type = 'round_completion'
  for update of delivery, outbox;
  if not found then
    raise exception 'delivery_claim_invalid' using errcode = 'P0002';
  end if;

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
  elsif p_retry_at is null then
    update public.notification_push_deliveries as target
    set state = 'failed_permanent'::public.notification_delivery_state,
        failure_reason = p_safe_error,
        claim_token = null,
        claimed_at = null,
        sent_at = null,
        next_attempt_at = now_at
    where target.id = delivery_record.id
      and target.group_id = delivery_record.group_id;
  else
    update public.notification_push_deliveries as target
    set state = 'retryable'::public.notification_delivery_state,
        failure_reason = p_safe_error,
        claim_token = null,
        claimed_at = null,
        next_attempt_at = p_retry_at
    where target.id = delivery_record.id
      and target.group_id = delivery_record.group_id;
  end if;

  perform app.refresh_results_outbox_state(
    delivery_record.outbox_job_id,
    delivery_record.group_id
  );
end;
$$;

revoke all on function public.record_results_push_send_failure(uuid, uuid, text, timestamptz)
from public, anon, authenticated;
grant execute on function public.record_results_push_send_failure(uuid, uuid, text, timestamptz)
to service_role;
