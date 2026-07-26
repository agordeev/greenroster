-- Phase 02: the membership-owned golfer profile/contact record and the
-- server-authoritative pending-member create boundary.

create function app.normalize_member_phone(value text)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  trimmed text;
  normalized text;
begin
  if value is null then
    return null;
  end if;

  trimmed := pg_catalog.btrim(value);
  if trimmed = '' or pg_catalog.length(trimmed) > 64 then
    return null;
  end if;

  -- Keep the display value untouched. Only punctuation commonly used in a
  -- phone number is removed, and only a clearly phone-shaped result is kept.
  if trimmed !~ '^[+0-9 ().-]+$' then
    return null;
  end if;

  normalized := pg_catalog.regexp_replace(trimmed, '[^0-9+]', '', 'g');
  if normalized !~ '^\+?[0-9]{7,15}$' then
    return null;
  end if;

  return normalized;
end;
$$;

comment on function app.normalize_member_phone(text) is
  'Conservative phone normalization. Unsupported or ambiguous display values retain their display form and receive a null normalized value.';

revoke all on function app.normalize_member_phone(text) from public, anon, authenticated;

create table public.membership_golfer_profiles (
  id app.entity_id primary key default pg_catalog.gen_random_uuid(),
  membership_id app.entity_id not null,
  group_id app.entity_id not null,
  first_name text not null,
  last_name text not null,
  spouse_first_name text,
  spouse_last_name text,
  tee_location text,
  version bigint not null default 1,
  created_at app.utc_instant not null default pg_catalog.now(),
  updated_at app.utc_instant not null default pg_catalog.now(),
  constraint membership_golfer_profiles_id_group_unique unique (id, group_id),
  constraint membership_golfer_profiles_membership_unique unique (membership_id),
  constraint membership_golfer_profiles_membership_group_fk
    foreign key (membership_id, group_id)
    references public.memberships (id, group_id)
    on delete restrict,
  constraint membership_golfer_profiles_first_name_valid
    check (pg_catalog.btrim(first_name) = first_name and pg_catalog.length(first_name) between 1 and 100),
  constraint membership_golfer_profiles_last_name_valid
    check (pg_catalog.btrim(last_name) = last_name and pg_catalog.length(last_name) between 1 and 100),
  constraint membership_golfer_profiles_spouse_first_name_valid
    check (
      spouse_first_name is null
      or (pg_catalog.btrim(spouse_first_name) = spouse_first_name and pg_catalog.length(spouse_first_name) between 1 and 100)
    ),
  constraint membership_golfer_profiles_spouse_last_name_valid
    check (
      spouse_last_name is null
      or (pg_catalog.btrim(spouse_last_name) = spouse_last_name and pg_catalog.length(spouse_last_name) between 1 and 100)
    ),
  constraint membership_golfer_profiles_tee_valid
    check (tee_location is null or tee_location in ('pro', 'back', 'middle', 'front')),
  constraint membership_golfer_profiles_version_positive
    check (version > 0)
);

comment on table public.membership_golfer_profiles is
  'Membership-owned golfer identity fields. It is usable while membership.user_id is null and never stores Auth identity data.';
comment on column public.membership_golfer_profiles.tee_location is
  'Lower-case API value: pro, back, middle, or front.';

create trigger membership_golfer_profiles_immutable_id
before update of id on public.membership_golfer_profiles
for each row execute function app.reject_id_change('id');

create trigger membership_golfer_profiles_immutable_membership
before update of membership_id on public.membership_golfer_profiles
for each row execute function app.reject_id_change('membership_id');

create trigger membership_golfer_profiles_immutable_group
before update of group_id on public.membership_golfer_profiles
for each row execute function app.reject_id_change('group_id');

create trigger membership_golfer_profiles_set_updated_at
before update on public.membership_golfer_profiles
for each row execute function app.set_updated_at();

