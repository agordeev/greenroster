-- Phase 02: administrator-only group profile editing.
--
-- Group scope is derived from the trusted actor identity.  The groups table
-- remains force-RLS and application roles receive no direct write privilege;
-- this server boundary is the only supported way to change the profile.

create or replace function app.safe_group_activity_state(
  p_action text,
  p_state jsonb
)
returns jsonb
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when p_state is null then null::jsonb
    else
      pg_catalog.jsonb_build_object(
        'kind', 'unknown',
        'summary_available', false,
        'membership_id', null,
        'invitation_id', null,
        'import_job_id', null,
        'group_version', null,
        'membership_version', null,
        'profile_version', null,
        'contact_version', null,
        'version', null,
        'status', null,
        'role', null,
        'dues_paid', null,
        'accepted_at', null,
        'expires_at', null,
        'email_matches', null,
        'inactivated_at', null,
        'handicap_record_id', null,
        'handicap_id', null,
        'handicap', null,
        'source', null,
        'as_of', null,
        'created_at', null,
        'quota', null,
        'projection_version', null,
        'settings_version', null,
        'projection_ready', null,
        'total_rows', null,
        'valid_rows', null,
        'invalid_rows', null,
        'skipped_rows', null,
        'applied_rows', null,
        'revision', null,
        'cancelled_notification_count', null,
        'email_present', null,
        'email_verified', null,
        'complete', null,
        'previous_membership_id', null,
        'replacement_membership_id', null,
        'band_count', null,
        'state', null,
        'changed_fields', null
      ) || case
        when p_action in ('member.created', 'member.updated', 'member.self_profile_updated') then
          pg_catalog.jsonb_build_object(
            'kind', 'member',
            'summary_available', true,
            'membership_id', coalesce(p_state ->> 'membership_id', p_state ->> 'id'),
            'membership_version', nullif(p_state ->> 'membership_version', '')::bigint,
            'profile_version', nullif(p_state ->> 'profile_version', '')::bigint,
            'contact_version', nullif(p_state ->> 'contact_version', '')::bigint,
            'status', coalesce(p_state ->> 'status', p_state ->> 'membership_status'),
            'role', coalesce(p_state ->> 'role', p_state ->> 'membership_role'),
            'dues_paid', case when p_state ? 'dues_paid' then (p_state ->> 'dues_paid')::boolean else null end
          )
        when p_action = 'member.status_changed' then
          pg_catalog.jsonb_build_object(
            'kind', 'member',
            'summary_available', true,
            'membership_id', p_state ->> 'membership_id',
            'membership_version', nullif(p_state ->> 'membership_version', '')::bigint,
            'status', p_state ->> 'status',
            'role', p_state ->> 'role',
            'inactivated_at', case
              when pg_catalog.jsonb_typeof(p_state -> 'inactivated_at') = 'string'
                then p_state ->> 'inactivated_at'
              else null
            end,
            'cancelled_notification_count', nullif(p_state ->> 'cancelled_notification_count', '')::bigint
          )
        when p_action in ('member.handicap_changed') then
          pg_catalog.jsonb_build_object(
            'kind', 'handicap',
            'summary_available', true,
            'membership_id', p_state ->> 'membership_id',
            'membership_version', nullif(p_state ->> 'membership_version', '')::bigint,
            'handicap_record_id', coalesce(p_state ->> 'handicap_record_id', p_state ->> 'current_record_id'),
            'handicap_id', coalesce(p_state ->> 'handicap_id', p_state ->> 'current_handicap_id'),
            'handicap', coalesce(p_state ->> 'handicap', p_state ->> 'current_handicap'),
            'source', coalesce(p_state ->> 'source', p_state ->> 'current_source'),
            'as_of', coalesce(p_state ->> 'as_of', p_state ->> 'current_as_of'),
            'created_at', coalesce(p_state ->> 'created_at', p_state ->> 'current_created_at')
          )
        when p_action = 'member.private_contact_viewed' then
          pg_catalog.jsonb_build_object(
            'kind', 'member',
            'summary_available', true,
            'membership_id', p_state ->> 'membership_id',
            'contact_version', nullif(p_state ->> 'contact_version', '')::bigint
          )
        when p_action = 'membership.role_changed' then
          pg_catalog.jsonb_build_object(
            'kind', 'member',
            'summary_available', true,
            'membership_id', p_state ->> 'membership_id',
            'membership_version', nullif(p_state ->> 'membership_version', '')::bigint,
            'status', p_state ->> 'status',
            'role', p_state ->> 'role'
          )
        when p_action like 'membership.invitation_%' then
          pg_catalog.jsonb_build_object(
            'kind', 'invitation',
            'summary_available', true,
            'membership_id', p_state ->> 'membership_id',
            'invitation_id', coalesce(p_state ->> 'invitation_id', p_state ->> 'fresh_invitation_id'),
            'version', nullif(p_state ->> 'version', '')::bigint,
            'status', p_state ->> 'status',
            'role', p_state ->> 'role',
            'accepted_at', p_state ->> 'accepted_at',
            'expires_at', p_state ->> 'expires_at',
            'email_matches', case when p_state ? 'email_matches' then (p_state ->> 'email_matches')::boolean else null end
          )
        when p_action = 'membership.administrator_transferred' then
          pg_catalog.jsonb_build_object(
            'kind', 'group',
            'summary_available', true,
            'group_version', nullif(p_state ->> 'group_version', '')::bigint,
            'previous_membership_id', p_state -> 'previous_administrator' ->> 'membership_id',
            'replacement_membership_id', p_state -> 'replacement' ->> 'membership_id',
            'role', p_state -> 'replacement' ->> 'role'
          )
        when p_action in ('group.bootstrap') then
          pg_catalog.jsonb_build_object(
            'kind', 'group',
            'summary_available', true,
            'membership_id', p_state ->> 'administrator_membership_id',
            'role', p_state ->> 'membership_role',
            'status', p_state ->> 'membership_status'
          )
        when p_action = 'group.profile_updated' then
          pg_catalog.jsonb_build_object(
            'kind', 'group',
            'summary_available', true,
            'group_version', nullif(p_state ->> 'group_version', '')::bigint,
            'changed_fields', case
              when pg_catalog.jsonb_typeof(p_state -> 'changed_fields') = 'array'
                then p_state -> 'changed_fields'
              else '[]'::jsonb
            end
          )
        when p_action = 'group.quota_rules_configured' then
          pg_catalog.jsonb_build_object(
            'kind', 'group',
            'summary_available', true,
            'version', nullif(p_state ->> 'version', '')::bigint,
            'band_count', case
              when pg_catalog.jsonb_typeof(p_state -> 'bands') = 'array'
                then pg_catalog.jsonb_array_length(p_state -> 'bands')
              else null
            end
          )
        when p_action = 'membership.quota_bootstrap_configured' then
          pg_catalog.jsonb_build_object(
            'kind', 'member',
            'summary_available', true,
            'membership_id', p_state ->> 'membership_id',
            'projection_version', nullif(p_state ->> 'projection_version', '')::bigint,
            'settings_version', nullif(p_state ->> 'settings_version', '')::bigint,
            'projection_ready', case when p_state ? 'projection_ready' then (p_state ->> 'projection_ready')::boolean else null end,
            'quota', p_state ->> 'projected_quota'
          )
        when p_action like 'member_csv_import.%' then
          pg_catalog.jsonb_build_object(
            'kind', 'import',
            'summary_available', true,
            'import_job_id', p_state ->> 'import_job_id',
            'state', p_state ->> 'state',
            'total_rows', nullif(p_state ->> 'total_rows', '')::bigint,
            'valid_rows', nullif(p_state ->> 'valid_rows', '')::bigint,
            'invalid_rows', nullif(p_state ->> 'invalid_rows', '')::bigint,
            'skipped_rows', nullif(p_state ->> 'skipped_rows', '')::bigint,
            'applied_rows', nullif(p_state ->> 'applied_rows', '')::bigint,
            'revision', nullif(p_state ->> 'revision', '')::bigint
          )
        when p_action = 'account.email_changed' then
          pg_catalog.jsonb_build_object(
            'kind', 'security',
            'summary_available', true,
            'email_present', case when p_state ? 'email_present' then (p_state ->> 'email_present')::boolean else null end,
            'email_verified', case when p_state ? 'email_verified' then (p_state ->> 'email_verified')::boolean else null end
          )
        when p_action = 'identity.password_recovered' then
          pg_catalog.jsonb_build_object(
            'kind', 'security',
            'summary_available', true,
            'state', 'recovered'
          )
        when p_action = 'profile.first_run_completed' then
          pg_catalog.jsonb_build_object(
            'kind', 'profile',
            'summary_available', true,
            'complete', case when p_state ? 'complete' then (p_state ->> 'complete')::boolean else null end
          )
        else pg_catalog.jsonb_build_object(
          'kind', 'unknown',
          'summary_available', false
        )
      end
  end;
$$;

comment on function app.safe_group_activity_state(text, jsonb) is
  'Private fixed-shape audit redaction. Only whitelisted operational metadata is returned; raw audit state never crosses the service projection.';

revoke all on function app.safe_group_activity_state(text, jsonb)
from public, anon, authenticated, service_role;

create function public.update_group_profile(
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
  -- Keep the local value as text. PL/pgSQL initializes domain-typed locals
  -- before the body runs, which would validate an empty value; the explicit
  -- validator below still enforces the same app.iana_time_zone contract.
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

  if actor_membership.role <> 'administrator' then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

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
      locked_group.name,
      locked_group.time_zone::text,
      prior_event.target_version;
    return;
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

  -- Deliberately retain only versions and changed-field names. The actual
  -- profile values are returned to the trusted caller, never to activity.
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
  'Server-only administrator group profile update. Tenant and role are actor-derived; optimistic version, reason, correlation, idempotency, audit redaction, and IANA timezone validation commit atomically.';

revoke all on function public.update_group_profile(uuid, text, text, bigint, text, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.update_group_profile(uuid, text, text, bigint, text, uuid, uuid)
to service_role;
