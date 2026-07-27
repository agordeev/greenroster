-- Phase 02: actor-derived mobile self-profile projection and mutations.
--
-- The Auth identity is the only actor context accepted by these boundaries:
-- tenant and membership are resolved from auth.uid(), while raw membership,
-- profile, contact, and handicap tables remain force-RLS and ungranted.

create function app.resolve_mobile_self_membership()
returns table (
  membership_id app.entity_id,
  group_id app.entity_id,
  user_id app.entity_id,
  role public.membership_role,
  status public.membership_status,
  membership_version bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := (select auth.uid());
begin
  if v_actor_user_id is null then
    raise exception 'identity_context_unavailable' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from auth.users as identity
    where identity.id = v_actor_user_id
      and coalesce(identity.raw_app_meta_data, '{}'::jsonb) ? 'greenroster_password_recovery'
  ) then
    raise exception 'recovery_session_forbidden' using errcode = 'P0003';
  end if;

  return query
  select
    membership.id,
    membership.group_id,
    membership.user_id,
    membership.role,
    membership.status,
    membership.version
  from public.memberships as membership
  join public.user_profiles as profile on profile.user_id = membership.user_id
  join auth.users as identity on identity.id = membership.user_id
  where membership.user_id = v_actor_user_id
    and membership.status = 'active'
    and profile.disabled_at is null
    and identity.email_confirmed_at is not null
    and identity.deleted_at is null
    and not identity.is_anonymous
    and (identity.banned_until is null or identity.banned_until <= pg_catalog.statement_timestamp());

  if not found then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;
end;
$$;

revoke all on function app.resolve_mobile_self_membership()
from public, anon, authenticated, service_role;

