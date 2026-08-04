-- Phase 06: recipient-scoped results notification fan-out.
--
-- Completion creates one durable results-published outbox event.  This
-- boundary expands that event into one e-mail delivery per eligible member
-- and one push delivery per active device.  Guests never receive a product
-- notification and raw push tokens remain in push_devices only.

create table public.notification_push_deliveries (
  id app.entity_id primary key default extensions.gen_random_uuid(),
  group_id app.entity_id not null,
  outbox_job_id app.entity_id not null,
  recipient_membership_id app.entity_id not null,
  recipient_user_id app.entity_id not null references auth.users (id) on delete restrict,
  device_id app.entity_id not null references public.push_devices (device_id) on delete restrict,
  provider_message_id text,
  state public.notification_delivery_state not null default 'queued',
  attempts integer not null default 0,
  failure_reason text,
  next_attempt_at app.utc_instant not null default pg_catalog.now(),
  sent_at app.utc_instant,
  claim_token uuid,
  claimed_at app.utc_instant,
  created_at app.utc_instant not null default pg_catalog.now(),
  updated_at app.utc_instant not null default pg_catalog.now(),
  constraint notification_push_deliveries_id_group_unique unique (id, group_id),
  constraint notification_push_deliveries_outbox_group_fk
    foreign key (outbox_job_id, group_id)
    references public.notification_outbox_jobs (id, group_id)
    on delete restrict,
  constraint notification_push_deliveries_membership_group_fk
    foreign key (recipient_membership_id, group_id)
    references public.memberships (id, group_id)
    on delete restrict,
  constraint notification_push_deliveries_attempts_nonnegative check (attempts >= 0),
  constraint notification_push_deliveries_failure_reason_bounded check (
    failure_reason is null or pg_catalog.length(failure_reason) <= 2000
  ),
  constraint notification_push_deliveries_sent_state_consistent check (
    sent_at is null or state in ('sent', 'failed_permanent')
  ),
  constraint notification_push_deliveries_claim_consistent check (
    (state = 'sending' and claim_token is not null and claimed_at is not null)
    or (state <> 'sending' and claim_token is null and claimed_at is null)
  ),
  constraint notification_push_deliveries_provider_message_id_bounded check (
    provider_message_id is null
    or (
      pg_catalog.btrim(provider_message_id) = provider_message_id
      and pg_catalog.length(provider_message_id) between 1 and 255
    )
  )
);

create unique index notification_push_deliveries_event_device_idx
on public.notification_push_deliveries (outbox_job_id, device_id);

create unique index notification_push_deliveries_provider_message_id_idx
on public.notification_push_deliveries (provider_message_id)
where provider_message_id is not null;

create unique index notification_push_deliveries_claim_token_idx
on public.notification_push_deliveries (claim_token)
where claim_token is not null;

create index notification_push_deliveries_claim_idx
on public.notification_push_deliveries (state, next_attempt_at, created_at);

create index notification_push_deliveries_group_created_idx
on public.notification_push_deliveries (group_id, created_at desc);

create trigger notification_push_deliveries_immutable_id
before update of id on public.notification_push_deliveries
for each row execute function app.reject_id_change('id');

create trigger notification_push_deliveries_immutable_group
before update of group_id on public.notification_push_deliveries
for each row execute function app.reject_id_change('group_id');

create trigger notification_push_deliveries_immutable_membership
before update of recipient_membership_id on public.notification_push_deliveries
for each row execute function app.reject_id_change('recipient_membership_id');

create trigger notification_push_deliveries_immutable_user
before update of recipient_user_id on public.notification_push_deliveries
for each row execute function app.reject_id_change('recipient_user_id');

create trigger notification_push_deliveries_immutable_device
before update of device_id on public.notification_push_deliveries
for each row execute function app.reject_id_change('device_id');

create trigger notification_push_deliveries_set_updated_at
before update on public.notification_push_deliveries
for each row execute function app.set_updated_at();

create function app.validate_results_push_delivery()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  device_user_id uuid;
  device_is_active boolean;
