create table app.current_legal_documents (
  singleton boolean primary key default true check (singleton),
  terms_version text not null check (pg_catalog.btrim(terms_version) <> ''),
  privacy_version text not null check (pg_catalog.btrim(privacy_version) <> ''),
  configured_at app.utc_instant not null default pg_catalog.now()
);

comment on table app.current_legal_documents is
  'Deployment-owned current legal document versions. No client may nominate an accepted version.';

revoke all on table app.current_legal_documents from public, anon, authenticated;

create function public.resolve_mobile_first_run()
returns table (
  first_name text,
  last_name text,
  current_terms_version text,
  current_privacy_version text,
  accepted_terms_at app.utc_instant,
  accepted_privacy_at app.utc_instant,
  is_complete boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from app.current_legal_documents) then
    raise exception 'legal_document_versions_unavailable' using errcode = 'P0001';
  end if;

  return query
  select
    profile.first_name,
    profile.last_name,
    legal.terms_version,
    legal.privacy_version,
    profile.accepted_terms_at,
    profile.accepted_privacy_at,
    profile.first_name is not null
      and profile.last_name is not null
      and profile.accepted_terms_version = legal.terms_version
      and profile.accepted_privacy_version = legal.privacy_version
      and profile.accepted_terms_at is not null
      and profile.accepted_privacy_at is not null
  from public.user_profiles as profile
  cross join app.current_legal_documents as legal
  where profile.user_id = (select auth.uid())
    and profile.disabled_at is null
    and (select app.active_group_id()) is not null;
end;
$$;

comment on function public.resolve_mobile_first_run() is
  'Returns only the authenticated active member profile and server-configured current legal versions.';

revoke all on function public.resolve_mobile_first_run() from public, anon;
grant execute on function public.resolve_mobile_first_run() to authenticated;

create function public.complete_mobile_first_run(
  p_first_name text,
  p_last_name text,
  p_terms_version text,
  p_privacy_version text,
  p_correlation_id uuid,
  p_operation_id uuid
)
returns table (
  completed_first_name text,
  completed_last_name text,
  accepted_terms_version text,
  accepted_privacy_version text,
  accepted_terms_at app.utc_instant,
  accepted_privacy_at app.utc_instant
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_group_id uuid;
  legal app.current_legal_documents%rowtype;
  profile public.user_profiles%rowtype;
  prior_profile public.user_profiles%rowtype;
begin
  if actor_id is null then
    raise exception 'identity_context_unavailable' using errcode = 'P0002';
  end if;

  if p_correlation_id is null or p_operation_id is null then
    raise exception 'operation_context_required' using errcode = '22004';
  end if;

  if p_first_name is null or pg_catalog.btrim(p_first_name) = ''
    or p_last_name is null or pg_catalog.btrim(p_last_name) = ''
  then
    raise exception 'profile_names_required' using errcode = '22023';
  end if;

  select *
  into prior_profile
  from public.user_profiles
  where user_id = actor_id
    and disabled_at is null
  for update;

  if not found then
    raise exception 'identity_context_unavailable' using errcode = 'P0002';
  end if;

  actor_group_id := (select app.active_group_id());
  if actor_group_id is null then
    raise exception 'identity_context_unavailable' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.audit_events as event
    where event.actor_user_id = actor_id
      and event.action = 'profile.first_run_completed'
      and event.operation_id = p_operation_id
  ) then
    return query
    select
      prior_profile.first_name,
      prior_profile.last_name,
      prior_profile.accepted_terms_version,
      prior_profile.accepted_privacy_version,
      prior_profile.accepted_terms_at,
      prior_profile.accepted_privacy_at;
    return;
  end if;

  select *
  into legal
  from app.current_legal_documents
  for share;

  if not found then
    raise exception 'legal_document_versions_unavailable' using errcode = 'P0001';
  end if;

  if p_terms_version is distinct from legal.terms_version
    or p_privacy_version is distinct from legal.privacy_version
  then
    raise exception 'legal_document_versions_changed' using errcode = '40001';
  end if;

  update public.user_profiles
  set
    first_name = pg_catalog.btrim(p_first_name),
    last_name = pg_catalog.btrim(p_last_name),
    display_name = pg_catalog.btrim(p_first_name) || ' ' || pg_catalog.btrim(p_last_name),
    accepted_terms_version = legal.terms_version,
    accepted_terms_at = pg_catalog.now(),
    accepted_privacy_version = legal.privacy_version,
    accepted_privacy_at = pg_catalog.now()
  where user_id = actor_id
  returning * into profile;

  insert into public.audit_events (
    group_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    before_state,
    after_state,
    source,
    correlation_id,
    operation_id
  )
  values (
    actor_group_id,
    actor_id,
    'profile.first_run_completed',
    'user_profile',
    actor_id,
    pg_catalog.jsonb_build_object(
      'complete',
      prior_profile.first_name is not null
        and prior_profile.last_name is not null
        and prior_profile.accepted_terms_version = legal.terms_version
        and prior_profile.accepted_privacy_version = legal.privacy_version
    ),
    pg_catalog.jsonb_build_object(
      'complete', true,
      'terms_version', legal.terms_version,
      'privacy_version', legal.privacy_version
    ),
    'mobile',
    p_correlation_id,
    p_operation_id
  );

  return query
  select
    profile.first_name,
    profile.last_name,
    profile.accepted_terms_version,
    profile.accepted_privacy_version,
    profile.accepted_terms_at,
    profile.accepted_privacy_at;
end;
$$;

comment on function public.complete_mobile_first_run(text, text, text, text, uuid, uuid) is
  'Atomically records authenticated names, observed-and-current legal versions, server timestamps, and an audit event.';

revoke all on function public.complete_mobile_first_run(text, text, text, text, uuid, uuid)
  from public, anon;
grant execute on function public.complete_mobile_first_run(text, text, text, text, uuid, uuid)
  to authenticated;
