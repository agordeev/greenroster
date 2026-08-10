-- Public signup reads only the current document labels. The documents remain
-- deployment-owned and the organizer bootstrap records the versions inside
-- the same transaction as the group and administrator membership.
create function public.resolve_current_legal_documents()
returns table (
  terms_version text,
  privacy_version text
)
language sql
stable
security definer
set search_path = ''
as $$
  select legal.terms_version, legal.privacy_version
  from app.current_legal_documents as legal
  limit 1;
$$;

comment on function public.resolve_current_legal_documents() is
  'Returns only the deployment-owned legal document versions needed to render public signup.';

revoke all on function public.resolve_current_legal_documents() from public, anon, authenticated;
grant execute on function public.resolve_current_legal_documents() to service_role;

create function public.bootstrap_organizer(
  p_administrator_user_id uuid,
  p_first_name text,
  p_last_name text,
  p_group_name text,
  p_group_time_zone text,
  p_correlation_id uuid,
  p_operation_id uuid
)
returns table (
  created_group_id app.entity_id,
  administrator_membership_id app.entity_id
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  auth_identity auth.users%rowtype;
  group_record public.groups%rowtype;
  membership_record public.memberships%rowtype;
  profile_record public.user_profiles%rowtype;
  legal_record app.current_legal_documents%rowtype;
  prior_group_id uuid;
begin
  if p_administrator_user_id is null
    or p_correlation_id is null
    or p_operation_id is null
  then
    raise exception 'organizer_signup_context_required' using errcode = '22004';
  end if;

  if p_first_name is null or pg_catalog.btrim(p_first_name) = ''
    or p_last_name is null or pg_catalog.btrim(p_last_name) = ''
    or p_group_name is null or pg_catalog.btrim(p_group_name) = ''
    or p_group_time_zone is null
    or not app.is_valid_time_zone(p_group_time_zone)
  then
    raise exception 'organizer_signup_input_invalid' using errcode = '22023';
  end if;

  select *
  into auth_identity
  from auth.users
  where id = p_administrator_user_id
  for update;

  if not found
    or auth_identity.email is null
    or auth_identity.email_confirmed_at is null
    or auth_identity.deleted_at is not null
    or auth_identity.is_anonymous
    or (auth_identity.banned_until is not null and auth_identity.banned_until > pg_catalog.now())
  then
    raise exception 'administrator_identity_unavailable' using errcode = 'P0002';
  end if;

  select event.group_id
  into prior_group_id
  from public.audit_events as event
  where event.actor_user_id = p_administrator_user_id
    and event.action = 'group.organizer_signup'
    and event.operation_id = p_operation_id;

  if found then
    return query
    select prior_group_id::app.entity_id, membership.id
    from public.memberships as membership
    where membership.group_id = prior_group_id
      and membership.user_id = p_administrator_user_id
      and membership.role = 'administrator'
      and membership.status = 'active';
    return;
  end if;

  if exists (
    select 1
    from public.memberships as membership
    where membership.user_id = p_administrator_user_id
  ) then
    raise exception 'identity_already_attached' using errcode = '23505';
  end if;

  select *
  into legal_record
  from app.current_legal_documents
  for share;

  if not found then
    raise exception 'legal_document_versions_unavailable' using errcode = 'P0001';
  end if;

  insert into public.user_profiles (
    user_id,
    display_name,
    first_name,
    last_name,
    accepted_terms_version,
    accepted_terms_at,
    accepted_privacy_version,
    accepted_privacy_at
  )
  values (
    p_administrator_user_id,
    pg_catalog.btrim(p_first_name) || ' ' || pg_catalog.btrim(p_last_name),
    pg_catalog.btrim(p_first_name),
    pg_catalog.btrim(p_last_name),
    legal_record.terms_version,
    pg_catalog.now(),
    legal_record.privacy_version,
    pg_catalog.now()
  )
  on conflict (user_id) do update
  set
    display_name = excluded.display_name,
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    accepted_terms_version = excluded.accepted_terms_version,
    accepted_terms_at = excluded.accepted_terms_at,
    accepted_privacy_version = excluded.accepted_privacy_version,
    accepted_privacy_at = excluded.accepted_privacy_at,
    updated_at = pg_catalog.now()
  returning * into profile_record;

  if profile_record.disabled_at is not null then
    raise exception 'administrator_identity_unavailable' using errcode = 'P0002';
  end if;

  insert into public.groups (name, time_zone)
  values (pg_catalog.btrim(p_group_name), p_group_time_zone)
  returning * into group_record;

  insert into public.memberships (
    group_id,
    user_id,
    role,
    status,
    activated_at
  )
  values (
    group_record.id,
    p_administrator_user_id,
    'administrator',
    'active',
    pg_catalog.now()
  )
  returning * into membership_record;

  insert into public.audit_events (
    group_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    target_version,
    after_state,
    source,
    correlation_id,
    operation_id
  )
  values (
    group_record.id,
    p_administrator_user_id,
    'group.organizer_signup',
    'group',
    group_record.id,
    group_record.version,
    pg_catalog.jsonb_build_object(
      'group_name', group_record.name,
      'group_time_zone', group_record.time_zone,
      'administrator_membership_id', membership_record.id,
      'membership_role', membership_record.role,
      'membership_status', membership_record.status,
      'accepted_terms_version', profile_record.accepted_terms_version,
      'accepted_privacy_version', profile_record.accepted_privacy_version
    ),
    'server',
    p_correlation_id,
    p_operation_id
  );

  return query select group_record.id, membership_record.id;
end;
$$;

comment on function public.bootstrap_organizer(uuid, text, text, text, text, uuid, uuid) is
  'Server-only atomic organizer signup bootstrap. The trusted server supplies the already-authenticated, verified identity; application roles have no EXECUTE privilege.';

revoke all on function public.bootstrap_organizer(uuid, text, text, text, text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.bootstrap_organizer(uuid, text, text, text, text, uuid, uuid)
  to service_role;
