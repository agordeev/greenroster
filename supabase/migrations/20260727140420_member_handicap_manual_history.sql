-- Phase 02: actor-authorized manual handicap history.
--
-- Handicap rows are historical observations.  CSV import is one append path;
-- this mutation is the audited portal append path.  No client receives raw
-- table privileges and no operation updates or deletes a prior observation.

create function app.reject_handicap_record_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'handicap_records_append_only'
    using errcode = 'P0001';
end;
$$;

comment on function app.reject_handicap_record_mutation() is
  'Handicap history is append-only; corrections add a new manual observation.';

revoke all on function app.reject_handicap_record_mutation()
from public, anon, authenticated;

create trigger membership_handicap_records_append_only
before update or delete on public.membership_handicap_records
for each row execute function app.reject_handicap_record_mutation();

create function public.set_member_handicap(
  p_actor_user_id uuid,
  p_membership_id uuid,
  p_handicap_id text,
  p_handicap app.handicap_value,
  p_as_of date,
  p_expected_membership_version bigint,
  p_confirmed boolean,
  p_reason text,
  p_correlation_id uuid,
  p_operation_id uuid
)
returns table (
  handicap_record_id app.entity_id,
  changed_membership_id app.entity_id,
  changed_group_id app.entity_id,
  membership_version bigint,
  handicap_id text,
  handicap app.handicap_value,
  source public.member_handicap_source,
  as_of date,
  created_at app.utc_instant
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_group_id uuid;
  actor_membership public.memberships%rowtype;
  target_membership public.memberships%rowtype;
  locked_group public.groups%rowtype;
  prior_handicap public.membership_handicap_records%rowtype;
  saved_handicap public.membership_handicap_records%rowtype;
  prior_event public.audit_events%rowtype;
  normalized_handicap_id text;
  normalized_reason text;
  request_payload jsonb;
  request_fingerprint text;
  before_state jsonb;
  after_state jsonb;
begin
  if p_actor_user_id is null or p_membership_id is null then
    raise exception 'member_handicap_context_required' using errcode = '22004';
  end if;

  if p_handicap is null or p_as_of is null then
    raise exception 'member_handicap_value_required' using errcode = '22004';
  end if;

  if p_expected_membership_version is null or p_expected_membership_version < 1 then
    raise exception 'member_membership_version_invalid' using errcode = '22023';
  end if;

  if p_correlation_id is null or p_operation_id is null then
    raise exception 'operation_context_required' using errcode = '22004';
  end if;

  normalized_handicap_id := nullif(pg_catalog.btrim(p_handicap_id), '');
  if normalized_handicap_id is not null
    and pg_catalog.length(normalized_handicap_id) > 100
  then
    raise exception 'member_handicap_id_invalid' using errcode = '22023';
  end if;

  normalized_reason := nullif(pg_catalog.btrim(p_reason), '');
  if p_confirmed is distinct from true
    or normalized_reason is null
    or pg_catalog.length(normalized_reason) > 500
  then
    raise exception 'member_handicap_confirmation_required' using errcode = '22023';
  end if;

  request_payload := pg_catalog.jsonb_build_object(
    'membership_id', p_membership_id,
    'handicap_id', normalized_handicap_id,
    'handicap', p_handicap::text,
    'as_of', p_as_of,
    'expected_membership_version', p_expected_membership_version,
    'confirmed', p_confirmed,
    'reason', normalized_reason
  );
  request_fingerprint := app.member_request_fingerprint(
    request_payload,
    p_actor_user_id::text || ':' || p_operation_id::text
  );

  -- Resolve the tenant from the verified actor, then serialize member
  -- mutations on the group row before rechecking role and target state.
  select actor.group_id
  into actor_group_id
  from app.resolve_member_management_actor(p_actor_user_id) as actor
  limit 1;
  if actor_group_id is null then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  select group_record.*
  into locked_group
  from public.groups as group_record
  where group_record.id = actor_group_id
  for update;

  select membership.*
  into actor_membership
  from public.memberships as membership
  join public.user_profiles as profile
    on profile.user_id = membership.user_id
  join auth.users as identity
    on identity.id = membership.user_id
  where membership.user_id = p_actor_user_id
    and membership.group_id = locked_group.id
    and membership.status = 'active'
    and membership.role in ('coordinator', 'administrator')
    and profile.disabled_at is null
    and identity.email_confirmed_at is not null
    and identity.deleted_at is null
    and not identity.is_anonymous
    and (identity.banned_until is null or identity.banned_until <= pg_catalog.statement_timestamp())
  for update of membership;
  if not found then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  select membership.*
  into target_membership
  from public.memberships as membership
  where membership.id = p_membership_id
    and membership.group_id = locked_group.id
  for update;
  if not found then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;

  if actor_membership.role = 'coordinator'
    and target_membership.role = 'administrator'
  then
    raise exception 'member_admin_target_forbidden' using errcode = 'P0003';
  end if;

  select event.*
  into prior_event
  from public.audit_events as event
  where event.group_id = locked_group.id
    and event.actor_user_id = p_actor_user_id
    and event.action = 'member.handicap_changed'
    and event.operation_id = p_operation_id;

  if found then
    if (prior_event.after_state ->> 'membership_id')::uuid <> p_membership_id
      or prior_event.after_state ->> 'request_fingerprint' <> request_fingerprint
    then
      raise exception 'operation_id_reused' using errcode = '23505';
    end if;

    return query
    select
      (prior_event.after_state ->> 'handicap_record_id')::app.entity_id,
      (prior_event.after_state ->> 'membership_id')::app.entity_id,
      prior_event.group_id,
      (prior_event.after_state ->> 'membership_version')::bigint,
      prior_event.after_state ->> 'handicap_id',
      (prior_event.after_state ->> 'handicap')::app.handicap_value,
      (prior_event.after_state ->> 'source')::public.member_handicap_source,
      (prior_event.after_state ->> 'as_of')::date,
      (prior_event.after_state ->> 'created_at')::app.utc_instant;
    return;
  end if;

  if target_membership.version <> p_expected_membership_version then
    raise exception 'member_membership_version_changed' using errcode = '40001';
  end if;

  select record.*
  into prior_handicap
  from public.membership_handicap_records as record
  where record.membership_id = target_membership.id
    and record.group_id = target_membership.group_id
  order by record.as_of desc, record.created_at desc, record.id desc
  limit 1;

  before_state := pg_catalog.jsonb_build_object(
    'membership_id', target_membership.id,
    'membership_version', target_membership.version,
    'current_record_id', prior_handicap.id,
    'current_handicap_id', prior_handicap.handicap_id,
    'current_handicap', prior_handicap.handicap::text,
    'current_source', prior_handicap.source,
    'current_as_of', prior_handicap.as_of,
    'current_created_at', prior_handicap.created_at
  );

  insert into public.membership_handicap_records (
    membership_id,
    group_id,
    handicap_id,
    handicap,
    source,
    as_of
  )
  values (
    target_membership.id,
    locked_group.id,
    normalized_handicap_id,
    p_handicap,
    'manual',
    p_as_of
  )
  returning * into saved_handicap;

  update public.memberships as membership
  set version = membership.version + 1
  where membership.id = target_membership.id
    and membership.group_id = target_membership.group_id
  returning * into target_membership;

  after_state := pg_catalog.jsonb_build_object(
    'membership_id', target_membership.id,
    'membership_version', target_membership.version,
    'handicap_record_id', saved_handicap.id,
    'handicap_id', saved_handicap.handicap_id,
    'handicap', saved_handicap.handicap::text,
    'source', saved_handicap.source,
    'as_of', saved_handicap.as_of,
    'created_at', saved_handicap.created_at,
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
    operation_id,
    reason
  )
  values (
    target_membership.group_id,
    p_actor_user_id,
    'member.handicap_changed',
    'membership',
    target_membership.id,
    target_membership.version,
    before_state,
    after_state,
    'portal',
    p_correlation_id,
    p_operation_id,
    normalized_reason
  );

  return query
  select
    saved_handicap.id,
    target_membership.id,
    target_membership.group_id,
    target_membership.version,
    saved_handicap.handicap_id,
    saved_handicap.handicap,
    saved_handicap.source,
    saved_handicap.as_of,
    saved_handicap.created_at;
end;
$$;

comment on function public.set_member_handicap(
  uuid, uuid, text, app.handicap_value, date, bigint, boolean, text, uuid, uuid
) is
  'Service-only coordinator/administrator append of a reasoned manual handicap observation with actor-derived tenant, optimistic membership version, safe audit, and idempotent replay.';

revoke all on function public.set_member_handicap(
  uuid, uuid, text, app.handicap_value, date, bigint, boolean, text, uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.set_member_handicap(
  uuid, uuid, text, app.handicap_value, date, bigint, boolean, text, uuid, uuid
) to service_role;