begin
  select device.user_id
       , device.active
  into device_user_id
      , device_is_active
  from public.push_devices as device
  where device.device_id = new.device_id;

  if (tg_op = 'INSERT'
      or new.device_id is distinct from old.device_id
      or new.recipient_user_id is distinct from old.recipient_user_id
      or new.recipient_membership_id is distinct from old.recipient_membership_id)
    and (
      device_user_id is null
      or device_user_id <> new.recipient_user_id
      or not exists (
        select 1
        from public.memberships as membership
        where membership.id = new.recipient_membership_id
          and membership.group_id = new.group_id
          and membership.user_id = new.recipient_user_id
      )
    )
  then
    raise exception 'push_delivery_recipient_mismatch' using errcode = '23514';
  end if;

  if new.state in ('queued', 'retryable', 'sending')
    and (tg_op = 'INSERT' or old.state is distinct from new.state)
    and exists (
      select 1
      from public.memberships as membership
      where membership.id = new.recipient_membership_id
        and membership.group_id = new.group_id
        and membership.status <> 'active'
    )
  then
    raise exception 'inactive_member_notification_suppressed' using errcode = 'P0001';
  end if;

  if new.state in ('queued', 'retryable', 'sending')
    and (tg_op = 'INSERT' or old.state is distinct from new.state)
    and not coalesce(device_is_active, false)
  then
    raise exception 'push_device_unavailable' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function app.validate_results_push_delivery()
from public, anon, authenticated, service_role;

create trigger notification_push_deliveries_validate
before insert or update on public.notification_push_deliveries
for each row execute function app.validate_results_push_delivery();

alter table public.notification_push_deliveries enable row level security;
alter table public.notification_push_deliveries force row level security;

revoke all on table public.notification_push_deliveries
from public, anon, authenticated;
grant select on table public.notification_push_deliveries to service_role;

