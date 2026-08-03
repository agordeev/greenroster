-- Phase 06: explicit mobile score synchronization receipts.
--
-- A receipt is a completion-time handshake fact, not an inference from the
-- current projection.  It is only recorded for a current mobile revision.
-- Completion remains a separate boundary and must consume this helper before
-- it can claim that every mobile queue has been synchronized.

create table public.round_score_sync_receipts (
  round_id app.entity_id not null,
  group_id app.entity_id not null,
  participant_id app.entity_id not null,
  score_revision_id app.entity_id not null,
  actor_user_id app.entity_id not null references auth.users (id) on delete restrict,
  receipt_version bigint not null default 1,
  correlation_id uuid not null,
  operation_id uuid not null,
  received_at app.utc_instant not null default pg_catalog.now(),
  primary key (round_id, group_id, participant_id),
  constraint round_score_sync_receipts_round_group_fk
    foreign key (round_id, group_id)
    references public.rounds (id, group_id)
    on delete restrict,
  constraint round_score_sync_receipts_participant_round_group_fk
    foreign key (participant_id, round_id, group_id)
    references public.round_participants (id, round_id, group_id)
    on delete restrict,
  constraint round_score_sync_receipts_revision_group_fk
    foreign key (score_revision_id, group_id)
    references public.score_revisions (id, group_id)
    on delete restrict,
  constraint round_score_sync_receipts_version_positive
    check (receipt_version > 0),
  constraint round_score_sync_receipts_operation_unique
    unique (actor_user_id, operation_id)
);

comment on table public.round_score_sync_receipts is
  'Explicit mobile completion-handshake receipts for one current score revision; absence is a server-visible synchronization blocker.';

create index round_score_sync_receipts_group_round_idx
  on public.round_score_sync_receipts (group_id, round_id, participant_id);

alter table public.round_score_sync_receipts enable row level security;
alter table public.round_score_sync_receipts force row level security;
revoke all on table public.round_score_sync_receipts from public, anon, authenticated, service_role;

create function public.acknowledge_mobile_round_score_sync(
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

  select participant.*
  into target_participant
  from public.round_participants as participant
  where participant.id = p_participant_id
  for update;
  if not found then
    raise exception 'participant_not_found' using errcode = 'P0002';
  end if;

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

  if found then
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
  'Records an authenticated actor-derived completion-handshake receipt only for the participant current mobile score revision.';

revoke all on function public.acknowledge_mobile_round_score_sync(uuid, uuid, uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.acknowledge_mobile_round_score_sync(uuid, uuid, uuid, uuid)
to authenticated;

create function app.round_mobile_sync_readiness(
  p_round_id app.entity_id,
  p_group_id app.entity_id
)
returns table (
  round_id app.entity_id,
  group_id app.entity_id,
  participant_id app.entity_id,
  participant_kind public.round_participant_kind,
  score_revision_id app.entity_id,
  score_source text,
  sync_status text,
  receipt_revision_id app.entity_id,
  receipt_version bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_round_id is null or p_group_id is null then
    raise exception 'round_completion_context_required' using errcode = '22004';
  end if;
  if not exists (
    select 1 from public.rounds as round_record
    where round_record.id = p_round_id and round_record.group_id = p_group_id
  ) then
    raise exception 'round_not_found' using errcode = 'P0002';
  end if;

  return query
  select
    participant.round_id,
    participant.group_id,
    participant.id,
    participant.participant_kind,
    projection.last_revision_id,
    revision.source,
    case
      when projection.last_revision_id is null then 'server_score_missing'
      when revision.source = 'portal' then 'server_confirmed'
      when receipt.score_revision_id = projection.last_revision_id then 'mobile_confirmed'
      else 'mobile_receipt_missing'
    end,
    receipt.score_revision_id,
    receipt.receipt_version
  from public.round_participants as participant
  left join public.participant_score_projections as projection
    on projection.participant_id = participant.id
   and projection.round_id = participant.round_id
   and projection.group_id = participant.group_id
  left join public.score_revisions as revision
    on revision.id = projection.last_revision_id
   and revision.round_id = participant.round_id
   and revision.group_id = participant.group_id
   and revision.participant_id = participant.id
  left join public.round_score_sync_receipts as receipt
    on receipt.round_id = participant.round_id
   and receipt.group_id = participant.group_id
   and receipt.participant_id = participant.id
  where participant.round_id = p_round_id
    and participant.group_id = p_group_id
    and participant.rsvp_status = 'playing'::public.round_rsvp_status
  order by participant.id;
end;
$$;

comment on function app.round_mobile_sync_readiness(app.entity_id, app.entity_id) is
  'Private server-side view of current score revisions and explicit mobile receipts; portal revisions are server-confirmed.';

revoke all on function app.round_mobile_sync_readiness(app.entity_id, app.entity_id)
from public, anon, authenticated, service_role;
grant usage on schema app to service_role;
grant execute on function app.round_mobile_sync_readiness(app.entity_id, app.entity_id)
to service_role;
