-- Phase 05: explicit, audited Published-to-Live scoring transition.
--
-- This boundary only opens the round.  Score revisions, calculations,
-- realtime fan-out, and scoring notifications arrive in later slices.

create function public.open_round_scoring(
  p_actor_user_id uuid,
  p_round_id uuid,
  p_expected_round_version bigint,
  p_confirmed boolean,
  p_correlation_id uuid,
  p_operation_id uuid
)
returns table (
  round_id app.entity_id,
  group_id app.entity_id,
  state public.round_state,
  version bigint,
  opened_at app.utc_instant
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
  prior_event public.audit_events%rowtype;
  request_payload jsonb;
  request_fingerprint text;
  after_state jsonb;
  opened_at_value timestamptz := pg_catalog.clock_timestamp();
begin
  if p_actor_user_id is null or p_round_id is null then
    raise exception 'scoring_open_context_required' using errcode = '22004';
  end if;
  if p_correlation_id is null or p_operation_id is null then
    raise exception 'operation_context_required' using errcode = '22004';
  end if;
  if p_expected_round_version is null or p_expected_round_version < 1 then
    raise exception 'round_version_invalid' using errcode = '22023';
  end if;
  if p_confirmed is distinct from true then
    raise exception 'scoring_open_confirmation_required' using errcode = '22023';
  end if;

  select actor.group_id, actor.membership_id, actor.actor_role
  into actor_group_id, actor_membership_id, actor_role
  from app.resolve_member_management_actor(p_actor_user_id) as actor
  limit 1;
  if actor_group_id is null or actor_role not in ('coordinator', 'administrator') then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;
  if exists (
    select 1
    from auth.users as identity
    where identity.id = p_actor_user_id
      and coalesce(identity.raw_app_meta_data, '{}'::jsonb) ? 'greenroster_password_recovery'
  ) then
    raise exception 'recovery_session_forbidden' using errcode = 'P0003';
  end if;

  select group_record.*
  into locked_group
  from public.groups as group_record
  where group_record.id = actor_group_id
  for update;
  if not found then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  -- Re-check the actor after the tenant lock.  A concurrent role/status or
  -- identity change must not pass the transition boundary on stale context.
  perform 1
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
    and (identity.banned_until is null or identity.banned_until <= pg_catalog.clock_timestamp())
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

  request_payload := pg_catalog.jsonb_build_object(
    'round_id', p_round_id,
    'expected_round_version', p_expected_round_version,
    'confirmed', p_confirmed
  );
  request_fingerprint := app.member_request_fingerprint(
    request_payload,
    p_actor_user_id::text || ':' || p_operation_id::text
  );

  select event.*
  into prior_event
  from public.audit_events as event
  where event.group_id = locked_group.id
    and event.actor_user_id = p_actor_user_id
    and event.action = 'round.scoring_opened'
    and event.target_id = p_round_id
    and event.operation_id = p_operation_id;
  if found then
    if prior_event.after_state ->> 'request_fingerprint' <> request_fingerprint then
      raise exception 'operation_id_reused' using errcode = '23505';
    end if;
    return query
    select
      (prior_event.after_state ->> 'round_id')::app.entity_id,
      prior_event.group_id,
      (prior_event.after_state ->> 'state')::public.round_state,
      (prior_event.after_state ->> 'version')::bigint,
      (prior_event.after_state ->> 'opened_at')::app.utc_instant;
    return;
  end if;

  if locked_round.state <> 'published' then
    raise exception 'round_state_locked' using errcode = 'P0001';
  end if;
  if locked_round.version <> p_expected_round_version then
    raise exception 'round_version_changed' using errcode = '40001';
  end if;

  update public.rounds as round_record
  set state = 'live',
      version = round_record.version + 1
  where round_record.id = locked_round.id
    and round_record.group_id = locked_round.group_id
  returning * into saved_round;

  after_state := pg_catalog.jsonb_build_object(
    'round_id', saved_round.id,
    'group_id', saved_round.group_id,
    'state', saved_round.state,
    'version', saved_round.version,
    'opened_at', opened_at_value,
    'request_fingerprint', request_fingerprint
  );

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
    operation_id
  )
  values (
    saved_round.group_id,
    p_actor_user_id,
    'round.scoring_opened',
    'round',
    saved_round.id,
    saved_round.version,
    pg_catalog.jsonb_build_object(
      'state', locked_round.state,
      'version', locked_round.version
    ),
    after_state,
    'portal',
    p_correlation_id,
    p_operation_id
  );

  return query
  select saved_round.id,
         saved_round.group_id,
         saved_round.state,
         saved_round.version,
         opened_at_value::app.utc_instant;
end;
$$;

comment on function public.open_round_scoring(uuid, uuid, bigint, boolean, uuid, uuid) is
  'Opens scoring exactly once for a Published round after a confirmed coordinator/administrator action, using optimistic versioning and a redacted audit event.';

revoke all on function public.open_round_scoring(uuid, uuid, bigint, boolean, uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.open_round_scoring(uuid, uuid, bigint, boolean, uuid, uuid)
to service_role;
