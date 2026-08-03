-- Phase 04: the administrator-controlled group policy that permits members
-- to add round-scoped guests. Guest participant rows remain a later boundary;
-- this setting is still authoritative and auditable on its own.

alter table public.groups
  add column allow_member_guests boolean not null default false;

comment on column public.groups.allow_member_guests is
  'Whether an active Playing member may add a round-scoped guest; guests never become memberships.';

create function public.read_group_guest_permission(
  p_actor_user_id uuid
)
returns table (
  group_id app.entity_id,
  allow_member_guests boolean,
  group_version bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_group_id uuid;
  group_record public.groups%rowtype;
begin
  if p_actor_user_id is null then
    raise exception 'actor_identity_required' using errcode = '22004';
  end if;

  select actor.group_id
  into actor_group_id
  from app.resolve_member_management_actor(p_actor_user_id) as actor
  limit 1;
  if actor_group_id is null then
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

  select group_row.*
  into group_record
  from public.groups as group_row
  where group_row.id = actor_group_id;
  if not found then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  return query
  select group_record.id, group_record.allow_member_guests, group_record.version;
end;
$$;

comment on function public.read_group_guest_permission(uuid) is
  'Service-only actor-derived guest policy read for active coordinators and administrators.';

revoke all on function public.read_group_guest_permission(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.read_group_guest_permission(uuid)
to service_role;

create function public.update_group_guest_permission(
  p_actor_user_id uuid,
  p_allow_member_guests boolean,
  p_expected_group_version bigint,
  p_reason text,
  p_correlation_id uuid,
  p_operation_id uuid
)
returns table (
  updated_group_id app.entity_id,
  updated_allow_member_guests boolean,
  updated_group_version bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_group_id uuid;
  actor_membership public.memberships%rowtype;
  locked_group public.groups%rowtype;
  saved_group public.groups%rowtype;
  prior_event public.audit_events%rowtype;
  normalized_reason text;
  request_payload jsonb;
  request_fingerprint text;
begin
  if p_actor_user_id is null then
    raise exception 'actor_identity_required' using errcode = '22004';
  end if;
  if p_allow_member_guests is null
    or p_expected_group_version is null
    or p_expected_group_version < 1
    or p_correlation_id is null
    or p_operation_id is null
  then
    raise exception 'guest_permission_input_invalid' using errcode = '22023';
  end if;

  normalized_reason := nullif(pg_catalog.btrim(p_reason), '');
  if normalized_reason is null or pg_catalog.length(normalized_reason) > 500 then
    raise exception 'guest_permission_reason_required' using errcode = '22023';
  end if;

  request_payload := pg_catalog.jsonb_build_object(
    'allow_member_guests', p_allow_member_guests,
    'expected_group_version', p_expected_group_version,
    'reason', normalized_reason
  );
  request_fingerprint := app.member_request_fingerprint(
    request_payload,
    p_actor_user_id::text || ':' || p_operation_id::text
  );

  select actor.group_id
  into actor_group_id
  from app.resolve_member_management_actor(p_actor_user_id) as actor
  limit 1;
  if actor_group_id is null then
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

  select group_row.*
  into locked_group
  from public.groups as group_row
  where group_row.id = actor_group_id
  for update;
  if not found then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  select membership.*
  into actor_membership
  from public.memberships as membership
  join public.user_profiles as profile on profile.user_id = membership.user_id
  join auth.users as identity on identity.id = membership.user_id
  where membership.user_id = p_actor_user_id
    and membership.group_id = locked_group.id
    and membership.status = 'active'
    and profile.disabled_at is null
    and identity.email_confirmed_at is not null
    and identity.deleted_at is null
    and not identity.is_anonymous
    and not (coalesce(identity.raw_app_meta_data, '{}'::jsonb) ? 'greenroster_password_recovery')
    and (identity.banned_until is null or identity.banned_until <= pg_catalog.statement_timestamp())
  for update of membership;
  if not found then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  select event.*
  into prior_event
  from public.audit_events as event
  where event.group_id = locked_group.id
    and event.actor_user_id = p_actor_user_id
    and event.action = 'group.guest_permission_updated'
    and event.operation_id = p_operation_id;

  if found then
    if prior_event.after_state ->> 'request_fingerprint' <> request_fingerprint then
      raise exception 'operation_id_reused' using errcode = '23505';
    end if;
    return query
    select
      locked_group.id,
      (prior_event.after_state ->> 'updated_allow_member_guests')::boolean,
      prior_event.target_version;
    return;
  end if;

  if actor_membership.role <> 'administrator' then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;
  if locked_group.version <> p_expected_group_version then
    raise exception 'group_version_changed' using errcode = '40001';
  end if;

  update public.groups
  set allow_member_guests = p_allow_member_guests,
      version = version + 1
  where id = locked_group.id
  returning * into saved_group;

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
    saved_group.id,
    p_actor_user_id,
    'group.guest_permission_updated',
    'group',
    saved_group.id,
    saved_group.version,
    pg_catalog.jsonb_build_object(
      'group_version', locked_group.version,
      'allow_member_guests', locked_group.allow_member_guests
    ),
    pg_catalog.jsonb_build_object(
      'group_version', saved_group.version,
      'updated_allow_member_guests', saved_group.allow_member_guests,
      'request_fingerprint', request_fingerprint
    ),
    'portal',
    p_correlation_id,
    p_operation_id,
    normalized_reason
  );

  return query
  select saved_group.id, saved_group.allow_member_guests, saved_group.version;
end;
$$;

comment on function public.update_group_guest_permission(uuid, boolean, bigint, text, uuid, uuid) is
  'Service-only administrator guest-permission update with actor-derived tenancy, optimistic versioning, audit, and exact replay.';

revoke all on function public.update_group_guest_permission(uuid, boolean, bigint, text, uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.update_group_guest_permission(uuid, boolean, bigint, text, uuid, uuid)
to service_role;
