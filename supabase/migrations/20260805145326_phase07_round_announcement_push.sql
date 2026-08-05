-- Phase 07: optional push delivery for round publication and announced detail
-- changes.  These events already create one recipient-scoped outbox job per
-- participant for e-mail; this migration adds one push child per active
-- device without widening the recipient scope.

create function app.optional_push_next_attempt(
  p_group_time_zone text,
  p_now timestamptz
)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (p_now at time zone p_group_time_zone)::time >= time '21:00'
      then (
        (((p_now at time zone p_group_time_zone)::date + 1)::timestamp + time '07:00')
        at time zone p_group_time_zone
      )
    when (p_now at time zone p_group_time_zone)::time < time '07:00'
      then (
        ((p_now at time zone p_group_time_zone)::date::timestamp + time '07:00')
        at time zone p_group_time_zone
      )
    else p_now
  end;
$$;

revoke all on function app.optional_push_next_attempt(text, timestamptz)
from public, anon, authenticated, service_role;

create function app.refresh_round_announcement_outbox_state(
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
  has_sent boolean;
  has_cancelled boolean;
  next_retry_at timestamptz;
begin
  if p_outbox_job_id is null or p_group_id is null then
    return;
  end if;

  select
    exists (
      select 1 from public.notification_deliveries as delivery
      where delivery.outbox_job_id = p_outbox_job_id
        and delivery.group_id = p_group_id
        and delivery.state = 'sending'::public.notification_delivery_state
    ) or exists (
      select 1 from public.notification_push_deliveries as delivery
      where delivery.outbox_job_id = p_outbox_job_id
        and delivery.group_id = p_group_id
        and delivery.state = 'sending'::public.notification_delivery_state
    ),
    exists (
      select 1 from public.notification_deliveries as delivery
      where delivery.outbox_job_id = p_outbox_job_id
        and delivery.group_id = p_group_id
        and delivery.state = 'retryable'::public.notification_delivery_state
    ) or exists (
      select 1 from public.notification_push_deliveries as delivery
      where delivery.outbox_job_id = p_outbox_job_id
        and delivery.group_id = p_group_id
        and delivery.state = 'retryable'::public.notification_delivery_state
    ),
    exists (
      select 1 from public.notification_deliveries as delivery
      where delivery.outbox_job_id = p_outbox_job_id
        and delivery.group_id = p_group_id
        and delivery.state = 'queued'::public.notification_delivery_state
    ) or exists (
      select 1 from public.notification_push_deliveries as delivery
      where delivery.outbox_job_id = p_outbox_job_id
        and delivery.group_id = p_group_id
        and delivery.state = 'queued'::public.notification_delivery_state
    ),
    exists (
      select 1 from public.notification_deliveries as delivery
      where delivery.outbox_job_id = p_outbox_job_id
        and delivery.group_id = p_group_id
        and delivery.state = 'failed_permanent'::public.notification_delivery_state
    ) or exists (
      select 1 from public.notification_push_deliveries as delivery
      where delivery.outbox_job_id = p_outbox_job_id
        and delivery.group_id = p_group_id
        and delivery.state = 'failed_permanent'::public.notification_delivery_state
    ),
    exists (
      select 1 from public.notification_deliveries as delivery
      where delivery.outbox_job_id = p_outbox_job_id
        and delivery.group_id = p_group_id
        and delivery.state = 'sent'::public.notification_delivery_state
    ) or exists (
      select 1 from public.notification_push_deliveries as delivery
      where delivery.outbox_job_id = p_outbox_job_id
        and delivery.group_id = p_group_id
        and delivery.state = 'sent'::public.notification_delivery_state
    ),
    exists (
      select 1 from public.notification_deliveries as delivery
      where delivery.outbox_job_id = p_outbox_job_id
        and delivery.group_id = p_group_id
        and delivery.state in (
          'cancelled'::public.notification_delivery_state,
          'suppressed'::public.notification_delivery_state
        )
    ) or exists (
      select 1 from public.notification_push_deliveries as delivery
      where delivery.outbox_job_id = p_outbox_job_id
        and delivery.group_id = p_group_id
        and delivery.state = 'cancelled'::public.notification_delivery_state
    )
  into has_sending, has_retryable, has_queued, has_failed_permanent,
       has_sent, has_cancelled;

  if has_sending then
    -- A sibling preference boundary may have terminalized the parent before
    -- this trigger runs.  An active push child makes that cancellation stale.
    update public.notification_outbox_jobs
    set state = 'processing'::public.notification_outbox_job_state,
        claimed_at = coalesce(claimed_at, now_at),
        finished_at = null,
        next_attempt_at = now_at
    where id = p_outbox_job_id
      and group_id = p_group_id;
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
    ) into next_retry_at;

    update public.notification_outbox_jobs
    set state = case
          when has_retryable then 'retryable'::public.notification_outbox_job_state
          else 'queued'::public.notification_outbox_job_state
        end,
        safe_error = null,
        claimed_at = null,
        finished_at = null,
        next_attempt_at = coalesce(next_retry_at, now_at)
    where id = p_outbox_job_id
      and group_id = p_group_id;
    return;
  end if;

  update public.notification_outbox_jobs
  set state = case
        when has_failed_permanent then 'abandoned'::public.notification_outbox_job_state
        when has_sent then 'succeeded'::public.notification_outbox_job_state
        when has_cancelled then 'cancelled'::public.notification_outbox_job_state
        else 'succeeded'::public.notification_outbox_job_state
      end,
      safe_error = case
        when has_failed_permanent then 'child_delivery_failed'
        when has_cancelled and not has_sent then coalesce(safe_error, 'no_sendable_recipients')
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