create function public.resolve_mobile_member_self_profile()
returns table (
  membership_id app.entity_id,
  group_id app.entity_id,
  user_id app.entity_id,
  group_name text,
  group_time_zone text,
  role public.membership_role,
  status public.membership_status,
  membership_version bigint,
  profile_version bigint,
  contact_version bigint,
  first_name text,
  last_name text,
  spouse_first_name text,
  spouse_last_name text,
  tee_location text,
  secondary_email text,
  home_phone_display text,
  work_phone_display text,
  mobile_phone_display text,
  address_line1 text,
  address_line2 text,
  city text,
  state_region text,
  postal_code text,
  country text,
  secondary_email_visible boolean,
  home_phone_visible boolean,
  work_phone_visible boolean,
  mobile_phone_visible boolean,
  address_listed boolean,
  handicap_record_id app.entity_id,
  handicap_id text,
  handicap app.handicap_value,
  handicap_source public.member_handicap_source,
  handicap_as_of date,
  handicap_created_at app.utc_instant
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor record;
begin
  select * into actor from app.resolve_mobile_self_membership() limit 1;

  return query
  select
    actor.membership_id,
    actor.group_id,
    actor.user_id,
    group_record.name,
    group_record.time_zone::text,
    actor.role,
    actor.status,
    actor.membership_version,
    coalesce(profile.version, 0),
    coalesce(contact.version, 0),
    coalesce(profile.first_name, user_profile.first_name),
    coalesce(profile.last_name, user_profile.last_name),
    profile.spouse_first_name,
    profile.spouse_last_name,
    profile.tee_location,
    contact.secondary_email,
    contact.home_phone_display,
    contact.work_phone_display,
    contact.mobile_phone_display,
    contact.address_line1,
    contact.address_line2,
    contact.city,
    contact.state_region,
    contact.postal_code,
    contact.country,
    coalesce(contact.secondary_email_visible, false),
    coalesce(contact.home_phone_visible, false),
    coalesce(contact.work_phone_visible, false),
    coalesce(contact.mobile_phone_visible, false),
    coalesce(contact.address_listed, false),
    handicap_record.id,
    handicap_record.handicap_id,
    handicap_record.handicap,
    handicap_record.source,
    handicap_record.as_of,
    handicap_record.created_at
  from public.groups as group_record
  join public.user_profiles as user_profile
    on user_profile.user_id = actor.user_id
  left join public.membership_golfer_profiles as profile
    on profile.membership_id = actor.membership_id
   and profile.group_id = actor.group_id
  left join public.membership_private_contacts as contact
    on contact.membership_id = actor.membership_id
   and contact.group_id = actor.group_id
  left join lateral (
    select record.*
    from public.membership_handicap_records as record
    where record.membership_id = actor.membership_id
      and record.group_id = actor.group_id
    order by record.as_of desc, record.created_at desc, record.id desc
    limit 1
  ) as handicap_record on true
  where group_record.id = actor.group_id;
end;
$$;

comment on function public.resolve_mobile_member_self_profile() is
  'Returns only the authenticated active verified member profile and current handicap, with no client-supplied tenant or identity context.';

revoke all on function public.resolve_mobile_member_self_profile()
from public, anon, service_role;
grant execute on function public.resolve_mobile_member_self_profile() to authenticated;

create function public.update_mobile_member_self_profile(
  p_first_name text,
  p_last_name text,
  p_spouse_first_name text,
  p_spouse_last_name text,
  p_tee_location text,
  p_secondary_email text,
  p_home_phone text,
  p_work_phone text,
  p_mobile_phone text,
  p_address_line1 text,
  p_address_line2 text,
  p_city text,
  p_state_region text,
  p_postal_code text,
  p_country text,
  p_secondary_email_visible boolean,
  p_home_phone_visible boolean,
  p_work_phone_visible boolean,
  p_mobile_phone_visible boolean,
  p_address_listed boolean,
  p_expected_profile_version bigint,
  p_expected_contact_version bigint,
  p_expected_membership_version bigint,
  p_reason text,
  p_correlation_id uuid,
  p_operation_id uuid
)
returns table (
  membership_id app.entity_id,
  group_id app.entity_id,
  membership_version bigint,
  profile_version bigint,
  contact_version bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor record;
  profile_record public.membership_golfer_profiles%rowtype;
  contact_record public.membership_private_contacts%rowtype;
  prior_event public.audit_events%rowtype;
  normalized_first_name text;
  normalized_last_name text;
  normalized_spouse_first_name text;
  normalized_spouse_last_name text;
  normalized_tee text;
  normalized_secondary_email text;
  normalized_secondary_email_value text;
  normalized_home_phone text;
  normalized_work_phone text;
  normalized_mobile_phone text;
  normalized_address_line1 text;
  normalized_address_line2 text;
  normalized_city text;
  normalized_state_region text;
  normalized_postal_code text;
  normalized_country text;
  normalized_reason text;
  profile_exists boolean := false;
  contact_exists boolean := false;
  profile_changed boolean := false;
  contact_changed boolean := false;
  request_payload jsonb;
  request_fingerprint text;
  before_state jsonb;
  after_state jsonb;
  v_actor_user_id uuid := (select auth.uid());
begin
  if p_correlation_id is null or p_operation_id is null then
    raise exception 'operation_context_required' using errcode = '22004';
  end if;
  if p_expected_profile_version is null or p_expected_profile_version < 0
    or p_expected_contact_version is null or p_expected_contact_version < 0
    or p_expected_membership_version is null or p_expected_membership_version < 1
  then
    raise exception 'member_edit_versions_invalid' using errcode = '22023';
  end if;
  if p_secondary_email_visible is null or p_home_phone_visible is null
    or p_work_phone_visible is null or p_mobile_phone_visible is null
    or p_address_listed is null
  then
    raise exception 'member_edit_boolean_required' using errcode = '22023';
  end if;

  normalized_first_name := pg_catalog.btrim(p_first_name);
  normalized_last_name := pg_catalog.btrim(p_last_name);
  if normalized_first_name is null or normalized_first_name = ''
    or normalized_last_name is null or normalized_last_name = ''
    or pg_catalog.length(normalized_first_name) > 100
    or pg_catalog.length(normalized_last_name) > 100
  then
    raise exception 'member_names_required' using errcode = '22023';
  end if;
  normalized_spouse_first_name := nullif(pg_catalog.btrim(p_spouse_first_name), '');
  normalized_spouse_last_name := nullif(pg_catalog.btrim(p_spouse_last_name), '');
  if (normalized_spouse_first_name is not null and pg_catalog.length(normalized_spouse_first_name) > 100)
    or (normalized_spouse_last_name is not null and pg_catalog.length(normalized_spouse_last_name) > 100)
  then
    raise exception 'member_spouse_name_invalid' using errcode = '22023';
  end if;
  normalized_tee := nullif(pg_catalog.lower(pg_catalog.btrim(p_tee_location)), '');
  if normalized_tee is not null and normalized_tee not in ('pro', 'back', 'middle', 'front') then
    raise exception 'member_tee_invalid' using errcode = '22023';
  end if;
  normalized_secondary_email := nullif(pg_catalog.btrim(p_secondary_email), '');
  if normalized_secondary_email is not null and (
    pg_catalog.length(normalized_secondary_email) not between 3 and 320
    or normalized_secondary_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ) then
    raise exception 'member_secondary_email_invalid' using errcode = '22023';
  end if;
  normalized_secondary_email_value := case when normalized_secondary_email is null then null else pg_catalog.lower(normalized_secondary_email) end;
  normalized_home_phone := nullif(pg_catalog.btrim(p_home_phone), '');
  normalized_work_phone := nullif(pg_catalog.btrim(p_work_phone), '');
  normalized_mobile_phone := nullif(pg_catalog.btrim(p_mobile_phone), '');
  if (normalized_home_phone is not null and pg_catalog.length(normalized_home_phone) > 64)
    or (normalized_work_phone is not null and pg_catalog.length(normalized_work_phone) > 64)
    or (normalized_mobile_phone is not null and pg_catalog.length(normalized_mobile_phone) > 64)
  then
    raise exception 'member_phone_invalid' using errcode = '22023';
  end if;
  normalized_address_line1 := nullif(pg_catalog.btrim(p_address_line1), '');
  normalized_address_line2 := nullif(pg_catalog.btrim(p_address_line2), '');
  normalized_city := nullif(pg_catalog.btrim(p_city), '');
  normalized_state_region := nullif(pg_catalog.btrim(p_state_region), '');
  normalized_postal_code := nullif(pg_catalog.btrim(p_postal_code), '');
  normalized_country := nullif(pg_catalog.btrim(p_country), '');
  if (normalized_address_line1 is not null and pg_catalog.length(normalized_address_line1) > 200)
    or (normalized_address_line2 is not null and pg_catalog.length(normalized_address_line2) > 200)
    or (normalized_city is not null and pg_catalog.length(normalized_city) > 100)
    or (normalized_state_region is not null and pg_catalog.length(normalized_state_region) > 100)
    or (normalized_postal_code is not null and pg_catalog.length(normalized_postal_code) > 32)
    or (normalized_country is not null and pg_catalog.length(normalized_country) > 100)
  then
    raise exception 'member_address_field_invalid' using errcode = '22023';
  end if;
  normalized_reason := nullif(pg_catalog.btrim(p_reason), '');
  if normalized_reason is not null and pg_catalog.length(normalized_reason) > 500 then
    raise exception 'member_edit_reason_invalid' using errcode = '22023';
  end if;

  request_payload := pg_catalog.jsonb_build_object(
    'first_name', normalized_first_name, 'last_name', normalized_last_name,
    'spouse_first_name', normalized_spouse_first_name, 'spouse_last_name', normalized_spouse_last_name,
    'tee_location', normalized_tee, 'secondary_email', normalized_secondary_email,
    'home_phone', normalized_home_phone, 'work_phone', normalized_work_phone, 'mobile_phone', normalized_mobile_phone,
    'address_line1', normalized_address_line1, 'address_line2', normalized_address_line2,
    'city', normalized_city, 'state_region', normalized_state_region, 'postal_code', normalized_postal_code, 'country', normalized_country,
    'secondary_email_visible', p_secondary_email_visible, 'home_phone_visible', p_home_phone_visible,
    'work_phone_visible', p_work_phone_visible, 'mobile_phone_visible', p_mobile_phone_visible, 'address_listed', p_address_listed,
    'expected_profile_version', p_expected_profile_version, 'expected_contact_version', p_expected_contact_version,
    'expected_membership_version', p_expected_membership_version, 'reason', normalized_reason
  );
  request_fingerprint := app.member_request_fingerprint(request_payload, v_actor_user_id::text || ':' || p_operation_id::text);

  select * into actor from app.resolve_mobile_self_membership() limit 1;
  perform 1
  from public.groups as group_record
  where group_record.id = actor.group_id
  for update;
  if not found then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;
  select membership.version into actor.membership_version
  from public.memberships as membership
  join public.user_profiles as profile
    on profile.user_id = membership.user_id
  join auth.users as identity
    on identity.id = membership.user_id
  where membership.id = actor.membership_id
    and membership.group_id = actor.group_id
    and membership.user_id = actor.user_id
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

  select event.* into prior_event
  from public.audit_events as event
  where event.actor_user_id = v_actor_user_id
    and event.action = 'member.self_profile_updated'
    and event.operation_id = p_operation_id;
  if found then
    if prior_event.after_state ->> 'request_fingerprint' <> request_fingerprint then
      raise exception 'operation_id_reused' using errcode = '23505';
    end if;
    return query select actor.membership_id, actor.group_id,
      (prior_event.after_state ->> 'membership_version')::bigint,
      (prior_event.after_state ->> 'profile_version')::bigint,
      (prior_event.after_state ->> 'contact_version')::bigint;
    return;
  end if;
  if actor.membership_version <> p_expected_membership_version then
    raise exception 'member_membership_version_changed' using errcode = '40001';
  end if;

  select profile.* into profile_record
  from public.membership_golfer_profiles as profile
  where profile.membership_id = actor.membership_id and profile.group_id = actor.group_id
  for update;
  profile_exists := found;
  select contact.* into contact_record
  from public.membership_private_contacts as contact
  where contact.membership_id = actor.membership_id and contact.group_id = actor.group_id
  for update;
  contact_exists := found;
  if (profile_exists and p_expected_profile_version <> profile_record.version)
    or (not profile_exists and p_expected_profile_version <> 0) then
    raise exception 'member_profile_version_changed' using errcode = '40001';
  end if;
  if (contact_exists and p_expected_contact_version <> contact_record.version)
    or (not contact_exists and p_expected_contact_version <> 0) then
    raise exception 'member_contact_version_changed' using errcode = '40001';
  end if;
  profile_changed := not profile_exists
    or profile_record.first_name is distinct from normalized_first_name
    or profile_record.last_name is distinct from normalized_last_name
    or profile_record.spouse_first_name is distinct from normalized_spouse_first_name
    or profile_record.spouse_last_name is distinct from normalized_spouse_last_name
    or profile_record.tee_location is distinct from normalized_tee;
  contact_changed := not contact_exists
    or contact_record.secondary_email is distinct from normalized_secondary_email
    or contact_record.secondary_email_normalized is distinct from normalized_secondary_email_value
    or contact_record.home_phone_display is distinct from normalized_home_phone
    or contact_record.home_phone_normalized is distinct from app.normalize_member_phone(normalized_home_phone)
    or contact_record.work_phone_display is distinct from normalized_work_phone
    or contact_record.work_phone_normalized is distinct from app.normalize_member_phone(normalized_work_phone)
    or contact_record.mobile_phone_display is distinct from normalized_mobile_phone
    or contact_record.mobile_phone_normalized is distinct from app.normalize_member_phone(normalized_mobile_phone)
    or contact_record.address_line1 is distinct from normalized_address_line1
    or contact_record.address_line2 is distinct from normalized_address_line2
    or contact_record.city is distinct from normalized_city
    or contact_record.state_region is distinct from normalized_state_region
    or contact_record.postal_code is distinct from normalized_postal_code
    or contact_record.country is distinct from normalized_country
    or contact_record.secondary_email_visible is distinct from p_secondary_email_visible
    or contact_record.home_phone_visible is distinct from p_home_phone_visible
    or contact_record.work_phone_visible is distinct from p_work_phone_visible
    or contact_record.mobile_phone_visible is distinct from p_mobile_phone_visible
    or contact_record.address_listed is distinct from p_address_listed;

  before_state := pg_catalog.jsonb_build_object(
    'membership_id', actor.membership_id,
    'membership_version', actor.membership_version,
    'profile_version', case when profile_exists then profile_record.version else 0 end,
    'contact_version', case when contact_exists then contact_record.version else 0 end,
    'profile_fields', pg_catalog.jsonb_build_object('first_name', profile_exists, 'last_name', profile_exists, 'spouse_first_name', profile_record.spouse_first_name is not null, 'spouse_last_name', profile_record.spouse_last_name is not null, 'tee_location', profile_record.tee_location is not null),
    'contact_fields', pg_catalog.jsonb_build_object('secondary_email', contact_record.secondary_email is not null, 'home_phone', contact_record.home_phone_display is not null, 'work_phone', contact_record.work_phone_display is not null, 'mobile_phone', contact_record.mobile_phone_display is not null, 'address', contact_record.address_line1 is not null)
  );
  if profile_changed then
    if profile_exists then
      update public.membership_golfer_profiles as profile
      set first_name = normalized_first_name, last_name = normalized_last_name,
          spouse_first_name = normalized_spouse_first_name, spouse_last_name = normalized_spouse_last_name,
          tee_location = normalized_tee, version = profile.version + 1
      where profile.id = profile_record.id and profile.group_id = actor.group_id
      returning * into profile_record;
    else
      insert into public.membership_golfer_profiles (membership_id, group_id, first_name, last_name, spouse_first_name, spouse_last_name, tee_location)
      values (actor.membership_id, actor.group_id, normalized_first_name, normalized_last_name, normalized_spouse_first_name, normalized_spouse_last_name, normalized_tee)
      returning * into profile_record;
    end if;
  end if;
  if contact_changed then
    if contact_exists then
      update public.membership_private_contacts as contact
      set secondary_email = normalized_secondary_email, secondary_email_normalized = normalized_secondary_email_value,
          home_phone_display = normalized_home_phone, home_phone_normalized = app.normalize_member_phone(normalized_home_phone),
          work_phone_display = normalized_work_phone, work_phone_normalized = app.normalize_member_phone(normalized_work_phone),
          mobile_phone_display = normalized_mobile_phone, mobile_phone_normalized = app.normalize_member_phone(normalized_mobile_phone),
          address_line1 = normalized_address_line1, address_line2 = normalized_address_line2, city = normalized_city,
          state_region = normalized_state_region, postal_code = normalized_postal_code, country = normalized_country,
          secondary_email_visible = p_secondary_email_visible, home_phone_visible = p_home_phone_visible,
          work_phone_visible = p_work_phone_visible, mobile_phone_visible = p_mobile_phone_visible, address_listed = p_address_listed,
          version = contact.version + 1
      where contact.id = contact_record.id and contact.group_id = actor.group_id
      returning * into contact_record;
    else
      insert into public.membership_private_contacts (membership_id, group_id, secondary_email, secondary_email_normalized, home_phone_display, home_phone_normalized, work_phone_display, work_phone_normalized, mobile_phone_display, mobile_phone_normalized, address_line1, address_line2, city, state_region, postal_code, country, secondary_email_visible, home_phone_visible, work_phone_visible, mobile_phone_visible, address_listed)
      values (actor.membership_id, actor.group_id, normalized_secondary_email, normalized_secondary_email_value, normalized_home_phone, app.normalize_member_phone(normalized_home_phone), normalized_work_phone, app.normalize_member_phone(normalized_work_phone), normalized_mobile_phone, app.normalize_member_phone(normalized_mobile_phone), normalized_address_line1, normalized_address_line2, normalized_city, normalized_state_region, normalized_postal_code, normalized_country, p_secondary_email_visible, p_home_phone_visible, p_work_phone_visible, p_mobile_phone_visible, p_address_listed)
      returning * into contact_record;
    end if;
  end if;
  after_state := pg_catalog.jsonb_build_object(
    'membership_id', actor.membership_id,
    'membership_version', actor.membership_version,
    'profile_version', case when profile_record.id is not null then profile_record.version else 0 end,
    'contact_version', case when contact_record.id is not null then contact_record.version else 0 end,
    'profile_fields', pg_catalog.jsonb_build_object('first_name', profile_record.id is not null, 'last_name', profile_record.id is not null, 'spouse_first_name', profile_record.spouse_first_name is not null, 'spouse_last_name', profile_record.spouse_last_name is not null, 'tee_location', profile_record.tee_location is not null),
    'contact_fields', pg_catalog.jsonb_build_object('secondary_email', contact_record.secondary_email is not null, 'home_phone', contact_record.home_phone_display is not null, 'work_phone', contact_record.work_phone_display is not null, 'mobile_phone', contact_record.mobile_phone_display is not null, 'address', contact_record.address_line1 is not null),
    'request_fingerprint', request_fingerprint
  );
  insert into public.audit_events (group_id, actor_user_id, action, target_type, target_id, target_version, before_state, after_state, source, correlation_id, operation_id, reason)
  values (actor.group_id, v_actor_user_id, 'member.self_profile_updated', 'membership', actor.membership_id, actor.membership_version, before_state, after_state, 'mobile', p_correlation_id, p_operation_id, normalized_reason);
  return query select actor.membership_id, actor.group_id, actor.membership_version,
    case when profile_record.id is not null then profile_record.version else 0 end,
    case when contact_record.id is not null then contact_record.version else 0 end;
end;
$$;

comment on function public.update_mobile_member_self_profile(
  text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,boolean,boolean,boolean,boolean,boolean,bigint,bigint,bigint,text,uuid,uuid
) is 'Authenticated actor-derived self profile/contact/visibility edit. Account e-mail, role, status, dues, and quota are intentionally absent; audit state is redacted and replay is idempotent.';

revoke all on function public.update_mobile_member_self_profile(
  text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,boolean,boolean,boolean,boolean,boolean,bigint,bigint,bigint,text,uuid,uuid
) from public, anon, service_role;
grant execute on function public.update_mobile_member_self_profile(
  text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,boolean,boolean,boolean,boolean,boolean,bigint,bigint,bigint,text,uuid,uuid
) to authenticated;

create function public.set_mobile_member_self_handicap(
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
  membership_id app.entity_id,
  group_id app.entity_id,
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
  actor record;
  prior_event public.audit_events%rowtype;
  prior_handicap public.membership_handicap_records%rowtype;
  saved_handicap public.membership_handicap_records%rowtype;
  normalized_handicap_id text;
  normalized_reason text;
  request_payload jsonb;
  request_fingerprint text;
  before_state jsonb;
  after_state jsonb;
  v_actor_user_id uuid := (select auth.uid());
begin
  if p_handicap is null or p_as_of is null then
    raise exception 'member_handicap_value_required' using errcode = '22004';
  end if;
  if p_expected_membership_version is null or p_expected_membership_version < 1 then
    raise exception 'member_membership_version_invalid' using errcode = '22023';
  end if;
  if p_confirmed is distinct from true then
    raise exception 'member_handicap_confirmation_required' using errcode = '22023';
  end if;
  normalized_reason := nullif(pg_catalog.btrim(p_reason), '');
  if normalized_reason is null or pg_catalog.length(normalized_reason) > 500 then
    raise exception 'member_handicap_confirmation_required' using errcode = '22023';
  end if;
  if p_correlation_id is null or p_operation_id is null then
    raise exception 'operation_context_required' using errcode = '22004';
  end if;
  normalized_handicap_id := nullif(pg_catalog.btrim(p_handicap_id), '');
  if normalized_handicap_id is not null and pg_catalog.length(normalized_handicap_id) > 100 then
    raise exception 'member_handicap_id_invalid' using errcode = '22023';
  end if;
  request_payload := pg_catalog.jsonb_build_object('handicap_id', normalized_handicap_id, 'handicap', p_handicap::text, 'as_of', p_as_of, 'expected_membership_version', p_expected_membership_version, 'confirmed', p_confirmed, 'reason', normalized_reason);
  request_fingerprint := app.member_request_fingerprint(request_payload, v_actor_user_id::text || ':' || p_operation_id::text);
  select * into actor from app.resolve_mobile_self_membership() limit 1;
  perform 1
  from public.groups as group_record
  where group_record.id = actor.group_id
  for update;
  select membership.version into actor.membership_version
  from public.memberships as membership
  join public.user_profiles as profile
    on profile.user_id = membership.user_id
  join auth.users as identity
    on identity.id = membership.user_id
  where membership.id = actor.membership_id
    and membership.group_id = actor.group_id
    and membership.user_id = actor.user_id
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
  select event.* into prior_event from public.audit_events as event
  where event.actor_user_id = v_actor_user_id and event.action = 'member.handicap_changed' and event.operation_id = p_operation_id;
  if found then
    if prior_event.after_state ->> 'request_fingerprint' <> request_fingerprint then
      raise exception 'operation_id_reused' using errcode = '23505';
    end if;
    return query select (prior_event.after_state ->> 'handicap_record_id')::app.entity_id, actor.membership_id, actor.group_id,
      (prior_event.after_state ->> 'membership_version')::bigint, prior_event.after_state ->> 'handicap_id',
      (prior_event.after_state ->> 'handicap')::app.handicap_value, (prior_event.after_state ->> 'source')::public.member_handicap_source,
      (prior_event.after_state ->> 'as_of')::date, (prior_event.after_state ->> 'created_at')::app.utc_instant;
    return;
  end if;
  if actor.membership_version <> p_expected_membership_version then
    raise exception 'member_membership_version_changed' using errcode = '40001';
  end if;
  select record.* into prior_handicap from public.membership_handicap_records as record
  where record.membership_id = actor.membership_id and record.group_id = actor.group_id
  order by record.as_of desc, record.created_at desc, record.id desc limit 1;
  before_state := pg_catalog.jsonb_build_object('membership_id', actor.membership_id, 'membership_version', actor.membership_version, 'current_record_id', prior_handicap.id, 'current_handicap_id', prior_handicap.handicap_id, 'current_handicap', prior_handicap.handicap::text, 'current_source', prior_handicap.source, 'current_as_of', prior_handicap.as_of, 'current_created_at', prior_handicap.created_at);
  insert into public.membership_handicap_records (membership_id, group_id, handicap_id, handicap, source, as_of)
  values (actor.membership_id, actor.group_id, normalized_handicap_id, p_handicap, 'manual', p_as_of)
  returning * into saved_handicap;
  update public.memberships as membership
  set version = membership.version + 1
  where membership.id = actor.membership_id and membership.group_id = actor.group_id;
  actor.membership_version := actor.membership_version + 1;
  after_state := pg_catalog.jsonb_build_object('membership_id', actor.membership_id, 'membership_version', actor.membership_version, 'handicap_record_id', saved_handicap.id, 'handicap_id', saved_handicap.handicap_id, 'handicap', saved_handicap.handicap::text, 'source', saved_handicap.source, 'as_of', saved_handicap.as_of, 'created_at', saved_handicap.created_at, 'request_fingerprint', request_fingerprint);
  insert into public.audit_events (group_id, actor_user_id, action, target_type, target_id, target_version, before_state, after_state, source, correlation_id, operation_id, reason)
  values (actor.group_id, v_actor_user_id, 'member.handicap_changed', 'membership', actor.membership_id, actor.membership_version, before_state, after_state, 'mobile', p_correlation_id, p_operation_id, normalized_reason);
  return query select saved_handicap.id, actor.membership_id, actor.group_id, actor.membership_version, saved_handicap.handicap_id, saved_handicap.handicap, saved_handicap.source, saved_handicap.as_of, saved_handicap.created_at;
end;
$$;

comment on function public.set_mobile_member_self_handicap(text,app.handicap_value,date,bigint,boolean,text,uuid,uuid) is
  'Authenticated actor-derived append-only manual handicap observation with required confirmation/reason, optimistic membership version, redacted audit, and idempotent replay.';

revoke all on function public.set_mobile_member_self_handicap(text,app.handicap_value,date,bigint,boolean,text,uuid,uuid)
from public, anon, service_role;
grant execute on function public.set_mobile_member_self_handicap(text,app.handicap_value,date,bigint,boolean,text,uuid,uuid)
to authenticated;
