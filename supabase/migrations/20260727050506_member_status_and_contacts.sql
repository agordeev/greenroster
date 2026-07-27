-- Phase 02: server-authoritative member management, private contacts, and
-- active/inactive membership lifecycle.
--
-- Raw membership/profile/contact tables stay force-RLS and have no client
-- write grants. The trusted Next.js server calls the service-only projections
-- and mutations below. Tenant scope is always derived from the verified
-- actor's active membership; no client-supplied group id is trusted.

create extension if not exists pgcrypto with schema extensions;

alter table public.memberships
  add column version bigint not null default 1;

alter table public.memberships
  add constraint memberships_version_positive check (version > 0);

comment on column public.memberships.version is
  'Optimistic concurrency version for server-authoritative member/status edits.';

create function app.bump_membership_version()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Existing server mutations (invitation attachment and administrator role
  -- transfer) predate this column and do not supply a version. Preserve the
  -- same optimistic-concurrency invariant for those paths while allowing the
  -- new RPCs to supply their already-incremented version explicitly.
  if new.version = old.version then
    new.version := old.version + 1;
  end if;
  return new;
end;
$$;

revoke all on function app.bump_membership_version()
from public, anon, authenticated;

create trigger memberships_bump_version
before update on public.memberships
for each row execute function app.bump_membership_version();

alter table public.memberships enable row level security;
alter table public.memberships force row level security;

-- The service role already has narrowly scoped identity-affiliation reads from
-- the earlier foundation migration. It must not receive raw mutation access.
revoke insert, update, delete, truncate, references, trigger
on table public.memberships
from public, anon, authenticated, service_role;
revoke insert, update, delete, truncate, references, trigger
on table public.membership_golfer_profiles
from public, anon, authenticated, service_role;
revoke insert, update, delete, truncate, references, trigger
on table public.membership_private_contacts
from public, anon, authenticated, service_role;
-- Existing invitation-mail delivery reads golfer names directly through its
-- trusted server function. Private contact values have no such job path and
-- are available only through the audited projection above.
revoke select on table public.membership_private_contacts from service_role;

create function app.resolve_member_management_actor(p_actor_user_id uuid)
returns table (
  group_id app.entity_id,
  membership_id app.entity_id,
  actor_role public.membership_role
)
language sql
stable
security definer
set search_path = ''
as $$
  select membership.group_id, membership.id, membership.role
  from public.memberships as membership
  join public.user_profiles as profile
    on profile.user_id = membership.user_id
  join auth.users as identity
    on identity.id = membership.user_id
  where membership.user_id = p_actor_user_id
    and membership.status = 'active'
    and membership.role in ('coordinator', 'administrator')
    and profile.disabled_at is null
    and identity.email_confirmed_at is not null
    and identity.deleted_at is null
    and not identity.is_anonymous
    and (identity.banned_until is null or identity.banned_until <= pg_catalog.statement_timestamp());
$$;

revoke all on function app.resolve_member_management_actor(uuid)
from public, anon, authenticated;