create table public.membership_private_contacts (
  id app.entity_id primary key default pg_catalog.gen_random_uuid(),
  membership_id app.entity_id not null,
  group_id app.entity_id not null,
  secondary_email text,
  secondary_email_normalized text,
  home_phone_display text,
  home_phone_normalized text,
  work_phone_display text,
  work_phone_normalized text,
  mobile_phone_display text,
  mobile_phone_normalized text,
  address_line1 text,
  address_line2 text,
  city text,
  state_region text,
  postal_code text,
  country text,
  secondary_email_visible boolean not null default false,
  home_phone_visible boolean not null default false,
  work_phone_visible boolean not null default false,
  mobile_phone_visible boolean not null default false,
  address_listed boolean not null default false,
  version bigint not null default 1,
  created_at app.utc_instant not null default pg_catalog.now(),
  updated_at app.utc_instant not null default pg_catalog.now(),
  constraint membership_private_contacts_id_group_unique unique (id, group_id),
  constraint membership_private_contacts_membership_unique unique (membership_id),
  constraint membership_private_contacts_membership_group_fk
    foreign key (membership_id, group_id)
    references public.memberships (id, group_id)
    on delete restrict,
  constraint membership_private_contacts_email_valid
    check (
      secondary_email is null
      or (
        pg_catalog.btrim(secondary_email) = secondary_email
        and pg_catalog.length(secondary_email) between 3 and 320
        and secondary_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      )
    ),
  constraint membership_private_contacts_email_normalized_consistent
    check (
      (secondary_email is null and secondary_email_normalized is null)
      or (
        secondary_email is not null
        and secondary_email_normalized = pg_catalog.lower(pg_catalog.btrim(secondary_email))
        and secondary_email_normalized ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      )
    ),
  constraint membership_private_contacts_phone_display_valid
    check (
      (home_phone_display is null or (pg_catalog.btrim(home_phone_display) = home_phone_display and pg_catalog.length(home_phone_display) between 1 and 64))
      and (work_phone_display is null or (pg_catalog.btrim(work_phone_display) = work_phone_display and pg_catalog.length(work_phone_display) between 1 and 64))
      and (mobile_phone_display is null or (pg_catalog.btrim(mobile_phone_display) = mobile_phone_display and pg_catalog.length(mobile_phone_display) between 1 and 64))
    ),
  constraint membership_private_contacts_phone_normalized_consistent
    check (
      home_phone_normalized is not distinct from app.normalize_member_phone(home_phone_display)
      and work_phone_normalized is not distinct from app.normalize_member_phone(work_phone_display)
      and mobile_phone_normalized is not distinct from app.normalize_member_phone(mobile_phone_display)
    ),
  constraint membership_private_contacts_address_fields_valid
    check (
      (address_line1 is null or (pg_catalog.btrim(address_line1) = address_line1 and pg_catalog.btrim(address_line1) <> '' and pg_catalog.length(address_line1) <= 200))
      and (address_line2 is null or (pg_catalog.btrim(address_line2) = address_line2 and pg_catalog.btrim(address_line2) <> '' and pg_catalog.length(address_line2) <= 200))
      and (city is null or (pg_catalog.btrim(city) = city and pg_catalog.btrim(city) <> '' and pg_catalog.length(city) <= 100))
      and (state_region is null or (pg_catalog.btrim(state_region) = state_region and pg_catalog.btrim(state_region) <> '' and pg_catalog.length(state_region) <= 100))
      and (postal_code is null or (pg_catalog.btrim(postal_code) = postal_code and pg_catalog.btrim(postal_code) <> '' and pg_catalog.length(postal_code) <= 32))
      and (country is null or (pg_catalog.btrim(country) = country and pg_catalog.btrim(country) <> '' and pg_catalog.length(country) <= 100))
    ),
  constraint membership_private_contacts_version_positive
    check (version > 0)
);

comment on table public.membership_private_contacts is
  'Membership-owned private directory contact values. Display values are retained; normalized values are optional derived matching aids.';

create trigger membership_private_contacts_immutable_id
before update of id on public.membership_private_contacts
for each row execute function app.reject_id_change('id');

create trigger membership_private_contacts_immutable_membership
before update of membership_id on public.membership_private_contacts
for each row execute function app.reject_id_change('membership_id');

create trigger membership_private_contacts_immutable_group
before update of group_id on public.membership_private_contacts
for each row execute function app.reject_id_change('group_id');

create trigger membership_private_contacts_set_updated_at
before update on public.membership_private_contacts
for each row execute function app.set_updated_at();

create index membership_golfer_profiles_group_membership_idx
  on public.membership_golfer_profiles (group_id, membership_id);