revoke all on function app.refresh_round_announcement_outbox_state(uuid, uuid)
from public, anon, authenticated, service_role;

-- The publication and details-edit producers insert their e-mail child after
-- the parent job.  Reconcile a parent completion after generic e-mail RPCs so
-- an enabled push child cannot be hidden by an e-mail-only terminal update.
create function app.reconcile_round_announcement_outbox_after_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The optional e-mail insert boundary may update the parent from inside a
  -- BEFORE INSERT trigger.  That parent update invokes this trigger at depth
  -- two; allow that reconciliation, while the refresh's own corrective
  -- update at depth three is ignored to avoid recursion.
  if pg_catalog.pg_trigger_depth() > 2
    or new.event_type not in ('round.published', 'round.details_changed')
    or new.aggregate_type <> 'round'
  then
    return new;
  end if;

  perform app.refresh_round_announcement_outbox_state(new.id, new.group_id);
  return new;
end;
$$;

revoke all on function app.reconcile_round_announcement_outbox_after_update()
from public, anon, authenticated, service_role;

create trigger notification_outbox_round_announcement_reconcile
after update of state on public.notification_outbox_jobs
for each row execute function app.reconcile_round_announcement_outbox_after_update();

create function app.queue_round_announcement_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  now_at timestamptz := pg_catalog.clock_timestamp();
begin
  if new.event_type not in ('round.published', 'round.details_changed')
    or new.aggregate_type <> 'round'
  then
    return new;
  end if;

  insert into public.notification_push_deliveries (
    group_id,
    outbox_job_id,
    recipient_membership_id,
    recipient_user_id,
    device_id,
    state,
    next_attempt_at
  )
  select
    new.group_id,
    new.id,
    participant.membership_id,
    membership.user_id,
    device.device_id,
    'queued'::public.notification_delivery_state,
    app.optional_push_next_attempt(round_record.group_time_zone::text, now_at)
  from public.rounds as round_record
  join public.round_participants as participant
    on participant.round_id = round_record.id
   and participant.group_id = round_record.group_id
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
  join public.notification_category_policies as policy
    on policy.category = case new.event_type
      when 'round.published' then 'round_published'::public.notification_preference_category
      else 'round_details_changed'::public.notification_preference_category
    end
   and policy.push_allowed
  left join public.notification_preferences as preference
    on preference.membership_id = participant.membership_id
   and preference.group_id = participant.group_id
   and preference.category = policy.category
  join public.push_devices as device
    on device.user_id = membership.user_id
   and device.active
  where round_record.id = new.aggregate_id
    and round_record.group_id = new.group_id
    and (
      (new.event_type = 'round.published'
       and new.idempotency_key = 'round.published:' || round_record.id::text || ':' || participant.membership_id::text)
      or (new.event_type = 'round.details_changed'
       and new.idempotency_key like 'round.details_changed:' || round_record.id::text || ':%:' || participant.membership_id::text)
    )
    and coalesce(preference.push_enabled, policy.default_push_enabled)
  on conflict (outbox_job_id, device_id) do nothing;

  return new;
