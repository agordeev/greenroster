-- Phase 06: audited Reopen and recomputation boundary.
--
-- Reopen only withdraws the current official run and reverses derived current
-- projections.  The immutable completion run, result snapshots, quota
-- history, and score revisions remain available for investigation.  The
-- existing completion RPC can then create a new retained official run from
-- the latest authoritative inputs.

create function public.reopen_completed_round(
  p_actor_user_id uuid,
  p_round_id uuid,
  p_reason text,
  p_expected_round_version bigint,
  p_confirmed boolean,
  p_correlation_id uuid,
  p_operation_id uuid
)
returns table (
  round_id app.entity_id,
  group_id app.entity_id,
  completion_id app.entity_id,
  state public.round_state,
  version bigint,
  reopened_at app.utc_instant,
  reopen_reason text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_group_id uuid;
  actor_membership_id uuid;
  actor_role public.membership_role;
  locked_group public.groups%rowtype;
  locked_round public.rounds%rowtype;
  saved_round public.rounds%rowtype;
  completion_record public.round_completion_runs%rowtype;
  prior_event public.audit_events%rowtype;
  affected_member record;
  quota_projection record;
  current_quota_projection public.membership_quota_projections%rowtype;
  settings_record public.group_quota_settings%rowtype;
  normalized_reason text;
  request_fingerprint text;
  before_state jsonb;
  after_state jsonb;
  reopened_at_value timestamptz := pg_catalog.clock_timestamp();
  projection_version_value bigint;
  affected_member_count bigint := 0;
  generated_merit_count bigint := 0;
begin
  if p_actor_user_id is null or p_round_id is null then
    raise exception 'round_reopen_context_required' using errcode = '22004';
  end if;
  if p_expected_round_version is null or p_expected_round_version < 1 then
    raise exception 'round_version_invalid' using errcode = '22023';
  end if;
  if p_confirmed is distinct from true then
    raise exception 'round_reopen_confirmation_required' using errcode = '22023';
  end if;
  if p_correlation_id is null or p_operation_id is null then
    raise exception 'operation_context_required' using errcode = '22004';
  end if;

  normalized_reason := nullif(pg_catalog.btrim(p_reason), '');
  if normalized_reason is null or pg_catalog.length(normalized_reason) > 500 then
    raise exception 'round_reopen_reason_required' using errcode = '22023';
  end if;

  if exists (
    select 1
    from auth.users as identity
    where identity.id = p_actor_user_id
      and coalesce(identity.raw_app_meta_data, '{}'::jsonb) ? 'greenroster_password_recovery'
  ) then
    raise exception 'recovery_session_forbidden' using errcode = 'P0003';
  end if;

  select actor.group_id, actor.membership_id, actor.actor_role
  into actor_group_id, actor_membership_id, actor_role
  from app.resolve_member_management_actor(p_actor_user_id) as actor
  limit 1;
  if actor_group_id is null or actor_role not in ('coordinator', 'administrator') then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  select group_record.*
  into locked_group
  from public.groups as group_record
  where group_record.id = actor_group_id
  for update;
  if not found then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  perform membership.id
  from public.memberships as membership
  join public.user_profiles as profile on profile.user_id = membership.user_id
  join auth.users as identity on identity.id = membership.user_id
  where membership.id = actor_membership_id
    and membership.group_id = locked_group.id
    and membership.user_id = p_actor_user_id
    and membership.status = 'active'
    and membership.role in ('coordinator', 'administrator')
    and profile.disabled_at is null
    and identity.email_confirmed_at is not null
    and identity.deleted_at is null
    and not identity.is_anonymous
    and not (coalesce(identity.raw_app_meta_data, '{}'::jsonb) ? 'greenroster_password_recovery')
    and (identity.banned_until is null or identity.banned_until <= reopened_at_value)
  for update of membership;
  if not found then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  -- Keep the lock order identical to completion and score-entry mutations:
  -- group -> actor membership -> participants -> score state -> round.
  perform participant.id
  from public.round_participants as participant
  where participant.round_id = p_round_id
    and participant.group_id = locked_group.id
  order by participant.id
  for update;
  perform projection.participant_id
  from public.participant_score_projections as projection
  where projection.round_id = p_round_id
    and projection.group_id = locked_group.id
  order by projection.participant_id
  for update;
  perform revision.id
  from public.score_revisions as revision
  where revision.round_id = p_round_id
    and revision.group_id = locked_group.id
  order by revision.id
  for update;
  perform receipt.participant_id
  from public.round_score_sync_receipts as receipt
  where receipt.round_id = p_round_id
    and receipt.group_id = locked_group.id
  order by receipt.participant_id
  for update;

  select round_record.*
  into locked_round
  from public.rounds as round_record
  where round_record.id = p_round_id
    and round_record.group_id = locked_group.id
  for update;
  if not found then
    raise exception 'round_not_found' using errcode = 'P0002';
  end if;

  request_fingerprint := app.member_request_fingerprint(
    pg_catalog.jsonb_build_object(
      'round_id', p_round_id,
      'reason', normalized_reason,
      'expected_round_version', p_expected_round_version,
      'confirmed', p_confirmed
    ),
    p_actor_user_id::text || ':' || p_operation_id::text
  );

  -- Replay is resolved before the current-state guard.  The target is not
  -- part of this lookup so reusing an operation on another round is rejected
  -- instead of being mistaken for a second successful transition.
  select event.*
  into prior_event
  from public.audit_events as event
  where event.group_id = locked_group.id
    and event.actor_user_id = p_actor_user_id
    and event.action = 'round.reopened'
    and event.operation_id = p_operation_id;
  if found then
    if prior_event.after_state ->> 'request_fingerprint' <> request_fingerprint then
      raise exception 'operation_id_reused' using errcode = '23505';
    end if;
    return query select
      (prior_event.after_state ->> 'round_id')::app.entity_id,
      prior_event.group_id,
      (prior_event.after_state ->> 'completion_id')::app.entity_id,
      (prior_event.after_state ->> 'state')::public.round_state,
      (prior_event.after_state ->> 'version')::bigint,
      (prior_event.after_state ->> 'reopened_at')::app.utc_instant,
      prior_event.after_state ->> 'reopen_reason';
    return;
  end if;

  if locked_round.state <> 'completed'::public.round_state then
    raise exception 'round_state_locked' using errcode = 'P0001';
  end if;
  if locked_round.version <> p_expected_round_version then
    raise exception 'round_version_changed' using errcode = '40001';
  end if;

  select completion.*
  into completion_record
  from public.round_completion_runs as completion
  where completion.round_id = locked_round.id
    and completion.group_id = locked_round.group_id
    and completion.state = 'official'::public.round_completion_run_state
  for update;
  if not found then
    raise exception 'completion_run_missing' using errcode = 'P0002';
  end if;

  select count(*)
  into generated_merit_count
  from public.round_official_results as result
  where result.completion_id = completion_record.id
    and result.round_id = locked_round.id
    and result.group_id = locked_round.group_id
    and result.generated_merit <> 0;

  update public.round_completion_runs as completion
  set state = 'reopened'::public.round_completion_run_state,
      reopened_at = reopened_at_value,
      reopened_by = p_actor_user_id,
      reopen_reason = normalized_reason
  where completion.id = completion_record.id
    and completion.round_id = locked_round.id
    and completion.group_id = locked_round.group_id
  returning * into completion_record;

  -- A withdrawn official result must not remain dispatchable.  Queued and
  -- retryable work is terminalized with the lifecycle transition; an already
  -- sent message is retained as provider history and is never rewritten.
  with cancelled_deliveries as (
    update public.notification_deliveries as delivery
    set state = 'cancelled'::public.notification_delivery_state,
        failure_reason = 'round_reopened',
        next_attempt_at = reopened_at_value
    from public.notification_outbox_jobs as outbox
    where delivery.outbox_job_id = outbox.id
      and delivery.group_id = outbox.group_id
      and outbox.group_id = locked_group.id
      and outbox.event_type = 'results_published'
      and outbox.aggregate_type = 'round_completion'
      and outbox.aggregate_id = completion_record.id
      and delivery.state in ('queued', 'retryable')
    returning delivery.outbox_job_id, delivery.group_id
  )
  update public.notification_outbox_jobs as outbox
  set state = 'cancelled'::public.notification_outbox_job_state,
      safe_error = 'round_reopened',
      claimed_at = null,
      finished_at = reopened_at_value,
      next_attempt_at = reopened_at_value
  where outbox.group_id = locked_group.id
    and outbox.event_type = 'results_published'
    and outbox.aggregate_type = 'round_completion'
    and outbox.aggregate_id = completion_record.id
    and outbox.state in ('queued', 'retryable');

  update public.rounds as round_record
  set state = 'live'::public.round_state,
      version = round_record.version + 1
  where round_record.id = locked_round.id
    and round_record.group_id = locked_round.group_id
  returning * into saved_round;

  select settings.*
  into settings_record
  from public.group_quota_settings as settings
  where settings.group_id = locked_group.id;
  if not found then
    raise exception 'quota_settings_unavailable' using errcode = 'P0002';
  end if;

  -- Quota history is append-only.  Recompute only the memberships affected by
  -- this run from the remaining official history; Method C therefore rebuilds
  -- its chain in completion order without rewriting any historical snapshot.
  for affected_member in
    select distinct affected.membership_id
    from (
      select result.membership_id
      from public.round_official_results as result
      where result.completion_id = completion_record.id
        and result.round_id = locked_round.id
        and result.group_id = locked_round.group_id
        and result.membership_id is not null
      union all
      select history.membership_id
      from public.membership_quota_history as history
      where history.completion_id = completion_record.id
        and history.round_id = locked_round.id
        and history.group_id = locked_round.group_id
    ) as affected
    order by affected.membership_id
  loop
    select projection.*
    into current_quota_projection
    from public.membership_quota_projections as projection
    where projection.membership_id = affected_member.membership_id
      and projection.group_id = locked_group.id
    for update;

    select projection.*
    into quota_projection
    from app.member_quota_projection(
      affected_member.membership_id,
      locked_group.id
    ) as projection;

    projection_version_value := coalesce(current_quota_projection.projection_version, 0) + 1;
    insert into public.membership_quota_projections (
      membership_id, group_id, projection_version, settings_version,
      projection_ready, projected_quota, projection_source, effective_at
    )
    values (
      quota_projection.membership_id,
      locked_group.id,
      projection_version_value,
      settings_record.version,
      quota_projection.projection_ready,
      quota_projection.projected_quota,
      quota_projection.projection_source,
      reopened_at_value
    )
    on conflict (membership_id) do update
    set group_id = excluded.group_id,
        projection_version = excluded.projection_version,
        settings_version = excluded.settings_version,
        projection_ready = excluded.projection_ready,
        projected_quota = excluded.projected_quota,
        projection_source = excluded.projection_source,
        effective_at = excluded.effective_at;

    update public.memberships as membership
    set uses_initial_quota = quota_projection.uses_initial_quota_next
    where membership.id = affected_member.membership_id
      and membership.group_id = locked_group.id;
    affected_member_count := affected_member_count + 1;
  end loop;

  perform app.refresh_group_standings(locked_group.id);

  before_state := pg_catalog.jsonb_build_object(
    'round_id', locked_round.id,
    'group_id', locked_round.group_id,
    'state', locked_round.state,
    'version', locked_round.version,
    'completion_id', completion_record.id
  );
  after_state := pg_catalog.jsonb_build_object(
    'round_id', saved_round.id,
    'group_id', saved_round.group_id,
    'state', saved_round.state,
    'version', saved_round.version,
    'completion_id', completion_record.id,
    'completion_number', completion_record.completion_number,
    'reopened_at', completion_record.reopened_at,
    'reopen_reason', completion_record.reopen_reason,
    'affected_member_count', affected_member_count,
    'generated_merit_count', generated_merit_count,
    'request_fingerprint', request_fingerprint
  );
  insert into public.audit_events (
    group_id, actor_user_id, action, target_type, target_id, target_version,
    before_state, after_state, source, correlation_id, operation_id, reason
  )
  values (
    locked_group.id, p_actor_user_id, 'round.reopened', 'round', saved_round.id,
    saved_round.version, before_state, after_state, 'portal', p_correlation_id,
    p_operation_id, normalized_reason
  );

  return query select
    saved_round.id,
    saved_round.group_id,
    completion_record.id,
    saved_round.state,
    saved_round.version,
    completion_record.reopened_at,
    completion_record.reopen_reason;
end;
$$;

comment on function public.reopen_completed_round(uuid, uuid, text, bigint, boolean, uuid, uuid) is
  'Reopens one completed round atomically, withdraws generated current effects, preserves immutable history, and prepares the round for recompletion.';

revoke all on function public.reopen_completed_round(uuid, uuid, text, bigint, boolean, uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.reopen_completed_round(uuid, uuid, text, bigint, boolean, uuid, uuid)
to service_role;