create index membership_private_contacts_group_membership_idx
  on public.membership_private_contacts (group_id, membership_id);

alter table public.membership_golfer_profiles enable row level security;
alter table public.membership_golfer_profiles force row level security;
alter table public.membership_private_contacts enable row level security;
alter table public.membership_private_contacts force row level security;

-- No table policy is intentional: this slice has no raw Data API route. Later
-- role-filtered projections may add narrowly scoped policies and grants.
revoke all on table
  public.membership_golfer_profiles,
  public.membership_private_contacts
from public, anon, authenticated;
grant select on table
  public.membership_golfer_profiles,
  public.membership_private_contacts
to service_role;

create function public.create_pending_member_profile(
  p_actor_user_id uuid,
  p_first_name text,
  p_last_name text,
  p_spouse_first_name text,
  p_spouse_last_name text,
  p_tee_location text,
  p_dues_paid boolean,
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
  p_reason text,
  p_correlation_id uuid,
  p_operation_id uuid
)
returns table (
  created_membership_id app.entity_id,
  created_group_id app.entity_id,
  profile_version bigint,
  contact_version bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_group_id uuid;
  locked_group public.groups%rowtype;
  actor_membership public.memberships%rowtype;
  membership_record public.memberships%rowtype;
  profile_record public.membership_golfer_profiles%rowtype;
  contact_record public.membership_private_contacts%rowtype;
  prior_event public.audit_events%rowtype;
  normalized_reason text;
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
  profile_fields jsonb;
  contact_fields jsonb;
  visibility jsonb;
begin
  if p_actor_user_id is null then
    raise exception 'actor_identity_required' using errcode = '22004';
  end if;

  if p_correlation_id is null or p_operation_id is null then
    raise exception 'operation_context_required' using errcode = '22004';
  end if;

  normalized_reason := nullif(pg_catalog.btrim(p_reason), '');
  if normalized_reason is not null and pg_catalog.length(normalized_reason) > 500 then
    raise exception 'member_create_reason_invalid' using errcode = '22023';
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
  if normalized_secondary_email is not null
    and (
      pg_catalog.length(normalized_secondary_email) not between 3 and 320
      or normalized_secondary_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    )
  then
    raise exception 'member_secondary_email_invalid' using errcode = '22023';
  end if;
  normalized_secondary_email_value := case
    when normalized_secondary_email is null then null
    else pg_catalog.lower(normalized_secondary_email)
  end;

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

  -- The actor is the only tenant input. Locking the group serializes this
  -- create with concurrent membership mutations and makes reauthorization
  -- effective immediately after a role/status change commits.
  select membership.group_id
  into actor_group_id
  from public.memberships as membership
  where membership.user_id = p_actor_user_id;

  if not found then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  select actor_group.*
  into locked_group
  from public.groups as actor_group
  where actor_group.id = actor_group_id
  for update;

  select membership.*
  into actor_membership
  from public.memberships as membership
  join public.user_profiles as profile on profile.user_id = membership.user_id
  join auth.users as identity on identity.id = membership.user_id
  where membership.user_id = p_actor_user_id
    and membership.group_id = locked_group.id
    and membership.status = 'active'
    and membership.role in ('coordinator', 'administrator')
    and profile.disabled_at is null
    and identity.email_confirmed_at is not null
    and identity.deleted_at is null
    and not identity.is_anonymous
    and (identity.banned_until is null or identity.banned_until <= pg_catalog.now())
  for update of membership;

  if not found or actor_membership.role not in ('coordinator', 'administrator') then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  select event.*
  into prior_event
  from public.audit_events as event
  where event.group_id = locked_group.id
    and event.actor_user_id = p_actor_user_id
    and event.action = 'member.created'
    and event.operation_id = p_operation_id;

  if found then
    return query
    select
      (prior_event.after_state ->> 'membership_id')::app.entity_id,
      prior_event.group_id,
      (prior_event.after_state ->> 'profile_version')::bigint,
      (prior_event.after_state ->> 'contact_version')::bigint;
    return;
  end if;

  insert into public.memberships (
    group_id,
    role,
    status,
    dues_paid
  )
  values (
    locked_group.id,
    'member',
    'pending',
    coalesce(p_dues_paid, false)
  )
  returning * into membership_record;

  insert into public.membership_golfer_profiles (
    membership_id,
    group_id,
    first_name,
    last_name,
    spouse_first_name,
    spouse_last_name,
    tee_location
  )
  values (
    membership_record.id,
    locked_group.id,
    normalized_first_name,
    normalized_last_name,
    normalized_spouse_first_name,
    normalized_spouse_last_name,
    normalized_tee
  )
  returning * into profile_record;

  insert into public.membership_private_contacts (
    membership_id,
    group_id,
    secondary_email,
    secondary_email_normalized,
    home_phone_display,
    home_phone_normalized,
    work_phone_display,
    work_phone_normalized,
    mobile_phone_display,
    mobile_phone_normalized,
    address_line1,
    address_line2,
    city,
    state_region,
    postal_code,
    country,
    secondary_email_visible,
    home_phone_visible,
    work_phone_visible,
    mobile_phone_visible,
    address_listed
  )
  values (
    membership_record.id,
    locked_group.id,
    normalized_secondary_email,
    normalized_secondary_email_value,
    normalized_home_phone,
    app.normalize_member_phone(normalized_home_phone),
    normalized_work_phone,
    app.normalize_member_phone(normalized_work_phone),
    normalized_mobile_phone,
    app.normalize_member_phone(normalized_mobile_phone),
    normalized_address_line1,
    normalized_address_line2,
    normalized_city,
    normalized_state_region,
    normalized_postal_code,
    normalized_country,
    coalesce(p_secondary_email_visible, false),
    coalesce(p_home_phone_visible, false),
    coalesce(p_work_phone_visible, false),
    coalesce(p_mobile_phone_visible, false),
    coalesce(p_address_listed, false)
  )
  returning * into contact_record;

  profile_fields := pg_catalog.jsonb_build_object(
    'first_name', true,
    'last_name', true,
    'spouse_first_name', normalized_spouse_first_name is not null,
    'spouse_last_name', normalized_spouse_last_name is not null,
    'tee_location', normalized_tee is not null
  );
  contact_fields := pg_catalog.jsonb_build_object(
    'secondary_email', normalized_secondary_email is not null,
    'home_phone', normalized_home_phone is not null,
    'work_phone', normalized_work_phone is not null,
    'mobile_phone', normalized_mobile_phone is not null,
    'address', normalized_address_line1 is not null
  );
  visibility := pg_catalog.jsonb_build_object(
    'secondary_email', coalesce(p_secondary_email_visible, false),
    'home_phone', coalesce(p_home_phone_visible, false),
    'work_phone', coalesce(p_work_phone_visible, false),
    'mobile_phone', coalesce(p_mobile_phone_visible, false),
    'address', coalesce(p_address_listed, false)
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
    operation_id,
    reason
  )
  values (
    locked_group.id,
    p_actor_user_id,
    'member.created',
    'membership',
    membership_record.id,
    profile_record.version,
    pg_catalog.jsonb_build_object(
      'membership_id', membership_record.id,
      'group_id', locked_group.id,
      'membership_role', membership_record.role,
      'membership_status', membership_record.status,
      'dues_paid', membership_record.dues_paid,
      'profile_version', profile_record.version,
      'profile_fields', profile_fields,
      'contact_version', contact_record.version,
      'contact_fields', contact_fields,
      'visibility', visibility
    ),
    'server',
    p_correlation_id,
    p_operation_id,
    normalized_reason
  );

  return query
  select membership_record.id, locked_group.id, profile_record.version, contact_record.version;
end;
$$;

comment on function public.create_pending_member_profile(
  uuid, text, text, text, text, text, boolean, text, text, text, text,
  text, text, text, text, text, text, boolean, boolean, boolean, boolean,
  boolean, text, uuid, uuid
) is
  'Atomic service-only Add-member foundation. Creates one unattached pending member with profile/contact records and a redacted member.created audit event.';

revoke all on function public.create_pending_member_profile(
  uuid, text, text, text, text, text, boolean, text, text, text, text,
  text, text, text, text, text, text, boolean, boolean, boolean, boolean,
  boolean, text, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.create_pending_member_profile(
  uuid, text, text, text, text, text, boolean, text, text, text, text,
  text, text, text, text, text, text, boolean, boolean, boolean, boolean,
  boolean, text, uuid, uuid
) to service_role;