end;
$$;

revoke all on function app.queue_round_announcement_push()
from public, anon, authenticated, service_role;

create trigger notification_outbox_round_announcement_push
after insert on public.notification_outbox_jobs
for each row execute function app.queue_round_announcement_push();

-- The existing optional e-mail boundary predates the parallel push channel and
-- cancels a recipient-scoped parent when it suppresses the e-mail child.  Run
-- before that boundary: when this same parent already has a sendable push
-- child, skip only the e-mail row and leave the parent claimable for push.
create function app.skip_optional_announcement_email_when_push_exists()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_category public.notification_preference_category;
  v_policy public.notification_category_policies%rowtype;
  v_email_enabled boolean;
begin
  if new.channel <> 'email'::public.notification_channel
    or new.recipient_membership_id is null
    or new.state not in (
      'queued'::public.notification_delivery_state,
      'retryable'::public.notification_delivery_state,
      'sending'::public.notification_delivery_state
    )
  then
    return new;
  end if;

  select case outbox.event_type
    when 'round.published' then 'round_published'::public.notification_preference_category
    when 'round.details_changed' then 'round_details_changed'::public.notification_preference_category
    else null::public.notification_preference_category
  end
  into v_category
  from public.notification_outbox_jobs as outbox
  where outbox.id = new.outbox_job_id
    and outbox.group_id = new.group_id;

  if v_category is null then
    return new;
  end if;

  select policy.*
  into v_policy
  from public.notification_category_policies as policy
  where policy.category = v_category
    and not policy.mandatory
    and policy.email_allowed;
  if not found then
    return new;
  end if;

  select coalesce(preference.email_enabled, v_policy.default_email_enabled)
  into v_email_enabled
  from public.memberships as membership
  left join public.notification_preferences as preference
    on preference.membership_id = membership.id
   and preference.group_id = membership.group_id
   and preference.category = v_category
  where membership.id = new.recipient_membership_id
    and membership.group_id = new.group_id
    and membership.status = 'active'::public.membership_status
  for update of membership;

  if coalesce(v_email_enabled, v_policy.default_email_enabled) then
    return new;
  end if;

  if exists (
    select 1
    from public.notification_push_deliveries as push_delivery
    where push_delivery.outbox_job_id = new.outbox_job_id
      and push_delivery.group_id = new.group_id
      and push_delivery.recipient_membership_id = new.recipient_membership_id
      and push_delivery.state in (
        'queued'::public.notification_delivery_state,
        'retryable'::public.notification_delivery_state,
        'sending'::public.notification_delivery_state
      )
  ) then
    return null;
  end if;

  return new;
end;
$$;

revoke all on function app.skip_optional_announcement_email_when_push_exists()
from public, anon, authenticated, service_role;

create trigger notification_deliveries_announcement_email_preference
before insert on public.notification_deliveries
for each row execute function app.skip_optional_announcement_email_when_push_exists();

-- Preference changes are serialized against the same membership row as the
-- insert boundary.  The e-mail boundary remains in force; this companion
-- boundary prevents a disabled optional push category from being claimable.
create function app.apply_optional_push_preference_boundary()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_category public.notification_preference_category;
  v_policy public.notification_category_policies%rowtype;
  v_push_enabled boolean;