create function app.queue_results_published_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  now_at timestamptz := pg_catalog.clock_timestamp();
begin
  if new.event_type <> 'results_published'
    or new.aggregate_type <> 'round_completion'
  then
    return new;
  end if;

  insert into public.notification_deliveries (
    group_id,
    outbox_job_id,
    recipient_membership_id,
    recipient_address,
    recipient_address_normalized,
    channel,
    state,
    failure_reason,
    next_attempt_at
  )
  select
    new.group_id,
    new.id,
    participant.membership_id,
    pg_catalog.btrim(identity.email),
    pg_catalog.lower(pg_catalog.btrim(identity.email)),
    'email'::public.notification_channel,
    case
      when exists (
        select 1
        from public.email_suppressions as suppression
        where suppression.normalized_address = pg_catalog.lower(pg_catalog.btrim(identity.email))
      ) then 'suppressed'::public.notification_delivery_state
      else 'queued'::public.notification_delivery_state
    end,
    case
      when exists (
        select 1
        from public.email_suppressions as suppression
        where suppression.normalized_address = pg_catalog.lower(pg_catalog.btrim(identity.email))
      ) then 'email_suppressed'
      else null
    end,
    now_at
  from public.round_completion_runs as completion
  join public.rounds as round_record
    on round_record.id = completion.round_id
   and round_record.group_id = completion.group_id
  join public.round_participants as participant
    on participant.round_id = completion.round_id
   and participant.group_id = completion.group_id
   and participant.participant_kind = 'member'::public.round_participant_kind
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
   and policy.email_allowed
  left join public.notification_preferences as preference
    on preference.membership_id = participant.membership_id
   and preference.group_id = participant.group_id
   and preference.category = policy.category
  where completion.id = new.aggregate_id
    and completion.group_id = new.group_id
    and completion.state = 'official'::public.round_completion_run_state
    and coalesce(preference.email_enabled, policy.default_email_enabled)
  on conflict do nothing;

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
    case
      when (now_at at time zone round_record.group_time_zone)::time >= time '21:00'
        then (
          (
            ((now_at at time zone round_record.group_time_zone)::date + 1)::timestamp
            + time '07:00'
          ) at time zone round_record.group_time_zone
        )
      when (now_at at time zone round_record.group_time_zone)::time < time '07:00'
        then (
          (
            (now_at at time zone round_record.group_time_zone)::date::timestamp
            + time '07:00'
          ) at time zone round_record.group_time_zone
        )
      else now_at
  end
  from public.round_completion_runs as completion
  join public.rounds as round_record
    on round_record.id = completion.round_id
   and round_record.group_id = completion.group_id
  join public.round_participants as participant
    on participant.round_id = completion.round_id
   and participant.group_id = completion.group_id
   and participant.participant_kind = 'member'::public.round_participant_kind
  join public.memberships as membership
    on membership.id = participant.membership_id
   and membership.group_id = participant.group_id
   and membership.status = 'active'::public.membership_status
   and membership.user_id is not null
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
    on policy.category = 'results_published'::public.notification_preference_category
   and policy.push_allowed
  left join public.notification_preferences as preference
    on preference.membership_id = participant.membership_id
   and preference.group_id = participant.group_id
   and preference.category = policy.category
  join public.push_devices as device
    on device.user_id = membership.user_id
   and device.active
  where completion.id = new.aggregate_id
    and completion.group_id = new.group_id
    and completion.state = 'official'::public.round_completion_run_state
    and coalesce(preference.push_enabled, policy.default_push_enabled)
  on conflict do nothing;

  -- Optional channels may both be disabled, or every address may already be
  -- suppressed.  Do not leave a parent job looking claimable when there is no
  -- sendable child work; retaining the outbox row still gives operators an
  -- immutable event record.
  if not exists (
    select 1
    from public.notification_deliveries as delivery
    where delivery.outbox_job_id = new.id
      and delivery.group_id = new.group_id
      and delivery.state in ('queued', 'retryable', 'sending')
  )
  and not exists (
    select 1
    from public.notification_push_deliveries as delivery
    where delivery.outbox_job_id = new.id
      and delivery.group_id = new.group_id
      and delivery.state in ('queued', 'retryable', 'sending')
  )
  then
    update public.notification_outbox_jobs
    set state = 'succeeded'::public.notification_outbox_job_state,
        safe_error = 'no_sendable_recipients',
        finished_at = now_at,
        next_attempt_at = now_at
    where id = new.id
      and group_id = new.group_id
      and state = 'queued'::public.notification_outbox_job_state;
  end if;

  return new;
end;
$$;

revoke all on function app.queue_results_published_notifications()
from public, anon, authenticated, service_role;

create trigger notification_outbox_results_fanout
after insert on public.notification_outbox_jobs
for each row execute function app.queue_results_published_notifications();

-- Reopen already terminalizes the shared e-mail delivery and parent outbox
-- in its service transaction.  This companion trigger applies the same
-- lifecycle rule to the per-device push children without duplicating the
-- large Reopen function body in a follow-up migration.
create function app.cancel_results_push_deliveries_on_reopen()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.state is distinct from new.state
    and new.state = 'reopened'::public.round_completion_run_state
  then
    update public.notification_push_deliveries as delivery
    set state = 'cancelled'::public.notification_delivery_state,
        failure_reason = 'round_reopened',
        next_attempt_at = new.reopened_at
    from public.notification_outbox_jobs as outbox
    where delivery.outbox_job_id = outbox.id
      and delivery.group_id = outbox.group_id
      and outbox.group_id = new.group_id
      and outbox.event_type = 'results_published'
      and outbox.aggregate_type = 'round_completion'
      and outbox.aggregate_id = new.id
      and delivery.state in ('queued', 'retryable');
  end if;

  return new;
end;
$$;

revoke all on function app.cancel_results_push_deliveries_on_reopen()
from public, anon, authenticated, service_role;

create trigger round_completion_runs_cancel_push_on_reopen
after update of state on public.round_completion_runs
for each row execute function app.cancel_results_push_deliveries_on_reopen();
