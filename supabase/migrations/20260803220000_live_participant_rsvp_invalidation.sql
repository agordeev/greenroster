-- Phase 05: coordinator/admin Live RSVP correction after score entry.
--
-- This boundary is deliberately narrower than the member RSVP mutation.  A
-- trusted server may explicitly move one scored Playing participant to Not
-- Playing while the round is Live.  The current score projection is removed
-- in the same transaction, while append-only score revisions remain available
-- as invalidated history.

create function public.set_live_round_participant_not_playing(
  p_actor_user_id uuid,
  p_round_id uuid,
  p_participant_id uuid,
  p_expected_participant_version bigint,
  p_confirmed boolean,
  p_reason text,
  p_source text,
  p_correlation_id uuid,
  p_operation_id uuid
)
returns table (
  round_id app.entity_id,
  group_id app.entity_id,
  participant_id app.entity_id,
  membership_id app.entity_id,
  rsvp_status public.round_rsvp_status,
  version bigint,
  score_invalidated boolean,
  changed_at app.utc_instant
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
  locked_participant public.round_participants%rowtype;
  locked_projection public.participant_score_projections%rowtype;
  saved_participant public.round_participants%rowtype;
  prior_event public.audit_events%rowtype;
  request_payload jsonb;
  request_fingerprint text;
  normalized_reason text;
  normalized_source text;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_actor_user_id is null
    or p_round_id is null
    or p_participant_id is null
  then
    raise exception 'rsvp_context_required' using errcode = '22004';
  end if;
  if p_expected_participant_version is null
    or p_expected_participant_version < 1
  then
    raise exception 'rsvp_version_invalid' using errcode = '22023';
  end if;
  if p_confirmed is distinct from true then
    raise exception 'rsvp_change_confirmation_required' using errcode = '22023';
  end if;
  normalized_reason := nullif(pg_catalog.btrim(p_reason), '');
  if normalized_reason is null or pg_catalog.length(normalized_reason) > 500 then
    raise exception 'rsvp_change_reason_required' using errcode = '22023';
  end if;
  normalized_source := nullif(pg_catalog.btrim(p_source), '');
  if normalized_source is null
    or normalized_source not in ('mobile', 'portal')
  then
    raise exception 'rsvp_source_invalid' using errcode = '22023';
  end if;
  if p_correlation_id is null or p_operation_id is null then
    raise exception 'operation_context_required' using errcode = '22004';
  end if;

  -- Recovery sessions are not application sessions, even when the identity
  -- still has an otherwise active coordinator/admin membership.
  if exists (
    select 1
    from auth.users as identity
    where identity.id = p_actor_user_id
      and coalesce(identity.raw_app_meta_data, '{}'::jsonb)
        ? 'greenroster_password_recovery'
  ) then
    raise exception 'recovery_session_forbidden' using errcode = 'P0003';
  end if;

  -- Resolve the tenant and role from the authenticated identity.  The round
  -- and participant IDs cannot supply tenant context.
  select actor.group_id, actor.membership_id, actor.actor_role
  into actor_group_id, actor_membership_id, actor_role
  from app.resolve_member_management_actor(p_actor_user_id) as actor
  limit 1;
  if actor_group_id is null
    or actor_role not in ('coordinator', 'administrator')
  then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  -- Serialize all state in one tenant before rechecking actor eligibility.
  select group_record.*
  into locked_group
  from public.groups as group_record
  where group_record.id = actor_group_id
  for update;
  if not found then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  v_now := pg_catalog.clock_timestamp();
  if exists (
    select 1
    from auth.users as identity
    where identity.id = p_actor_user_id
      and coalesce(identity.raw_app_meta_data, '{}'::jsonb)
        ? 'greenroster_password_recovery'
  ) then
    raise exception 'recovery_session_forbidden' using errcode = 'P0003';
  end if;

  select membership.role
  into actor_role
  from public.memberships as membership
  join public.user_profiles as profile
    on profile.user_id = membership.user_id
  join auth.users as identity
    on identity.id = membership.user_id
  where membership.id = actor_membership_id
    and membership.group_id = locked_group.id
    and membership.user_id = p_actor_user_id
    and membership.status = 'active'
    and membership.role in ('coordinator', 'administrator')
    and profile.disabled_at is null
    and identity.email_confirmed_at is not null
    and identity.deleted_at is null
    and not identity.is_anonymous
    and not (
      coalesce(identity.raw_app_meta_data, '{}'::jsonb)
      ? 'greenroster_password_recovery'
    )
    and (
      identity.banned_until is null
      or identity.banned_until <= v_now
    )
  for update of membership;
  if not found then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  select round_record.*
  into locked_round
  from public.rounds as round_record
  where round_record.id = p_round_id
    and round_record.group_id = locked_group.id
  for update;
  if not found then
    raise exception 'round_not_found' using errcode = 'P0002';
  end if;

  select participant.*
  into locked_participant
  from public.round_participants as participant
  where participant.id = p_participant_id
    and participant.round_id = locked_round.id
    and participant.group_id = locked_group.id
  for update;
  if not found then
    raise exception 'participant_not_found' using errcode = 'P0002';
  end if;

  request_payload := pg_catalog.jsonb_build_object(
    'round_id', p_round_id,
    'participant_id', p_participant_id,
    'expected_participant_version', p_expected_participant_version,
    'confirmed', p_confirmed,
    'reason', normalized_reason,
    'source', normalized_source
  );
  request_fingerprint := app.member_request_fingerprint(
    request_payload,
    p_actor_user_id::text || ':' || p_operation_id::text
  );

  -- Audit operation IDs are unique per actor/action.  Check the same action
  -- before state validation so an exact retry returns its original receipt
  -- even after the participant is no longer Playing.
  select event.*
  into prior_event
  from public.audit_events as event
  where event.actor_user_id = p_actor_user_id
    and event.action = 'round.participant_rsvp_changed'
    and event.operation_id = p_operation_id;
  if found then
    if prior_event.target_id <> p_participant_id
      or prior_event.after_state ->> 'request_fingerprint'
        is distinct from request_fingerprint
    then
      raise exception 'operation_id_reused' using errcode = '23505';
    end if;
    return query
    select
      (prior_event.after_state ->> 'round_id')::app.entity_id,
      prior_event.group_id,
      (prior_event.after_state ->> 'participant_id')::app.entity_id,
      (prior_event.after_state ->> 'membership_id')::app.entity_id,
      (prior_event.after_state ->> 'rsvp_status')::public.round_rsvp_status,
      (prior_event.after_state ->> 'participant_version')::bigint,
      coalesce((prior_event.after_state ->> 'score_invalidated')::boolean, false),
      (prior_event.after_state ->> 'changed_at')::app.utc_instant;
    return;
  end if;

  if locked_round.state <> 'live' then
    raise exception 'round_state_locked' using errcode = 'P0001';
  end if;
  if locked_participant.rsvp_status <> 'playing' then
    raise exception 'participant_rsvp_not_playing' using errcode = 'P0001';
  end if;
  if locked_participant.version <> p_expected_participant_version then
    raise exception 'participant_version_changed'
      using errcode = '40001';
  end if;

  -- A score projection is required for this correction boundary.  Its row is
  -- the only mutable score state; score_revisions are append-only history.
  select projection.*
  into locked_projection
  from public.participant_score_projections as projection
  where projection.participant_id = locked_participant.id
    and projection.round_id = locked_round.id
    and projection.group_id = locked_group.id
  for update;
  if not found then
    raise exception 'participant_score_missing' using errcode = 'P0001';
  end if;

  update public.round_participants as participant
  set rsvp_status = 'not_playing',
      version = locked_participant.version + 1
  where participant.id = locked_participant.id
    and participant.round_id = locked_round.id
    and participant.group_id = locked_group.id
  returning * into saved_participant;

  delete from public.participant_score_projections as projection
  where projection.participant_id = locked_projection.participant_id
    and projection.round_id = locked_projection.round_id
    and projection.group_id = locked_projection.group_id;

  insert into public.audit_events (
    group_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    target_version,
    before_state,
    after_state,
    source,
    correlation_id,
    operation_id,
    reason
  )
  values (
    saved_participant.group_id,
    p_actor_user_id,
    'round.participant_rsvp_changed',
    'round_participant',
    saved_participant.id,
    saved_participant.version,
    pg_catalog.jsonb_build_object(
      'round_id', saved_participant.round_id,
      'participant_id', saved_participant.id,
      'rsvp_status', locked_participant.rsvp_status,
      'participant_version', locked_participant.version,
      'score_projection_version', locked_projection.version,
      'score_revision_id', locked_projection.last_revision_id,
      'gross_score', locked_projection.gross_score,
      'net_score', locked_projection.net_score,
      'golf_points', locked_projection.golf_points,
      'manual_merit', locked_projection.manual_merit,
      'plus_minus', locked_projection.plus_minus,
      'ranking_value', locked_projection.ranking_value
    ),
    pg_catalog.jsonb_build_object(
      'round_id', saved_participant.round_id,
      'group_id', saved_participant.group_id,
      'participant_id', saved_participant.id,
      'membership_id', saved_participant.membership_id,
      'rsvp_status', saved_participant.rsvp_status,
      'participant_version', saved_participant.version,
      'score_invalidated', true,
      'invalidated_score_projection_version', locked_projection.version,
      'invalidated_score_revision_id', locked_projection.last_revision_id,
      'changed_at', v_now,
      'request_fingerprint', request_fingerprint
    ),
    normalized_source,
    p_correlation_id,
    p_operation_id,
    normalized_reason
  );

  return query
  select
    saved_participant.round_id,
    saved_participant.group_id,
    saved_participant.id,
    saved_participant.membership_id,
    saved_participant.rsvp_status,
    saved_participant.version,
    true,
    v_now::app.utc_instant;
end;
$$;

comment on function public.set_live_round_participant_not_playing(
  uuid, uuid, uuid, bigint, boolean, text, text, uuid, uuid
) is
  'Service-only coordinator/admin Live correction: explicitly moves a scored Playing participant to Not Playing, removes only the current score projection, and retains append-only revisions with an audit record.';

revoke all on function public.set_live_round_participant_not_playing(
  uuid, uuid, uuid, bigint, boolean, text, text, uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.set_live_round_participant_not_playing(
  uuid, uuid, uuid, bigint, boolean, text, text, uuid, uuid
) to service_role;
