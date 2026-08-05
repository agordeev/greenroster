-- Server-side e-mail preference boundary for optional transactional events.
--
-- The producer remains responsible for tenant-scoped recipient resolution and
-- suppression state.  This final insert boundary is deliberately narrow: it
-- only recognizes the three currently implemented optional e-mail event
-- mappings.  Other preference categories (including reminder categories),
-- mandatory, invitation, and unknown events continue through the existing
-- delivery constraints and lifecycle triggers unchanged.

create function app.apply_optional_email_preference_boundary()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  v_category public.notification_preference_category;
  v_policy public.notification_category_policies%rowtype;
  v_email_enabled boolean;
  v_now timestamptz;
begin
  -- Suppressed and already-terminal rows are intentional provider/lifecycle
  -- states.  Leave those rows untouched so suppression handling remains the
  -- producer's responsibility.
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
    when 'results_published' then 'results_published'::public.notification_preference_category
    else null::public.notification_preference_category
  end
  into v_category
  from public.notification_outbox_jobs as outbox
  where outbox.id = new.outbox_job_id
    and outbox.group_id = new.group_id;

  -- A missing or mismatched parent is left to the existing foreign key.  In
  -- particular, no unscoped event lookup may make a cross-tenant preference
  -- influence this insert.
  if v_category is null then
    return new;
  end if;

  select policy.*
  into v_policy
  from public.notification_category_policies as policy
  where policy.category = v_category
    and not policy.mandatory
    and policy.email_allowed;

  -- Only supported optional policy rows are eligible for this boundary.
  if not found then
    return new;
  end if;

  select coalesce(preference.email_enabled, v_policy.default_email_enabled)
  into v_email_enabled
  from public.memberships as membership
  left join public.notification_preferences as preference
    on preference.membership_id = membership.id
   and preference.group_id = membership.group_id
   and preference.category = v_policy.category
  where membership.id = new.recipient_membership_id
    and membership.group_id = new.group_id
    and membership.status = 'active'::public.membership_status
  -- Preference updates lock this same membership before changing the row.  A
  -- matching lock here serializes queue insertion with a disable operation.
  for update of membership;

  -- An unknown/inactive/mismatched membership remains subject to the existing
  -- delivery boundary (including inactive-member suppression).
  if not found or coalesce(v_email_enabled, v_policy.default_email_enabled) then
    return new;
  end if;

  v_now := pg_catalog.clock_timestamp();

  -- Publication and details-change jobs are recipient-scoped, so no child
  -- remains claimable after this one is skipped.  Results-published uses one
  -- parent for many recipients; its fan-out trigger reconciles the parent
  -- after all children are considered, so never cancel that shared parent.
  if v_category <> 'results_published'::public.notification_preference_category then
    update public.notification_outbox_jobs as outbox
    set state = 'cancelled'::public.notification_outbox_job_state,
        safe_error = 'preference_disabled',
        claimed_at = null,
        finished_at = v_now,
        next_attempt_at = v_now
    where outbox.id = new.outbox_job_id
      and outbox.group_id = new.group_id
      and outbox.state in (
        'queued'::public.notification_outbox_job_state,
        'retryable'::public.notification_outbox_job_state,
        'processing'::public.notification_outbox_job_state
      );
  end if;

  -- Returning NULL from a BEFORE INSERT trigger skips this child row.  The
  -- recipient-scoped parent was cancelled above; shared results parents are
  -- reconciled by their fan-out/refresh path after all children are considered.
  return null;
end;
$$;

comment on function app.apply_optional_email_preference_boundary() is
  'Skips queued optional e-mail deliveries disabled for their same-group recipient membership and cancels recipient-scoped parent jobs.';

revoke all on function app.apply_optional_email_preference_boundary()
from public, anon, authenticated, service_role;

create trigger notification_deliveries_optional_email_preference
before insert on public.notification_deliveries
for each row execute function app.apply_optional_email_preference_boundary();

create function app.cancel_optional_email_deliveries_on_preference_change()
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
  if new.email_enabled then
    return new;
  end if;

  select policy.*
  into policy_record
  from public.notification_category_policies as policy
  where policy.category = new.category
    and not policy.mandatory
    and policy.email_allowed;
  if not found then
    return new;
  end if;

  now_at := pg_catalog.clock_timestamp();
  for delivery_record in
    select
      delivery.id,
      delivery.group_id,
      delivery.outbox_job_id,
      outbox.event_type
    from public.notification_deliveries as delivery
    join public.notification_outbox_jobs as outbox
      on outbox.id = delivery.outbox_job_id
     and outbox.group_id = delivery.group_id
    where delivery.recipient_membership_id = new.membership_id
      and delivery.group_id = new.group_id
      and delivery.channel = 'email'::public.notification_channel
      and delivery.state in (
        'queued'::public.notification_delivery_state,
        'retryable'::public.notification_delivery_state
      )
      and (
        (new.category = 'round_published'::public.notification_preference_category
          and outbox.event_type = 'round.published')
        or (new.category = 'round_details_changed'::public.notification_preference_category
          and outbox.event_type = 'round.details_changed')
        or (new.category = 'results_published'::public.notification_preference_category
          and outbox.event_type = 'results_published')
      )
    for update of delivery, outbox skip locked
  loop
    update public.notification_deliveries as delivery
    set state = 'cancelled'::public.notification_delivery_state,
        failure_reason = 'preference_disabled',
        claim_token = null,
        claimed_at = null,
        next_attempt_at = now_at
    where delivery.id = delivery_record.id
      and delivery.group_id = delivery_record.group_id;

    if delivery_record.event_type = 'results_published' then
      perform app.refresh_results_outbox_state(
        delivery_record.outbox_job_id,
        delivery_record.group_id
      );
    else
      update public.notification_outbox_jobs as outbox
      set state = 'cancelled'::public.notification_outbox_job_state,
          safe_error = 'preference_disabled',
          claimed_at = null,
          finished_at = now_at,
          next_attempt_at = now_at
      where outbox.id = delivery_record.outbox_job_id
        and outbox.group_id = delivery_record.group_id
        and outbox.state in (
          'queued'::public.notification_outbox_job_state,
          'retryable'::public.notification_outbox_job_state,
          'processing'::public.notification_outbox_job_state
        );
    end if;
  end loop;

  return new;
end;
$$;

comment on function app.cancel_optional_email_deliveries_on_preference_change() is
  'Cancels queued optional e-mail deliveries when a same-group member disables that category, preserving shared results parents.';

revoke all on function app.cancel_optional_email_deliveries_on_preference_change()
from public, anon, authenticated, service_role;

create trigger notification_preferences_cancel_optional_email
after insert or update of email_enabled on public.notification_preferences
for each row execute function app.cancel_optional_email_deliveries_on_preference_change();
