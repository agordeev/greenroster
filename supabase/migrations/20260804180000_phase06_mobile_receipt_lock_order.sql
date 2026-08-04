-- Phase 06: normalize the mobile receipt lock order with completion/reopen.
--
-- The receipt is still an authenticated member/coordinator mutation.  Only
-- the lock acquisition order changes: group -> actor membership -> participant
-- -> score projection -> score revision -> receipt -> round.  This prevents a
-- final mobile acknowledgement from deadlocking with a completion or reopen
-- transaction that is serializing the same tenant.

create or replace function public.acknowledge_mobile_round_score_sync(
  p_participant_id uuid,
  p_score_revision_id uuid,
  p_correlation_id uuid,
  p_operation_id uuid
)
returns table (
  round_id app.entity_id,
  group_id app.entity_id,
  participant_id app.entity_id,
  score_revision_id app.entity_id,
  receipt_version bigint,
  received_at app.utc_instant
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_actor_user_id app.entity_id := (select auth.uid());
  actor_membership public.memberships%rowtype;
  target_round public.rounds%rowtype;
  target_participant public.round_participants%rowtype;
  current_projection public.participant_score_projections%rowtype;
  current_revision public.score_revisions%rowtype;
  saved_receipt public.round_score_sync_receipts%rowtype;
  prior_event public.audit_events%rowtype;
  receipt_found boolean;
  next_receipt_version bigint;
  before_state jsonb;
  after_state jsonb;
begin
  if current_actor_user_id is null
    or p_participant_id is null
    or p_score_revision_id is null
    or p_correlation_id is null
    or p_operation_id is null
  then
    raise exception 'mobile_sync_context_required' using errcode = '22004';
  end if;

  select event.*
  into prior_event
  from public.audit_events as event
  where event.actor_user_id = current_actor_user_id
    and event.action = 'round.score_sync_acknowledged'
    and event.operation_id = p_operation_id;
  if found then
    if prior_event.after_state ->> 'participant_id' <> p_participant_id::text
      or prior_event.after_state ->> 'score_revision_id' <> p_score_revision_id::text
    then
      raise exception 'operation_id_reused' using errcode = '23505';
    end if;
    return query
    select
      (prior_event.after_state ->> 'round_id')::app.entity_id,
      prior_event.group_id,
      (prior_event.after_state ->> 'participant_id')::app.entity_id,
      (prior_event.after_state ->> 'score_revision_id')::app.entity_id,
      (prior_event.after_state ->> 'receipt_version')::bigint,
      (prior_event.after_state ->> 'received_at')::app.utc_instant;
    return;
  end if;

  -- Resolve the tenant without locking the participant.  All locks below are
  -- then acquired in the same order used by completion and Reopen.
  select participant.*
  into target_participant
  from public.round_participants as participant
  where participant.id = p_participant_id;
  if not found then
    raise exception 'participant_not_found' using errcode = 'P0002';
  end if;

  perform 1
  from public.groups as group_record
  where group_record.id = target_participant.group_id
  for update;
  if not found then
    raise exception 'participant_not_found' using errcode = 'P0002';
  end if;

  select membership.*
  into actor_membership
  from public.memberships as membership
  join public.user_profiles as profile on profile.user_id = membership.user_id
  join auth.users as identity on identity.id = membership.user_id
  where membership.user_id = current_actor_user_id
    and membership.group_id = target_participant.group_id
    and membership.status = 'active'
    and profile.disabled_at is null
    and identity.email_confirmed_at is not null
    and identity.deleted_at is null
    and not identity.is_anonymous
    and (identity.banned_until is null or identity.banned_until <= pg_catalog.statement_timestamp())
  for update;
  if not found then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  select participant.*
  into target_participant
  from public.round_participants as participant
  where participant.id = p_participant_id
    and participant.group_id = actor_membership.group_id
  for update;
  if not found then
    raise exception 'participant_not_found' using errcode = 'P0002';
  end if;

  if actor_membership.role not in ('coordinator', 'administrator')
    and (
      (target_participant.participant_kind = 'member'::public.round_participant_kind
        and target_participant.membership_id <> actor_membership.id)
      or (target_participant.participant_kind = 'guest'::public.round_participant_kind
        and target_participant.sponsor_membership_id <> actor_membership.id)
    )
  then
    raise exception 'score_actor_not_authorized' using errcode = 'P0003';
  end if;

  select projection.*
  into current_projection
  from public.participant_score_projections as projection
  where projection.participant_id = target_participant.id
    and projection.round_id = target_participant.round_id
    and projection.group_id = target_participant.group_id
  for update;
  if not found or current_projection.last_revision_id is null then
    raise exception 'score_revision_missing' using errcode = 'P0002';
  end if;
  if current_projection.last_revision_id <> p_score_revision_id then
    raise exception 'score_revision_changed' using errcode = '40001';
  end if;

  select revision.*
  into current_revision
  from public.score_revisions as revision
  where revision.id = current_projection.last_revision_id
    and revision.group_id = target_participant.group_id
    and revision.round_id = target_participant.round_id
    and revision.participant_id = target_participant.id
  for update;
  if not found then
    raise exception 'score_revision_missing' using errcode = 'P0002';
  end if;
  if current_revision.source <> 'mobile' then
    raise exception 'mobile_sync_source_invalid' using errcode = '22023';
  end if;

  select receipt.*
  into saved_receipt
  from public.round_score_sync_receipts as receipt
  where receipt.round_id = target_participant.round_id
    and receipt.group_id = target_participant.group_id
    and receipt.participant_id = target_participant.id
  for update;
  receipt_found := found;

  select round_record.*
  into target_round
  from public.rounds as round_record
  where round_record.id = target_participant.round_id
    and round_record.group_id = target_participant.group_id
  for update;
  if not found then
    raise exception 'round_not_found' using errcode = 'P0002';
  end if;
  if target_round.state <> 'live'::public.round_state then
    raise exception 'round_state_locked' using errcode = 'P0001';
  end if;

  if receipt_found then
    next_receipt_version := saved_receipt.receipt_version + 1;
    before_state := pg_catalog.jsonb_build_object(
      'round_id', saved_receipt.round_id,
      'group_id', saved_receipt.group_id,
      'participant_id', saved_receipt.participant_id,
      'score_revision_id', saved_receipt.score_revision_id,
      'receipt_version', saved_receipt.receipt_version,
      'received_at', saved_receipt.received_at
    );
    update public.round_score_sync_receipts as receipt
    set score_revision_id = current_revision.id,
        actor_user_id = current_actor_user_id,
        receipt_version = next_receipt_version,
        correlation_id = p_correlation_id,
        operation_id = p_operation_id,
        received_at = pg_catalog.now()
    where receipt.round_id = saved_receipt.round_id
      and receipt.group_id = saved_receipt.group_id
      and receipt.participant_id = saved_receipt.participant_id
    returning receipt.* into saved_receipt;
  else
    next_receipt_version := 1;
    insert into public.round_score_sync_receipts (
      round_id, group_id, participant_id, score_revision_id, actor_user_id,
      receipt_version, correlation_id, operation_id
    )
    values (
      target_participant.round_id, target_participant.group_id, target_participant.id,
      current_revision.id, current_actor_user_id, next_receipt_version,
      p_correlation_id, p_operation_id
    )
    returning * into saved_receipt;
    before_state := null;
  end if;

  after_state := pg_catalog.jsonb_build_object(
    'round_id', saved_receipt.round_id,
    'group_id', saved_receipt.group_id,
    'participant_id', saved_receipt.participant_id,
    'score_revision_id', saved_receipt.score_revision_id,
    'receipt_version', saved_receipt.receipt_version,
    'received_at', saved_receipt.received_at
  );
  insert into public.audit_events (
    group_id, actor_user_id, action, target_type, target_id, target_version,
    before_state, after_state, source, correlation_id, operation_id
  )
  values (
    saved_receipt.group_id, current_actor_user_id, 'round.score_sync_acknowledged',
    'round_participant', saved_receipt.participant_id, saved_receipt.receipt_version,
    before_state, after_state, 'mobile', p_correlation_id, p_operation_id
  );

  return query
  select
    saved_receipt.round_id,
    saved_receipt.group_id,
    saved_receipt.participant_id,
    saved_receipt.score_revision_id,
    saved_receipt.receipt_version,
    saved_receipt.received_at;
end;
$$;

comment on function public.acknowledge_mobile_round_score_sync(uuid, uuid, uuid, uuid) is
  'Records an authenticated actor-derived completion-handshake receipt only for the participant current mobile score revision using tenant-first lock ordering.';

revoke all on function public.acknowledge_mobile_round_score_sync(uuid, uuid, uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.acknowledge_mobile_round_score_sync(uuid, uuid, uuid, uuid)
to authenticated;