begin
  if new.recipient_membership_id is null
    or new.state not in (
      'queued'::public.notification_delivery_state,
      'retryable'::public.notification_delivery_state,
      'sending'::public.notification_delivery_state
    )
  then
    return new;
  end if;

  select case outbox.event_type
    when 'round.published' then 'round_published'::public.notification_preference_category
    when 'round.details_changed' then 'round_details_changed'::public.notification_preference_category
    else null::public.notification_preference_category
  end
  into v_category
  from public.notification_outbox_jobs as outbox
  where outbox.id = new.outbox_job_id
    and outbox.group_id = new.group_id;

  if v_category is null then
    return new;
  end if;

  select policy.*
  into v_policy
  from public.notification_category_policies as policy
  where policy.category = v_category
    and not policy.mandatory
    and policy.push_allowed;
  if not found then
    return new;
  end if;

  select coalesce(preference.push_enabled, v_policy.default_push_enabled)
  into v_push_enabled
  from public.memberships as membership
  left join public.notification_preferences as preference
    on preference.membership_id = membership.id
   and preference.group_id = membership.group_id
   and preference.category = v_policy.category
  where membership.id = new.recipient_membership_id
    and membership.group_id = new.group_id
    and membership.status = 'active'::public.membership_status
  for update of membership;

  if not found or coalesce(v_push_enabled, v_policy.default_push_enabled) then
    return new;
  end if;

  return null;
end;
$$;

revoke all on function app.apply_optional_push_preference_boundary()
from public, anon, authenticated, service_role;

create trigger notification_push_deliveries_optional_preference
before insert on public.notification_push_deliveries
for each row execute function app.apply_optional_push_preference_boundary();

create function app.cancel_optional_push_deliveries_on_preference_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  policy_record public.notification_category_policies%rowtype;
  delivery_record record;
  now_at timestamptz;
begin
  if new.push_enabled then
    return new;
  end if;

  select policy.* into policy_record
  from public.notification_category_policies as policy
  where policy.category = new.category
    and not policy.mandatory
    and policy.push_allowed;
  if not found then
    return new;
  end if;

  now_at := pg_catalog.clock_timestamp();
  for delivery_record in
    select delivery.id, delivery.group_id, delivery.outbox_job_id
    from public.notification_push_deliveries as delivery
    join public.notification_outbox_jobs as outbox
      on outbox.id = delivery.outbox_job_id
     and outbox.group_id = delivery.group_id
    where delivery.recipient_membership_id = new.membership_id
      and delivery.group_id = new.group_id
      and delivery.state in (
        'queued'::public.notification_delivery_state,
        'retryable'::public.notification_delivery_state
      )
      and (
        (new.category = 'round_published'::public.notification_preference_category
         and outbox.event_type = 'round.published')
        or (new.category = 'round_details_changed'::public.notification_preference_category
         and outbox.event_type = 'round.details_changed')
      )
    for update of delivery, outbox skip locked
  loop
    update public.notification_push_deliveries as delivery
    set state = 'cancelled'::public.notification_delivery_state,
        failure_reason = 'preference_disabled',
        next_attempt_at = now_at
    where delivery.id = delivery_record.id
      and delivery.group_id = delivery_record.group_id;

    perform app.refresh_round_announcement_outbox_state(
      delivery_record.outbox_job_id,
      delivery_record.group_id
    );
  end loop;
  return new;
end;
$$;

revoke all on function app.cancel_optional_push_deliveries_on_preference_change()
from public, anon, authenticated, service_role;

create trigger notification_preferences_cancel_optional_push
after insert or update of push_enabled on public.notification_preferences
for each row execute function app.cancel_optional_push_deliveries_on_preference_change();

-- Generic e-mail preference updates may terminalize the recipient parent while
-- a push child is still queued.  The outbox reconciliation trigger above
-- repairs that state without changing the existing e-mail boundary.

