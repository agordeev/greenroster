-- Preserve the exact response for a committed operation even if the original
-- administrator is demoted before a retry arrives. Raw response fields remain
-- in the service-only audit row and never enter the safe activity projection.
create or replace function public.update_group_profile(
  p_actor_user_id uuid,
  p_group_name text,
  p_group_time_zone text,
  p_expected_group_version bigint,
  p_reason text,
  p_correlation_id uuid,
  p_operation_id uuid
)
returns table (
  updated_group_id app.entity_id,
  updated_group_name text,
  updated_group_time_zone text,
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
  normalized_name text;
  normalized_time_zone text;
  normalized_reason text;
  request_payload jsonb;
  request_fingerprint text;
  changed_fields jsonb := '[]'::jsonb;
begin
  if p_actor_user_id is null then
    raise exception 'actor_identity_required' using errcode = '22004';
  end if;

  if p_correlation_id is null or p_operation_id is null then
    raise exception 'operation_context_required' using errcode = '22004';
  end if;

  if p_expected_group_version is null or p_expected_group_version < 1 then
    raise exception 'group_profile_input_invalid' using errcode = '22023';
  end if;

  normalized_name := nullif(pg_catalog.btrim(p_group_name), '');
  if normalized_name is null then
    raise exception 'group_profile_name_required' using errcode = '22023';
  end if;

  if p_group_time_zone is null or pg_catalog.btrim(p_group_time_zone) = '' then
    raise exception 'group_profile_time_zone_required' using errcode = '22023';
  end if;
  normalized_time_zone := pg_catalog.btrim(p_group_time_zone);
  if not app.is_valid_time_zone(normalized_time_zone) then
    raise exception 'group_profile_time_zone_invalid' using errcode = '22023';
  end if;

  normalized_reason := nullif(pg_catalog.btrim(p_reason), '');
  if normalized_reason is null then
    raise exception 'group_profile_reason_required' using errcode = '22023';
  end if;
  if pg_catalog.length(normalized_reason) > 500 then
    raise exception 'group_profile_reason_invalid' using errcode = '22023';
  end if;

  request_payload := pg_catalog.jsonb_build_object(
    'group_name', normalized_name,
    'group_time_zone', normalized_time_zone,
    'expected_group_version', p_expected_group_version,
    'reason', normalized_reason
  );
  request_fingerprint := app.member_request_fingerprint(
    request_payload,
    p_actor_user_id::text || ':' || p_operation_id::text
  );

  -- Resolve the tenant from the actor, never from a caller-supplied group id.
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

  select group_record.*
  into locked_group
  from public.groups as group_record
  where group_record.id = actor_group_id
  for update;
  if not found then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  -- Re-check identity and membership after the tenant lock. This closes the
  -- gap where a role, status, or Auth account changes during the request.
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

  -- An exact retry is safe after a role demotion: no new side effect is
  -- possible, and the original committed response is reconstructed verbatim.
  select event.*
  into prior_event
  from public.audit_events as event
  where event.group_id = locked_group.id
    and event.actor_user_id = p_actor_user_id
    and event.action = 'group.profile_updated'
    and event.operation_id = p_operation_id;

  if found then
    if prior_event.after_state ->> 'request_fingerprint' <> request_fingerprint then
      raise exception 'operation_id_reused' using errcode = '23505';
    end if;

    return query
    select
      locked_group.id,
      coalesce(prior_event.after_state ->> 'updated_group_name', locked_group.name),
      coalesce(prior_event.after_state ->> 'updated_group_time_zone', locked_group.time_zone::text),
      prior_event.target_version;
    return;
  end if;

  if actor_membership.role <> 'administrator' then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  if locked_group.version <> p_expected_group_version then
    raise exception 'group_version_changed' using errcode = '40001';
  end if;

  if locked_group.name is distinct from normalized_name then
    changed_fields := changed_fields || '["name"]'::jsonb;
  end if;
  if locked_group.time_zone::text is distinct from normalized_time_zone then
    changed_fields := changed_fields || '["time_zone"]'::jsonb;
  end if;

  update public.groups
  set name = normalized_name,
      time_zone = normalized_time_zone,
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
    'group.profile_updated',
    'group',
    saved_group.id,
    saved_group.version,
    pg_catalog.jsonb_build_object(
      'group_version', locked_group.version
    ),
    pg_catalog.jsonb_build_object(
      'group_version', saved_group.version,
      'updated_group_id', saved_group.id,
      'updated_group_name', saved_group.name,
      'updated_group_time_zone', saved_group.time_zone::text,
      'changed_fields', changed_fields,
      'request_fingerprint', request_fingerprint
    ),
    'portal',
    p_correlation_id,
    p_operation_id,
    normalized_reason
  );

  return query
  select saved_group.id, saved_group.name, saved_group.time_zone::text, saved_group.version;
end;
$$;

comment on function public.update_group_profile(uuid, text, text, bigint, text, uuid, uuid) is
  'Server-only administrator group profile update. Exact retries reconstruct the original response after authorization and tenant checks; raw response fields remain service-only.';

revoke all on function public.update_group_profile(uuid, text, text, bigint, text, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.update_group_profile(uuid, text, text, bigint, text, uuid, uuid)
to service_role;
