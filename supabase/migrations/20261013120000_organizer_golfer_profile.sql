-- Organizer signup created the administrator membership without a golfer
-- profile, so the organizer was listed without a name in the publication
-- review and could not be invited to their own rounds.

-- The publication review read names only from the golfer profile. Fall back
-- to the account profile, the same way the member roster does.
create or replace function public.preview_round_publication(
  p_actor_user_id uuid,
  p_round_id uuid,
  p_excluded_membership_ids uuid[] default '{}'
)
returns table (
  round_id app.entity_id,
  group_id app.entity_id,
  format public.round_format,
  review_version bigint,
  review_fingerprint text,
  membership_id app.entity_id,
  first_name text,
  last_name text,
  email_ready boolean,
  eligibility_state text,
  ineligibility_reason text,
  included boolean,
  projection_ready boolean,
  projected_quota app.quota_value,
  quota_snapshot_source jsonb,
  handicap_snapshot app.handicap_value,
  handicap_snapshot_source public.member_handicap_source,
  handicap_snapshot_as_of date,
  tee_snapshot text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_group_id uuid;
  actor_role public.membership_role;
  draft_round public.rounds%rowtype;
  review_state record;
begin
  if p_actor_user_id is null or p_round_id is null then
    raise exception 'publication_context_required' using errcode = '22004';
  end if;

  select actor.group_id, actor.actor_role
  into actor_group_id, actor_role
  from app.resolve_member_management_actor(p_actor_user_id) as actor
  limit 1;
  if actor_group_id is null or actor_role not in ('coordinator', 'administrator') then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;
  if exists (
    select 1 from auth.users as identity
    where identity.id = p_actor_user_id
      and coalesce(identity.raw_app_meta_data, '{}'::jsonb) ? 'greenroster_password_recovery'
  ) then
    raise exception 'recovery_session_forbidden' using errcode = 'P0003';
  end if;

  select round_record.*
  into draft_round
  from public.rounds as round_record
  where round_record.id = p_round_id
    and round_record.group_id = actor_group_id;
  if not found then
    raise exception 'round_not_found' using errcode = 'P0002';
  end if;
  if draft_round.state <> 'draft' then
    raise exception 'round_state_locked' using errcode = 'P0001';
  end if;

  select state.review_version, state.review_fingerprint
  into review_state
  from app.round_publication_review_state(
    draft_round.id,
    draft_round.group_id,
    p_excluded_membership_ids
  ) as state;

  return query
  with excluded as (
    select distinct value as membership_id
    from pg_catalog.unnest(coalesce(p_excluded_membership_ids, '{}'::uuid[])) as value
  ), latest_handicap as (
    select distinct on (record.membership_id)
      record.membership_id,
      record.handicap,
      record.source,
      record.as_of
    from public.membership_handicap_records as record
    where record.group_id = actor_group_id
    order by record.membership_id, record.as_of desc, record.created_at desc, record.id desc
  ), quota_settings as (
    select settings.version
    from public.group_quota_settings as settings
    where settings.group_id = actor_group_id
  )
  select
    draft_round.id,
    draft_round.group_id,
    draft_round.format,
    review_state.review_version,
    review_state.review_fingerprint,
    membership.id,
    coalesce(profile.first_name, user_profile.first_name),
    coalesce(profile.last_name, user_profile.last_name),
    (
      identity.email is not null
      and identity.email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      and identity.email_confirmed_at is not null
      and identity.deleted_at is null
      and not identity.is_anonymous
      and (identity.banned_until is null or identity.banned_until <= pg_catalog.statement_timestamp())
      and user_profile.disabled_at is null
    ),
    case
      when excluded.membership_id is not null then 'excluded'
      when profile.membership_id is null then 'ineligible'
      when membership.user_id is null
        or identity.email is null
        or identity.email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        or identity.email_confirmed_at is null
        or identity.deleted_at is not null
        or identity.is_anonymous
        or (identity.banned_until is not null and identity.banned_until > pg_catalog.statement_timestamp())
        or user_profile.disabled_at is not null then 'ineligible'
      when draft_round.format is null then 'ineligible'
      when draft_round.format = 'individual_net'
        and not (
          coalesce(projection.projection_ready, false)
          and (select version from quota_settings) is not null
          and projection.settings_version = (select version from quota_settings)
        ) then 'ineligible'
      else 'eligible'
    end,
    case
      when excluded.membership_id is not null then 'explicitly_excluded'
      when profile.membership_id is null then 'profile_missing'
      when membership.user_id is null or identity.email is null
        or identity.email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        or identity.email_confirmed_at is null
        or identity.deleted_at is not null or identity.is_anonymous
        or (identity.banned_until is not null and identity.banned_until > pg_catalog.statement_timestamp())
        or user_profile.disabled_at is not null then 'identity_not_eligible'
      when draft_round.format is null then 'format_required'
      when draft_round.format = 'individual_net'
        and not (
          coalesce(projection.projection_ready, false)
          and (select version from quota_settings) is not null
          and projection.settings_version = (select version from quota_settings)
        ) then 'quota_not_ready'
      else null
    end,
    excluded.membership_id is null
      and profile.membership_id is not null
      and membership.user_id is not null
      and identity.email is not null
      and identity.email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      and identity.email_confirmed_at is not null
      and identity.deleted_at is null
      and not identity.is_anonymous
      and (identity.banned_until is null or identity.banned_until <= pg_catalog.statement_timestamp())
      and user_profile.disabled_at is null
      and draft_round.format is not null
      and (
        draft_round.format <> 'individual_net'
        or (
          coalesce(projection.projection_ready, false)
          and (select version from quota_settings) is not null
          and projection.settings_version = (select version from quota_settings)
        )
      ),
    (
      coalesce(projection.projection_ready, false)
      and (select version from quota_settings) is not null
      and projection.settings_version = (select version from quota_settings)
    ),
    case
      when coalesce(projection.projection_ready, false)
        and (select version from quota_settings) is not null
        and projection.settings_version = (select version from quota_settings)
      then projection.projected_quota::app.quota_value
      else null::app.quota_value
    end,
    case
      when coalesce(projection.projection_ready, false)
        and (select version from quota_settings) is not null
        and projection.settings_version = (select version from quota_settings)
      then projection.projection_source
    end,
    latest_handicap.handicap::app.handicap_value,
    latest_handicap.source,
    latest_handicap.as_of,
    profile.tee_location
  from public.memberships as membership
  left join public.membership_golfer_profiles as profile
    on profile.membership_id = membership.id
   and profile.group_id = membership.group_id
  left join public.user_profiles as user_profile
    on user_profile.user_id = membership.user_id
  left join auth.users as identity on identity.id = membership.user_id
  left join public.membership_quota_projections as projection
    on projection.membership_id = membership.id
   and projection.group_id = membership.group_id
  left join latest_handicap on latest_handicap.membership_id = membership.id
  left join excluded on excluded.membership_id = membership.id
  where membership.group_id = actor_group_id
    and membership.status = 'active'
  order by coalesce(profile.last_name, user_profile.last_name) nulls last,
    coalesce(profile.first_name, user_profile.first_name) nulls last,
    membership.id;
end;
$$;

-- Organizer signup now writes the golfer profile from the names it already
-- collects, inside the same transaction as the group and membership.
create or replace function public.bootstrap_organizer(
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

  insert into public.membership_golfer_profiles (
    membership_id,
    group_id,
    first_name,
    last_name
  )
  values (
    membership_record.id,
    group_record.id,
    profile_record.first_name,
    profile_record.last_name
  );

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

-- Give existing memberships the golfer profile that signup did not write.
insert into public.membership_golfer_profiles (
  membership_id,
  group_id,
  first_name,
  last_name
)
select
  membership.id,
  membership.group_id,
  pg_catalog.btrim(profile.first_name),
  pg_catalog.btrim(profile.last_name)
from public.memberships as membership
join public.user_profiles as profile
  on profile.user_id = membership.user_id
where pg_catalog.length(pg_catalog.btrim(profile.first_name)) between 1 and 100
  and pg_catalog.length(pg_catalog.btrim(profile.last_name)) between 1 and 100
  and not exists (
    select 1
    from public.membership_golfer_profiles as golfer
    where golfer.membership_id = membership.id
  );