create function public.claim_round_announcement_push(
  p_claim_token uuid,
  p_stale_before timestamptz
)
returns table (
  delivery_id app.entity_id,
  outbox_job_id app.entity_id,
  event_type text,
  round_id app.entity_id,
  group_id app.entity_id,
  round_description text,
  scheduled_at app.utc_instant,
  venue text,
  rsvp_deadline_at app.utc_instant,
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
  stale_delivery record;
  invalid_delivery record;
  quiet_delivery record;
  selected_delivery record;
begin
  if p_claim_token is null then
    raise exception 'delivery_claim_token_required' using errcode = '22004';
  end if;
  if p_stale_before is null or p_stale_before > now_at then
    raise exception 'delivery_stale_boundary_invalid' using errcode = '22023';
  end if;

  for stale_delivery in
    select delivery.id, delivery.group_id, delivery.outbox_job_id,
      outbox.state as outbox_state
    from public.notification_push_deliveries as delivery
    join public.notification_outbox_jobs as outbox
      on outbox.id = delivery.outbox_job_id
     and outbox.group_id = delivery.group_id
    where delivery.state = 'sending'::public.notification_delivery_state
      and delivery.claimed_at <= p_stale_before
      and outbox.event_type in ('round.published', 'round.details_changed')
      and outbox.aggregate_type = 'round'
    for update of delivery, outbox skip locked
  loop
    update public.notification_push_deliveries as target
    set state = case
          when stale_delivery.outbox_state = 'cancelled'::public.notification_outbox_job_state
            then 'cancelled'::public.notification_delivery_state
          else 'retryable'::public.notification_delivery_state
        end,
        failure_reason = case
          when stale_delivery.outbox_state = 'cancelled'::public.notification_outbox_job_state
            then 'parent_cancelled'
          else 'claim_expired'
        end,
        claim_token = null,
        claimed_at = null,
        next_attempt_at = now_at
    where target.id = stale_delivery.id
      and target.group_id = stale_delivery.group_id;
    perform app.refresh_round_announcement_outbox_state(
      stale_delivery.outbox_job_id, stale_delivery.group_id
    );
  end loop;

  for invalid_delivery in
    select
      delivery.id,
      delivery.group_id,
      delivery.outbox_job_id,
      case
        when membership.status <> 'active' then 'member_inactive'
        when profile.user_id is null or profile.disabled_at is not null then 'member_profile_unavailable'
        when identity.id is null
          or identity.email_confirmed_at is null
          or identity.deleted_at is not null
          or identity.is_anonymous
          or (identity.banned_until is not null and identity.banned_until > now_at)
          then 'member_identity_unavailable'
        when device.active is not true then 'push_device_unavailable'
        when not coalesce(preference.push_enabled, policy.default_push_enabled) then 'preference_disabled'
        when outbox.event_type = 'round.details_changed'
          and round_record.state <> 'published'::public.round_state then 'round_state_locked'
        else null
      end as safe_reason
    from public.notification_push_deliveries as delivery
    join public.notification_outbox_jobs as outbox
      on outbox.id = delivery.outbox_job_id
     and outbox.group_id = delivery.group_id
    join public.rounds as round_record
      on round_record.id = outbox.aggregate_id
     and round_record.group_id = outbox.group_id
    join public.memberships as membership
      on membership.id = delivery.recipient_membership_id
     and membership.group_id = delivery.group_id
    left join public.user_profiles as profile
      on profile.user_id = membership.user_id
    left join auth.users as identity
      on identity.id = membership.user_id
    left join public.push_devices as device
      on device.device_id = delivery.device_id
    left join public.notification_category_policies as policy
      on policy.category = case outbox.event_type
        when 'round.published' then 'round_published'::public.notification_preference_category
        else 'round_details_changed'::public.notification_preference_category
      end
    left join public.notification_preferences as preference
      on preference.membership_id = membership.id
     and preference.group_id = membership.group_id
     and preference.category = policy.category
    where delivery.state in (
        'queued'::public.notification_delivery_state,
        'retryable'::public.notification_delivery_state
      )
      and outbox.event_type in ('round.published', 'round.details_changed')
      and outbox.aggregate_type = 'round'
      and outbox.state in (
        'queued'::public.notification_outbox_job_state,
        'retryable'::public.notification_outbox_job_state,
        'processing'::public.notification_outbox_job_state
      )
      and (
        membership.status <> 'active'
        or profile.user_id is null
        or profile.disabled_at is not null
        or identity.id is null
        or identity.email_confirmed_at is null
        or identity.deleted_at is not null
        or identity.is_anonymous
        or (identity.banned_until is not null and identity.banned_until > now_at)
        or device.active is not true
        or not coalesce(preference.push_enabled, policy.default_push_enabled)
        or (outbox.event_type = 'round.details_changed'
          and round_record.state <> 'published'::public.round_state)
      )
    order by delivery.next_attempt_at, delivery.created_at, delivery.id
    for update of delivery skip locked
  loop
    update public.notification_push_deliveries as target
    set state = 'cancelled'::public.notification_delivery_state,
        failure_reason = invalid_delivery.safe_reason,
        claim_token = null,
        claimed_at = null,
        next_attempt_at = now_at
    where target.id = invalid_delivery.id
      and target.group_id = invalid_delivery.group_id;
    perform app.refresh_round_announcement_outbox_state(
      invalid_delivery.outbox_job_id, invalid_delivery.group_id
    );
  end loop;

  for quiet_delivery in
    select
      delivery.id,
      delivery.group_id,
      delivery.outbox_job_id,
      app.optional_push_next_attempt(round_record.group_time_zone::text, now_at) as quiet_until
    from public.notification_push_deliveries as delivery
    join public.notification_outbox_jobs as outbox
      on outbox.id = delivery.outbox_job_id
     and outbox.group_id = delivery.group_id
    join public.rounds as round_record
      on round_record.id = outbox.aggregate_id
     and round_record.group_id = outbox.group_id
    where delivery.state in (
        'queued'::public.notification_delivery_state,
        'retryable'::public.notification_delivery_state
      )
      and delivery.next_attempt_at <= now_at
      and outbox.next_attempt_at <= now_at
      and outbox.event_type in ('round.published', 'round.details_changed')
      and outbox.aggregate_type = 'round'
      and outbox.state in (
        'queued'::public.notification_outbox_job_state,
        'retryable'::public.notification_outbox_job_state,
        'processing'::public.notification_outbox_job_state
      )
      and app.optional_push_next_attempt(round_record.group_time_zone::text, now_at) > now_at
    order by delivery.next_attempt_at, delivery.created_at, delivery.id
    for update of delivery skip locked
  loop
    update public.notification_push_deliveries as target
    set next_attempt_at = quiet_delivery.quiet_until
    where target.id = quiet_delivery.id
      and target.group_id = quiet_delivery.group_id;
    perform app.refresh_round_announcement_outbox_state(
      quiet_delivery.outbox_job_id, quiet_delivery.group_id
    );
  end loop;

  select
    delivery.id as delivery_id,
    outbox.id as outbox_job_id,
    outbox.event_type as event_type,
    round_record.id as round_id,
    delivery.group_id as group_id,
    coalesce(round_record.description, 'Round') as round_description,
    round_record.scheduled_at as scheduled_at,
    round_record.venue as venue,
    round_record.rsvp_deadline_at as rsvp_deadline_at,
    delivery.recipient_user_id as recipient_user_id,
    delivery.device_id as device_id,
    device.expo_push_token as expo_push_token,
    delivery.attempts + 1 as attempt_number
  into selected_delivery
  from public.notification_push_deliveries as delivery
  join public.notification_outbox_jobs as outbox
    on outbox.id = delivery.outbox_job_id
   and outbox.group_id = delivery.group_id
  join public.rounds as round_record
    on round_record.id = outbox.aggregate_id
   and round_record.group_id = outbox.group_id
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
   and device.active
   and device.user_id = delivery.recipient_user_id
  where delivery.state in (
      'queued'::public.notification_delivery_state,
      'retryable'::public.notification_delivery_state
    )
    and delivery.next_attempt_at <= now_at
    and outbox.next_attempt_at <= now_at
    and outbox.event_type in ('round.published', 'round.details_changed')
    and outbox.aggregate_type = 'round'
    and outbox.state in (
      'queued'::public.notification_outbox_job_state,
      'retryable'::public.notification_outbox_job_state,
      'processing'::public.notification_outbox_job_state
    )
    and not (
      outbox.event_type = 'round.details_changed'
      and round_record.state <> 'published'::public.round_state
    )
  order by delivery.next_attempt_at, delivery.created_at, delivery.id
  for update of delivery, outbox skip locked
  limit 1;

  if not found then
    return;
  end if;

  update public.notification_push_deliveries as delivery
  set state = 'sending'::public.notification_delivery_state,
      claim_token = p_claim_token,
      claimed_at = now_at,
  attempts = selected_delivery.attempt_number,
      failure_reason = null
  where delivery.id = selected_delivery.delivery_id
    and delivery.group_id = selected_delivery.group_id;

  update public.notification_outbox_jobs as outbox
  set state = 'processing'::public.notification_outbox_job_state,
      claimed_at = now_at,
      attempts = greatest(outbox.attempts, selected_delivery.attempt_number),
      safe_error = null
  where outbox.id = selected_delivery.outbox_job_id
    and outbox.group_id = selected_delivery.group_id;

  return query
  select
    selected_delivery.delivery_id::app.entity_id,
    selected_delivery.outbox_job_id::app.entity_id,
    selected_delivery.event_type::text,
    selected_delivery.round_id::app.entity_id,
    selected_delivery.group_id::app.entity_id,
    selected_delivery.round_description::text,
    selected_delivery.scheduled_at::app.utc_instant,
    selected_delivery.venue::text,
    selected_delivery.rsvp_deadline_at::app.utc_instant,
    selected_delivery.recipient_user_id::app.entity_id,
    selected_delivery.device_id::app.entity_id,
    selected_delivery.expo_push_token::text,
    selected_delivery.attempt_number::integer;
end;
$$;

revoke all on function public.claim_round_announcement_push(uuid, timestamptz)
from public, anon, authenticated;
grant execute on function public.claim_round_announcement_push(uuid, timestamptz)
to service_role;

create function public.record_round_announcement_push_send_success(
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
  now_at timestamptz := pg_catalog.clock_timestamp();
  delivery_record public.notification_push_deliveries%rowtype;
  provider_id text := nullif(pg_catalog.btrim(p_provider_message_id), '');
begin
  if p_delivery_id is null or p_claim_token is null or provider_id is null
    or pg_catalog.length(provider_id) > 255 then
    raise exception 'delivery_context_invalid' using errcode = '22023';
  end if;

  select delivery.* into delivery_record
  from public.notification_push_deliveries as delivery
  join public.notification_outbox_jobs as outbox
    on outbox.id = delivery.outbox_job_id
   and outbox.group_id = delivery.group_id
  where delivery.id = p_delivery_id
    and delivery.state = 'sending'::public.notification_delivery_state
    and delivery.claim_token = p_claim_token
    and outbox.event_type in ('round.published', 'round.details_changed')
    and outbox.aggregate_type = 'round'
  for update of delivery;
  if not found then
    raise exception 'delivery_claim_invalid' using errcode = 'P0002';
  end if;

  update public.notification_push_deliveries
  set provider_message_id = provider_id,
      state = 'sent'::public.notification_delivery_state,
      sent_at = now_at,
      claim_token = null,
      claimed_at = null,
      failure_reason = null,
      next_attempt_at = now_at
  where id = delivery_record.id
    and group_id = delivery_record.group_id;
  perform app.refresh_round_announcement_outbox_state(
    delivery_record.outbox_job_id, delivery_record.group_id
  );
end;
$$;

revoke all on function public.record_round_announcement_push_send_success(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.record_round_announcement_push_send_success(uuid, uuid, text)
to service_role;

create function public.record_round_announcement_push_send_failure(
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
  now_at timestamptz := pg_catalog.clock_timestamp();
  delivery_record public.notification_push_deliveries%rowtype;
begin
  if p_delivery_id is null or p_claim_token is null
    or p_safe_error is null
    or pg_catalog.length(pg_catalog.btrim(p_safe_error)) not between 1 and 200
    or p_safe_error !~ '^[a-z0-9][a-z0-9_.:-]{0,199}$'
    or (p_retry_at is not null and p_retry_at <= now_at)
  then
    raise exception 'delivery_context_invalid' using errcode = '22023';
  end if;

  select delivery.* into delivery_record
  from public.notification_push_deliveries as delivery
  join public.notification_outbox_jobs as outbox
    on outbox.id = delivery.outbox_job_id
   and outbox.group_id = delivery.group_id
  where delivery.id = p_delivery_id
    and delivery.state = 'sending'::public.notification_delivery_state
    and delivery.claim_token = p_claim_token
    and outbox.event_type in ('round.published', 'round.details_changed')
    and outbox.aggregate_type = 'round'
  for update of delivery;
  if not found then
    raise exception 'delivery_claim_invalid' using errcode = 'P0002';
  end if;

  update public.notification_push_deliveries
  set state = case
        when p_retry_at is null then 'failed_permanent'::public.notification_delivery_state
        else 'retryable'::public.notification_delivery_state
      end,
      failure_reason = pg_catalog.btrim(p_safe_error),
      claim_token = null,
      claimed_at = null,
      next_attempt_at = coalesce(p_retry_at, now_at)
  where id = delivery_record.id
    and group_id = delivery_record.group_id;
  perform app.refresh_round_announcement_outbox_state(
    delivery_record.outbox_job_id, delivery_record.group_id
  );
end;
$$;

revoke all on function public.record_round_announcement_push_send_failure(uuid, uuid, text, timestamptz)
from public, anon, authenticated;
grant execute on function public.record_round_announcement_push_send_failure(uuid, uuid, text, timestamptz)
to service_role;

create function public.record_round_announcement_push_invalid_device(
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
  if p_delivery_id is null or p_claim_token is null or p_device_id is null
    or p_group_id is null or p_correlation_id is null or p_operation_id is null then
    raise exception 'delivery_context_required' using errcode = '22004';
  end if;

  select delivery.* into delivery_record
  from public.notification_push_deliveries as delivery
  join public.notification_outbox_jobs as outbox
    on outbox.id = delivery.outbox_job_id
   and outbox.group_id = delivery.group_id
  where delivery.id = p_delivery_id
    and delivery.group_id = p_group_id
    and delivery.device_id = p_device_id
    and delivery.state = 'sending'::public.notification_delivery_state
    and delivery.claim_token = p_claim_token
    and outbox.event_type in ('round.published', 'round.details_changed')
    and outbox.aggregate_type = 'round'
  for update of delivery;
  if not found then
    raise exception 'delivery_claim_invalid' using errcode = 'P0002';
  end if;

  perform public.retire_results_push_device_on_provider_invalid(
    p_device_id, p_group_id, p_correlation_id, p_operation_id
  );

  update public.notification_push_deliveries
  set state = 'failed_permanent'::public.notification_delivery_state,
      failure_reason = 'provider_invalid',
      claim_token = null,
      claimed_at = null,
      next_attempt_at = now_at
  where id = delivery_record.id
    and group_id = delivery_record.group_id;
  perform app.refresh_round_announcement_outbox_state(
    delivery_record.outbox_job_id, delivery_record.group_id
  );
end;
$$;

revoke all on function public.record_round_announcement_push_invalid_device(uuid, uuid, uuid, uuid, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.record_round_announcement_push_invalid_device(uuid, uuid, uuid, uuid, uuid, uuid)
to service_role;