create function app.member_request_fingerprint(p_request jsonb, p_salt text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  -- The operation-specific salt prevents the audit fingerprint from being a
  -- reusable unsalted dictionary artifact while keeping replay comparison
  -- deterministic for this actor/operation boundary. Raw fields never enter
  -- audit state.
  select pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(coalesce(p_salt, '') || ':' || p_request::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
$$;

revoke all on function app.member_request_fingerprint(jsonb, text)
from public, anon, authenticated;

create function app.reject_inactive_member_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Cancellation/suppression is the allowed cleanup path after status changes;
  -- no new or still-sendable work may target an inactive membership.
  if new.state in ('queued', 'retryable', 'sending')
    and (
      (new.recipient_membership_id is not null and exists (
        select 1
        from public.memberships as membership
        where membership.id = new.recipient_membership_id
          and membership.status = 'inactive'
      ))
      or (new.recipient_user_id is not null and exists (
        select 1
        from public.memberships as membership
        where membership.user_id = new.recipient_user_id
          and membership.status = 'inactive'
      ))
    )
  then
    raise exception 'inactive_member_notification_suppressed'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function app.reject_inactive_member_notification()
from public, anon, authenticated;

create trigger notification_deliveries_reject_inactive_member
before insert or update on public.notification_deliveries
for each row execute function app.reject_inactive_member_notification();

create function public.list_manageable_members(
  p_actor_user_id uuid
)
returns table (
  membership_id app.entity_id,
  group_id app.entity_id,
  user_id app.entity_id,
  first_name text,
  last_name text,
  spouse_first_name text,
  spouse_last_name text,
  tee_location text,
  role public.membership_role,
  status public.membership_status,
  dues_paid boolean,
  membership_version bigint,
  profile_version bigint,
  contact_version bigint,
  created_at app.utc_instant,
  activated_at app.utc_instant,
  inactivated_at app.utc_instant
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_group_id uuid;
begin
  select actor.group_id
  into actor_group_id
  from app.resolve_member_management_actor(p_actor_user_id) as actor;

  if actor_group_id is null then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  return query
  select
    membership.id,
    membership.group_id,
    membership.user_id,
    coalesce(golfer.first_name, profile.first_name),
    coalesce(golfer.last_name, profile.last_name),
    golfer.spouse_first_name,
    golfer.spouse_last_name,
    golfer.tee_location,
    membership.role,
    membership.status,
    membership.dues_paid,
    membership.version,
    coalesce(golfer.version, 0),
    coalesce(contact.version, 0),
    membership.created_at,
    membership.activated_at,
    membership.inactivated_at
  from public.memberships as membership
  left join public.membership_golfer_profiles as golfer
    on golfer.membership_id = membership.id
   and golfer.group_id = membership.group_id
  left join public.membership_private_contacts as contact
    on contact.membership_id = membership.id
   and contact.group_id = membership.group_id
  left join public.user_profiles as profile
    on profile.user_id = membership.user_id
  where membership.group_id = actor_group_id
  order by coalesce(golfer.last_name, profile.last_name),
    coalesce(golfer.first_name, profile.first_name), membership.id;
end;
$$;

comment on function public.list_manageable_members(uuid) is
  'Service-only coordinator/administrator member projection. It includes operational fields and versions, never private contact values.';

revoke all on function public.list_manageable_members(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.list_manageable_members(uuid) to service_role;

create function public.get_manageable_member(
  p_actor_user_id uuid,
  p_membership_id uuid
)
returns table (
  membership_id app.entity_id,
  group_id app.entity_id,
  user_id app.entity_id,
  first_name text,
  last_name text,
  spouse_first_name text,
  spouse_last_name text,
  tee_location text,
  role public.membership_role,
  status public.membership_status,
  dues_paid boolean,
  membership_version bigint,
  profile_version bigint,
  contact_version bigint,
  created_at app.utc_instant,
  activated_at app.utc_instant,
  inactivated_at app.utc_instant
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_group_id uuid;
begin
  select actor.group_id
  into actor_group_id
  from app.resolve_member_management_actor(p_actor_user_id) as actor;

  if actor_group_id is null then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  if not exists (
    select 1
    from public.memberships as membership
    where membership.id = p_membership_id
      and membership.group_id = actor_group_id
  ) then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;

  return query
  select
    membership.id,
    membership.group_id,
    membership.user_id,
    coalesce(golfer.first_name, profile.first_name),
    coalesce(golfer.last_name, profile.last_name),
    golfer.spouse_first_name,
    golfer.spouse_last_name,
    golfer.tee_location,
    membership.role,
    membership.status,
    membership.dues_paid,
    membership.version,
    coalesce(golfer.version, 0),
    coalesce(contact.version, 0),
    membership.created_at,
    membership.activated_at,
    membership.inactivated_at
  from public.memberships as membership
  left join public.membership_golfer_profiles as golfer
    on golfer.membership_id = membership.id
   and golfer.group_id = membership.group_id
  left join public.membership_private_contacts as contact
    on contact.membership_id = membership.id
   and contact.group_id = membership.group_id
  left join public.user_profiles as profile
    on profile.user_id = membership.user_id
  where membership.group_id = actor_group_id
    and membership.id = p_membership_id;
end;
$$;

comment on function public.get_manageable_member(uuid, uuid) is
  'Service-only member detail projection. Private contact values require the separately audited contact-detail RPC.';

revoke all on function public.get_manageable_member(uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.get_manageable_member(uuid, uuid) to service_role;

create function public.list_member_directory(
  p_actor_user_id uuid
)
returns table (
  membership_id app.entity_id,
  group_id app.entity_id,
  first_name text,
  last_name text,
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
  country text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_group_id uuid;
begin
  select membership.group_id
  into actor_group_id
  from public.memberships as membership
  join public.user_profiles as profile on profile.user_id = membership.user_id
  join auth.users as identity on identity.id = membership.user_id
  where membership.user_id = p_actor_user_id
    and membership.status = 'active'
    and profile.disabled_at is null
    and identity.email_confirmed_at is not null
    and identity.deleted_at is null
    and not identity.is_anonymous
    and (identity.banned_until is null or identity.banned_until <= pg_catalog.statement_timestamp());

  if actor_group_id is null then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  return query
  select
    membership.id,
    membership.group_id,
    coalesce(golfer.first_name, profile.first_name),
    coalesce(golfer.last_name, profile.last_name),
    golfer.tee_location,
    case when contact.secondary_email_visible then contact.secondary_email else null end,
    case when contact.home_phone_visible then contact.home_phone_display else null end,
    case when contact.work_phone_visible then contact.work_phone_display else null end,
    case when contact.mobile_phone_visible then contact.mobile_phone_display else null end,
    case when contact.address_listed then contact.address_line1 else null end,
    case when contact.address_listed then contact.address_line2 else null end,
    case when contact.address_listed then contact.city else null end,
    case when contact.address_listed then contact.state_region else null end,
    case when contact.address_listed then contact.postal_code else null end,
    case when contact.address_listed then contact.country else null end
  from public.memberships as membership
  left join public.membership_golfer_profiles as golfer
    on golfer.membership_id = membership.id
   and golfer.group_id = membership.group_id
  left join public.membership_private_contacts as contact
    on contact.membership_id = membership.id
   and contact.group_id = membership.group_id
  left join public.user_profiles as profile
    on profile.user_id = membership.user_id
  where membership.group_id = actor_group_id
    and membership.status = 'active'
  order by coalesce(golfer.last_name, profile.last_name),
    coalesce(golfer.first_name, profile.first_name), membership.id;
end;
$$;

comment on function public.list_member_directory(uuid) is
  'Service-only public member directory projection. It returns names and tee plus each secondary e-mail, phone, and address field only when that field''s explicit visibility flag permits it; hidden values are null.';

revoke all on function public.list_member_directory(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.list_member_directory(uuid) to service_role;

create function public.get_member_private_contact_detail(
  p_actor_user_id uuid,
  p_membership_id uuid,
  p_correlation_id uuid
)
returns table (
  membership_id app.entity_id,
  group_id app.entity_id,
  contact_exists boolean,
  contact_version bigint,
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
  address_listed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_group_id uuid;
  target_membership public.memberships%rowtype;
  contact_record public.membership_private_contacts%rowtype;
begin
  if p_correlation_id is null then
    raise exception 'operation_context_required' using errcode = '22004';
  end if;

  select actor.group_id
  into actor_group_id
  from app.resolve_member_management_actor(p_actor_user_id) as actor;
  if actor_group_id is null then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  select membership.*
  into target_membership
  from public.memberships as membership
  where membership.id = p_membership_id
    and membership.group_id = actor_group_id;
  if not found then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;

  select contact.*
  into contact_record
  from public.membership_private_contacts as contact
  where contact.membership_id = target_membership.id
    and contact.group_id = target_membership.group_id;

  insert into public.audit_events (
    group_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    target_version,
    after_state,
    source,
    correlation_id
  )
  values (
    target_membership.group_id,
    p_actor_user_id,
    'member.private_contact_viewed',
    'membership',
    target_membership.id,
    nullif(contact_record.version, 0),
    pg_catalog.jsonb_build_object(
      'contact_fields', pg_catalog.jsonb_build_object(
        'secondary_email', contact_record.secondary_email is not null,
        'home_phone', contact_record.home_phone_display is not null,
        'work_phone', contact_record.work_phone_display is not null,
        'mobile_phone', contact_record.mobile_phone_display is not null,
        'address', contact_record.address_line1 is not null
      ),
      'visibility', pg_catalog.jsonb_build_object(
        'secondary_email', coalesce(contact_record.secondary_email_visible, false),
        'home_phone', coalesce(contact_record.home_phone_visible, false),
        'work_phone', coalesce(contact_record.work_phone_visible, false),
        'mobile_phone', coalesce(contact_record.mobile_phone_visible, false),
        'address', coalesce(contact_record.address_listed, false)
      )
    ),
    'portal',
    p_correlation_id
  );

  return query
  select
    target_membership.id,
    target_membership.group_id,
    contact_record.id is not null,
    coalesce(contact_record.version, 0),
    contact_record.secondary_email,
    contact_record.home_phone_display,
    contact_record.work_phone_display,
    contact_record.mobile_phone_display,
    contact_record.address_line1,
    contact_record.address_line2,
    contact_record.city,
    contact_record.state_region,
    contact_record.postal_code,
    contact_record.country,
    coalesce(contact_record.secondary_email_visible, false),
    coalesce(contact_record.home_phone_visible, false),
    coalesce(contact_record.work_phone_visible, false),
    coalesce(contact_record.mobile_phone_visible, false),
    coalesce(contact_record.address_listed, false);
end;
$$;

comment on function public.get_member_private_contact_detail(uuid, uuid, uuid) is
  'Service-only independently authorized private-contact read. Every successful read creates a redacted audit event; raw values never enter audit state.';

revoke all on function public.get_member_private_contact_detail(uuid, uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.get_member_private_contact_detail(uuid, uuid, uuid)
to service_role;

create function public.edit_member(
  p_actor_user_id uuid,
  p_membership_id uuid,
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
  p_expected_profile_version bigint,
  p_expected_contact_version bigint,
  p_expected_membership_version bigint,
  p_reason text,
  p_correlation_id uuid,
  p_operation_id uuid
)
returns table (
  edited_membership_id app.entity_id,
  edited_group_id app.entity_id,
  membership_version bigint,
  profile_version bigint,
  contact_version bigint,
  status public.membership_status
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
  profile_record public.membership_golfer_profiles%rowtype;
  contact_record public.membership_private_contacts%rowtype;
  prior_event public.audit_events%rowtype;
  profile_exists boolean := false;
  contact_exists boolean := false;
  profile_changed boolean := false;
  contact_changed boolean := false;
  membership_changed boolean := false;
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
  request_payload jsonb;
  request_fingerprint text;
  before_state jsonb;
  after_state jsonb;
begin
  if p_actor_user_id is null or p_membership_id is null then
    raise exception 'member_edit_context_required' using errcode = '22004';
  end if;

  if p_correlation_id is null or p_operation_id is null then
    raise exception 'operation_context_required' using errcode = '22004';
  end if;

  if p_expected_profile_version is null or p_expected_profile_version < 0
    or p_expected_contact_version is null or p_expected_contact_version < 0
    or p_expected_membership_version is null or p_expected_membership_version < 1
  then
    raise exception 'member_edit_versions_invalid' using errcode = '22023';
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

  if p_dues_paid is null
    or p_secondary_email_visible is null
    or p_home_phone_visible is null
    or p_work_phone_visible is null
    or p_mobile_phone_visible is null
    or p_address_listed is null
  then
    raise exception 'member_edit_boolean_required' using errcode = '22023';
  end if;

  normalized_reason := nullif(pg_catalog.btrim(p_reason), '');
  if normalized_reason is not null and pg_catalog.length(normalized_reason) > 500 then
    raise exception 'member_edit_reason_invalid' using errcode = '22023';
  end if;

  request_payload := pg_catalog.jsonb_build_object(
    'membership_id', p_membership_id,
    'first_name', normalized_first_name,
    'last_name', normalized_last_name,
    'spouse_first_name', normalized_spouse_first_name,
    'spouse_last_name', normalized_spouse_last_name,
    'tee_location', normalized_tee,
    'dues_paid', p_dues_paid,
    'secondary_email', normalized_secondary_email,
    'home_phone', normalized_home_phone,
    'work_phone', normalized_work_phone,
    'mobile_phone', normalized_mobile_phone,
    'address_line1', normalized_address_line1,
    'address_line2', normalized_address_line2,
    'city', normalized_city,
    'state_region', normalized_state_region,
    'postal_code', normalized_postal_code,
    'country', normalized_country,
    'secondary_email_visible', p_secondary_email_visible,
    'home_phone_visible', p_home_phone_visible,
    'work_phone_visible', p_work_phone_visible,
    'mobile_phone_visible', p_mobile_phone_visible,
    'address_listed', p_address_listed,
    'expected_profile_version', p_expected_profile_version,
    'expected_contact_version', p_expected_contact_version,
    'expected_membership_version', p_expected_membership_version,
    'reason', normalized_reason
  );
  request_fingerprint := app.member_request_fingerprint(
    request_payload,
    p_actor_user_id::text || ':' || p_operation_id::text
  );

  -- Resolve tenant from the actor, then serialize all member operations for
  -- that tenant before rechecking the actor and target state.
  select actor.group_id
  into actor_group_id
  from app.resolve_member_management_actor(p_actor_user_id) as actor;
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
    and event.action = 'member.updated'
    and event.operation_id = p_operation_id;

  if found then
    if (prior_event.after_state ->> 'membership_id')::uuid <> p_membership_id
      or prior_event.after_state ->> 'request_fingerprint' <> request_fingerprint
    then
      raise exception 'operation_id_reused' using errcode = '23505';
    end if;

    return query
    select
      (prior_event.after_state ->> 'membership_id')::app.entity_id,
      prior_event.group_id,
      (prior_event.after_state ->> 'membership_version')::bigint,
      (prior_event.after_state ->> 'profile_version')::bigint,
      (prior_event.after_state ->> 'contact_version')::bigint,
      (prior_event.after_state ->> 'status')::public.membership_status;
    return;
  end if;

  if target_membership.version <> p_expected_membership_version then
    raise exception 'member_membership_version_changed' using errcode = '40001';
  end if;

  select profile.*
  into profile_record
  from public.membership_golfer_profiles as profile
  where profile.membership_id = target_membership.id
    and profile.group_id = target_membership.group_id
  for update;
  profile_exists := found;

  select contact.*
  into contact_record
  from public.membership_private_contacts as contact
  where contact.membership_id = target_membership.id
    and contact.group_id = target_membership.group_id
  for update;
  contact_exists := found;

  if (profile_exists and p_expected_profile_version <> profile_record.version)
    or (not profile_exists and p_expected_profile_version <> 0)
  then
    raise exception 'member_profile_version_changed' using errcode = '40001';
  end if;
  if (contact_exists and p_expected_contact_version <> contact_record.version)
    or (not contact_exists and p_expected_contact_version <> 0)
  then
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
  membership_changed := target_membership.dues_paid is distinct from p_dues_paid;

  before_state := pg_catalog.jsonb_build_object(
    'membership_id', target_membership.id,
    'membership_version', target_membership.version,
    'status', target_membership.status,
    'role', target_membership.role,
    'dues_paid', target_membership.dues_paid,
    'profile_version', case when profile_exists then profile_record.version else 0 end,
    'profile_fields', pg_catalog.jsonb_build_object(
      'first_name', profile_exists,
      'last_name', profile_exists,
      'spouse_first_name', profile_record.spouse_first_name is not null,
      'spouse_last_name', profile_record.spouse_last_name is not null,
      'tee_location', profile_record.tee_location is not null
    ),
    'contact_version', case when contact_exists then contact_record.version else 0 end,
    'contact_fields', pg_catalog.jsonb_build_object(
      'secondary_email', contact_record.secondary_email is not null,
      'home_phone', contact_record.home_phone_display is not null,
      'work_phone', contact_record.work_phone_display is not null,
      'mobile_phone', contact_record.mobile_phone_display is not null,
      'address', contact_record.address_line1 is not null
    ),
    'visibility', pg_catalog.jsonb_build_object(
      'secondary_email', coalesce(contact_record.secondary_email_visible, false),
      'home_phone', coalesce(contact_record.home_phone_visible, false),
      'work_phone', coalesce(contact_record.work_phone_visible, false),
      'mobile_phone', coalesce(contact_record.mobile_phone_visible, false),
      'address', coalesce(contact_record.address_listed, false)
    )
  );

  if profile_changed then
    if profile_exists then
      update public.membership_golfer_profiles as profile
      set first_name = normalized_first_name,
          last_name = normalized_last_name,
          spouse_first_name = normalized_spouse_first_name,
          spouse_last_name = normalized_spouse_last_name,
          tee_location = normalized_tee,
          version = profile.version + 1
      where profile.id = profile_record.id
        and profile.group_id = target_membership.group_id
      returning * into profile_record;
    else
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
        target_membership.id,
        target_membership.group_id,
        normalized_first_name,
        normalized_last_name,
        normalized_spouse_first_name,
        normalized_spouse_last_name,
        normalized_tee
      )
      returning * into profile_record;
    end if;
  end if;

  if contact_changed then
    if contact_exists then
      update public.membership_private_contacts as contact
      set secondary_email = normalized_secondary_email,
          secondary_email_normalized = normalized_secondary_email_value,
          home_phone_display = normalized_home_phone,
          home_phone_normalized = app.normalize_member_phone(normalized_home_phone),
          work_phone_display = normalized_work_phone,
          work_phone_normalized = app.normalize_member_phone(normalized_work_phone),
          mobile_phone_display = normalized_mobile_phone,
          mobile_phone_normalized = app.normalize_member_phone(normalized_mobile_phone),
          address_line1 = normalized_address_line1,
          address_line2 = normalized_address_line2,
          city = normalized_city,
          state_region = normalized_state_region,
          postal_code = normalized_postal_code,
          country = normalized_country,
          secondary_email_visible = p_secondary_email_visible,
          home_phone_visible = p_home_phone_visible,
          work_phone_visible = p_work_phone_visible,
          mobile_phone_visible = p_mobile_phone_visible,
          address_listed = p_address_listed,
          version = contact.version + 1
      where contact.id = contact_record.id
        and contact.group_id = target_membership.group_id
      returning * into contact_record;
    else
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
        target_membership.id,
        target_membership.group_id,
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
        p_secondary_email_visible,
        p_home_phone_visible,
        p_work_phone_visible,
        p_mobile_phone_visible,
        p_address_listed
      )
      returning * into contact_record;
    end if;
  end if;

  if membership_changed then
    update public.memberships as membership
    set dues_paid = p_dues_paid,
        version = membership.version + 1
    where membership.id = target_membership.id
      and membership.group_id = target_membership.group_id
    returning * into target_membership;
  end if;

  after_state := pg_catalog.jsonb_build_object(
    'membership_id', target_membership.id,
    'membership_version', target_membership.version,
    'status', target_membership.status,
    'role', target_membership.role,
    'dues_paid', target_membership.dues_paid,
    'profile_version', case when profile_record.id is not null then profile_record.version else 0 end,
    'profile_fields', pg_catalog.jsonb_build_object(
      'first_name', profile_record.id is not null,
      'last_name', profile_record.id is not null,
      'spouse_first_name', profile_record.spouse_first_name is not null,
      'spouse_last_name', profile_record.spouse_last_name is not null,
      'tee_location', profile_record.tee_location is not null
    ),
    'contact_version', case when contact_record.id is not null then contact_record.version else 0 end,
    'contact_fields', pg_catalog.jsonb_build_object(
      'secondary_email', contact_record.secondary_email is not null,
      'home_phone', contact_record.home_phone_display is not null,
      'work_phone', contact_record.work_phone_display is not null,
      'mobile_phone', contact_record.mobile_phone_display is not null,
      'address', contact_record.address_line1 is not null
    ),
    'visibility', pg_catalog.jsonb_build_object(
      'secondary_email', coalesce(contact_record.secondary_email_visible, false),
      'home_phone', coalesce(contact_record.home_phone_visible, false),
      'work_phone', coalesce(contact_record.work_phone_visible, false),
      'mobile_phone', coalesce(contact_record.mobile_phone_visible, false),
      'address', coalesce(contact_record.address_listed, false)
    ),
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
    'member.updated',
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
    target_membership.id,
    target_membership.group_id,
    target_membership.version,
    case when profile_record.id is not null then profile_record.version else 0 end,
    case when contact_record.id is not null then contact_record.version else 0 end,
    target_membership.status;
end;
$$;

comment on function public.edit_member(
  uuid, uuid, text, text, text, text, text, boolean, text, text, text, text,
  text, text, text, text, text, text, boolean, boolean, boolean, boolean,
  boolean, bigint, bigint, bigint, text, uuid, uuid
) is
  'Service-only atomic member profile/contact/visibility/dues edit. Role and administrator-only settings are intentionally absent; all changed records use optimistic versions and redacted idempotent audit state.';

revoke all on function public.edit_member(
  uuid, uuid, text, text, text, text, text, boolean, text, text, text, text,
  text, text, text, text, text, text, boolean, boolean, boolean, boolean,
  boolean, bigint, bigint, bigint, text, uuid, uuid
)
from public, anon, authenticated, service_role;
grant execute on function public.edit_member(
  uuid, uuid, text, text, text, text, text, boolean, text, text, text, text,
  text, text, text, text, text, text, boolean, boolean, boolean, boolean,
  boolean, bigint, bigint, bigint, text, uuid, uuid
)
to service_role;

create function public.set_member_status(
  p_actor_user_id uuid,
  p_membership_id uuid,
  p_new_status public.membership_status,
  p_expected_membership_version bigint,
  p_confirmed boolean,
  p_reason text,
  p_correlation_id uuid,
  p_operation_id uuid
)
returns table (
  changed_membership_id app.entity_id,
  changed_group_id app.entity_id,
  membership_version bigint,
  status public.membership_status,
  inactivated_at app.utc_instant,
  cancelled_notification_count bigint
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
  prior_event public.audit_events%rowtype;
  identity_record auth.users%rowtype;
  normalized_reason text;
  request_payload jsonb;
  request_fingerprint text;
  before_state jsonb;
  after_state jsonb;
  now_at timestamptz := pg_catalog.clock_timestamp();
  cancelled_count bigint := 0;
  cancelled_this_delivery bigint := 0;
  delivery_record record;
begin
  if p_actor_user_id is null or p_membership_id is null
    or p_new_status is null
  then
    raise exception 'member_status_context_required' using errcode = '22004';
  end if;

  if p_expected_membership_version is null or p_expected_membership_version < 1 then
    raise exception 'member_membership_version_invalid' using errcode = '22023';
  end if;

  if p_correlation_id is null or p_operation_id is null then
    raise exception 'operation_context_required' using errcode = '22004';
  end if;

  if p_new_status not in ('active', 'inactive') then
    raise exception 'member_status_transition_forbidden' using errcode = '22023';
  end if;

  normalized_reason := nullif(pg_catalog.btrim(p_reason), '');
  if p_confirmed is distinct from true
    or normalized_reason is null
    or pg_catalog.length(normalized_reason) > 500
  then
    raise exception 'member_status_confirmation_required' using errcode = '22023';
  end if;

  request_payload := pg_catalog.jsonb_build_object(
    'membership_id', p_membership_id,
    'new_status', p_new_status,
    'expected_membership_version', p_expected_membership_version,
    'confirmed', p_confirmed,
    'reason', normalized_reason
  );
  request_fingerprint := app.member_request_fingerprint(
    request_payload,
    p_actor_user_id::text || ':' || p_operation_id::text
  );

  select actor.group_id
  into actor_group_id
  from app.resolve_member_management_actor(p_actor_user_id) as actor;
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
    and (identity.banned_until is null or identity.banned_until <= now_at)
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

  if actor_membership.id = target_membership.id then
    raise exception 'member_self_status_change_forbidden' using errcode = 'P0003';
  end if;
  if actor_membership.role = 'coordinator'
    and target_membership.role = 'administrator'
  then
    raise exception 'member_admin_target_forbidden' using errcode = 'P0003';
  end if;
  if target_membership.status not in ('active', 'inactive') then
    raise exception 'member_status_transition_forbidden' using errcode = '22023';
  end if;

  select event.*
  into prior_event
  from public.audit_events as event
  where event.group_id = locked_group.id
    and event.actor_user_id = p_actor_user_id
    and event.action = 'member.status_changed'
    and event.operation_id = p_operation_id;

  if found then
    if (prior_event.after_state ->> 'membership_id')::uuid <> p_membership_id
      or prior_event.after_state ->> 'request_fingerprint' <> request_fingerprint
    then
      raise exception 'operation_id_reused' using errcode = '23505';
    end if;

    return query
    select
      (prior_event.after_state ->> 'membership_id')::app.entity_id,
      prior_event.group_id,
      (prior_event.after_state ->> 'membership_version')::bigint,
      (prior_event.after_state ->> 'status')::public.membership_status,
      (prior_event.after_state ->> 'inactivated_at')::app.utc_instant,
      coalesce((prior_event.after_state ->> 'cancelled_notification_count')::bigint, 0);
    return;
  end if;

  if target_membership.version <> p_expected_membership_version then
    raise exception 'member_membership_version_changed' using errcode = '40001';
  end if;

  if target_membership.status = p_new_status then
    raise exception 'member_status_transition_forbidden' using errcode = '22023';
  end if;

  if p_new_status = 'active' then
    select identity.*
    into identity_record
    from auth.users as identity
    where identity.id = target_membership.user_id;
    if not found
      or target_membership.user_id is null
      or identity_record.email_confirmed_at is null
      or identity_record.deleted_at is not null
      or identity_record.is_anonymous
      or (identity_record.banned_until is not null and identity_record.banned_until > now_at)
    then
      raise exception 'member_identity_unavailable' using errcode = 'P0002';
    end if;
    if not exists (
      select 1
      from public.user_profiles as profile
      where profile.user_id = target_membership.user_id
        and profile.disabled_at is null
    ) then
      raise exception 'member_identity_unavailable' using errcode = 'P0002';
    end if;
  end if;

  before_state := pg_catalog.jsonb_build_object(
    'membership_id', target_membership.id,
    'membership_version', target_membership.version,
    'status', target_membership.status,
    'role', target_membership.role,
    'inactivated_at', target_membership.inactivated_at is not null
  );

  if target_membership.status is distinct from p_new_status then
    update public.memberships as membership
    set status = p_new_status,
        inactivated_at = case when p_new_status = 'inactive' then now_at else null end,
        version = membership.version + 1
    where membership.id = target_membership.id
      and membership.group_id = target_membership.group_id
    returning * into target_membership;
  end if;

  if p_new_status = 'inactive' then
    for delivery_record in
      select delivery.id, delivery.group_id, delivery.outbox_job_id
      from public.notification_deliveries as delivery
      join public.notification_outbox_jobs as outbox
        on outbox.id = delivery.outbox_job_id
       and outbox.group_id = delivery.group_id
      where delivery.group_id = target_membership.group_id
        and (
          delivery.recipient_membership_id = target_membership.id
          or delivery.recipient_user_id = target_membership.user_id
        )
        and delivery.state in ('queued', 'retryable', 'sending')
        and outbox.state in ('queued', 'retryable', 'processing')
      for update of delivery, outbox
    loop
      update public.notification_deliveries as delivery
      set state = 'cancelled',
          failure_reason = 'member_inactive',
          claim_token = null,
          claimed_at = null,
          next_attempt_at = now_at
      where delivery.id = delivery_record.id
        and delivery.group_id = delivery_record.group_id;

      get diagnostics cancelled_this_delivery = row_count;
      cancelled_count := cancelled_count + cancelled_this_delivery;
    end loop;

    -- If a worker had claimed a shared parent while this member's delivery
    -- was sending, release that stale claim so a queued sibling can be picked
    -- up. A parent with no sendable sibling is canceled below instead.
    update public.notification_outbox_jobs as outbox
    set state = 'queued',
        safe_error = null,
        claimed_at = null,
        finished_at = null,
        next_attempt_at = now_at
    where outbox.group_id = target_membership.group_id
      and outbox.state = 'processing'
      and exists (
        select 1
        from public.notification_deliveries as target_delivery
        where target_delivery.group_id = outbox.group_id
          and target_delivery.outbox_job_id = outbox.id
          and (
            target_delivery.recipient_membership_id = target_membership.id
            or target_delivery.recipient_user_id = target_membership.user_id
          )
          and target_delivery.state = 'cancelled'
          and target_delivery.failure_reason = 'member_inactive'
      )
      and exists (
        select 1
        from public.notification_deliveries as remaining_delivery
        where remaining_delivery.group_id = outbox.group_id
          and remaining_delivery.outbox_job_id = outbox.id
          and remaining_delivery.state in ('queued', 'retryable', 'sending')
      );

    -- A single outbox event may fan out to several recipients. Only cancel a
    -- parent event once every one of its deliveries is no longer sendable;
    -- an active recipient must keep the shared job claimable.
    update public.notification_outbox_jobs as outbox
    set state = 'cancelled',
        safe_error = 'member_inactive',
        claimed_at = null,
        finished_at = now_at,
        next_attempt_at = now_at
    where outbox.group_id = target_membership.group_id
      and outbox.state in ('queued', 'retryable', 'processing')
      and exists (
        select 1
        from public.notification_deliveries as target_delivery
        where target_delivery.group_id = outbox.group_id
          and target_delivery.outbox_job_id = outbox.id
          and (
            target_delivery.recipient_membership_id = target_membership.id
            or target_delivery.recipient_user_id = target_membership.user_id
          )
          and target_delivery.state = 'cancelled'
          and target_delivery.failure_reason = 'member_inactive'
      )
      and not exists (
        select 1
        from public.notification_deliveries as remaining_delivery
        where remaining_delivery.group_id = outbox.group_id
          and remaining_delivery.outbox_job_id = outbox.id
          and remaining_delivery.state in ('queued', 'retryable', 'sending')
      );
  end if;

  after_state := pg_catalog.jsonb_build_object(
    'membership_id', target_membership.id,
    'membership_version', target_membership.version,
    'status', target_membership.status,
    'role', target_membership.role,
    'inactivated_at', target_membership.inactivated_at,
    'cancelled_notification_count', cancelled_count,
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
    'member.status_changed',
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
    target_membership.id,
    target_membership.group_id,
    target_membership.version,
    target_membership.status,
    target_membership.inactivated_at,
    cancelled_count;
end;
$$;

comment on function public.set_member_status(uuid, uuid, public.membership_status, bigint, boolean, text, uuid, uuid) is
  'Service-only confirmed/reasoned active-to-inactive or inactive-to-active transition. Tenant and role are server-derived; self, coordinator-to-administrator, pending, stale, and unavailable-identity transitions are refused. Inactivation cancels pending notification work atomically and writes a redacted audit event.';

revoke all on function public.set_member_status(uuid, uuid, public.membership_status, bigint, boolean, text, uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.set_member_status(uuid, uuid, public.membership_status, bigint, boolean, text, uuid, uuid)
to service_role;
