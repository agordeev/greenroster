-- Phase 04: member notification preference and push-device boundaries.
--
-- This migration records preference and device state only.  The existing
-- e-mail delivery/outbox tables remain unchanged; a later delivery slice will
-- add push sends and provider feedback.

create type public.notification_preference_category as enum (
  'membership_invitation',
  'round_published',
  'rsvp_reminder',
  'round_details_changed',
  'round_cancelled',
  'scoring_opened',
  'results_published',
  'round_awaiting_completion',
  'invitation_delivery_failed',
  'role_changed'
);

create type public.notification_preference_channel as enum ('email', 'push');

create type public.push_device_platform as enum ('ios', 'android');

-- This is a global, immutable policy catalogue.  Preference rows reference it
-- so unsupported category/channel combinations cannot be persisted.
create table public.notification_category_policies (
  category public.notification_preference_category primary key,
  mandatory boolean not null,
  email_allowed boolean not null,
  push_allowed boolean not null,
  default_email_enabled boolean not null,
  default_push_enabled boolean not null,
  constraint notification_category_policy_default_channels_allowed check (
    (default_email_enabled = false or email_allowed)
    and (default_push_enabled = false or push_allowed)
  ),
  constraint notification_category_policy_mandatory_has_default check (
    not mandatory or (
      (not email_allowed or default_email_enabled)
      and (not push_allowed or default_push_enabled)
    )
  )
);

insert into public.notification_category_policies (
  category,
  mandatory,
  email_allowed,
  push_allowed,
  default_email_enabled,
  default_push_enabled
)
values
  ('membership_invitation', true,  true,  false, true,  false),
  ('round_published', false, true,  true,  true,  true),
  ('rsvp_reminder', false, true,  true,  true,  true),
  ('round_details_changed', false, true,  true,  true,  true),
  ('round_cancelled', true,  true,  true,  true,  true),
  ('scoring_opened', false, false, true,  false, true),
  ('results_published', false, true,  true,  true,  true),
  ('round_awaiting_completion', true,  true,  true,  true,  true),
  ('invitation_delivery_failed', true,  true,  false, true,  false),
  ('role_changed', true,  true,  false, true,  false);

create table public.notification_preferences (
  membership_id app.entity_id not null,
  group_id app.entity_id not null,
  category public.notification_preference_category not null,
  email_enabled boolean not null,
  push_enabled boolean not null,
  version bigint not null default 1,
  created_at app.utc_instant not null default pg_catalog.now(),
  updated_at app.utc_instant not null default pg_catalog.now(),
  primary key (membership_id, category),
  constraint notification_preferences_membership_group_fk
    foreign key (membership_id, group_id)
    references public.memberships (id, group_id)
    on delete restrict,
  constraint notification_preferences_category_fk
    foreign key (category)
    references public.notification_category_policies (category)
    on delete restrict,
  constraint notification_preferences_version_positive check (version > 0)
);

comment on table public.notification_preferences is
  'Member-owned category/channel choices. Mandatory channels remain enabled through the validated server boundary.';

create trigger notification_preferences_immutable_membership
before update of membership_id on public.notification_preferences
for each row execute function app.reject_id_change('membership_id');

create trigger notification_preferences_immutable_group
before update of group_id on public.notification_preferences
for each row execute function app.reject_id_change('group_id');

create trigger notification_preferences_set_updated_at
before update on public.notification_preferences
for each row execute function app.set_updated_at();

create function app.validate_notification_preference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  policy_record public.notification_category_policies%rowtype;
begin
  select policy.*
  into policy_record
  from public.notification_category_policies as policy
  where policy.category = new.category;

  if not found then
    raise exception 'notification_preference_category_invalid'
      using errcode = '22023';
  end if;

  if (new.email_enabled and not policy_record.email_allowed)
    or (new.push_enabled and not policy_record.push_allowed)
  then
    raise exception 'notification_preference_channel_forbidden'
      using errcode = '22023';
  end if;

  if policy_record.mandatory
    and (
      (policy_record.email_allowed and not new.email_enabled)
      or (policy_record.push_allowed and not new.push_enabled)
    )
  then
    raise exception 'notification_preference_mandatory'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

revoke all on function app.validate_notification_preference()
from public, anon, authenticated, service_role;

create trigger notification_preferences_validate
before insert or update of category, email_enabled, push_enabled
on public.notification_preferences
for each row execute function app.validate_notification_preference();

create table public.push_devices (
  device_id app.entity_id primary key,
  user_id app.entity_id not null references auth.users (id) on delete restrict,
  expo_push_token text not null,
  platform public.push_device_platform not null,
  last_seen_at app.utc_instant not null,
  active boolean not null default true,
  retired_at app.utc_instant,
  retirement_reason text,
  retirement_correlation_id uuid,
  version bigint not null default 1,
  created_at app.utc_instant not null default pg_catalog.now(),
  updated_at app.utc_instant not null default pg_catalog.now(),
  constraint push_devices_token_valid check (
    pg_catalog.btrim(expo_push_token) = expo_push_token
    and pg_catalog.length(expo_push_token) between 1 and 512
    and expo_push_token !~ '[[:space:]]'
  ),
  constraint push_devices_version_positive check (version > 0),
  constraint push_devices_retirement_state check (
    (
      active
      and retired_at is null
      and retirement_reason is null
      and retirement_correlation_id is null
    )
    or (
      not active
      and retired_at is not null
      and retirement_reason in ('signed_out', 'membership_inactive', 'provider_invalid', 'replaced')
      and retirement_correlation_id is not null
    )
  )
);

comment on table public.push_devices is
  'One authenticated user-owned Expo token per install-scoped device. Raw tokens are never copied to audit or notification payloads.';

create unique index push_devices_expo_push_token_unique
on public.push_devices (expo_push_token);

create index push_devices_user_active_idx
on public.push_devices (user_id, active, last_seen_at desc);

create trigger push_devices_immutable_device_id
before update of device_id on public.push_devices
for each row execute function app.reject_id_change('device_id');

create function app.reject_push_device_user_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.user_id is distinct from new.user_id
    and coalesce(pg_catalog.current_setting('greenroster.push_device_handoff', true), '') <> 'on'
  then
    raise exception 'user_id immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function app.reject_push_device_user_change()
from public, anon, authenticated, service_role;

create trigger push_devices_immutable_user_id
before update of user_id on public.push_devices
for each row execute function app.reject_push_device_user_change();

create trigger push_devices_set_updated_at
before update on public.push_devices
for each row execute function app.set_updated_at();

-- A revoked/inactive membership must stop its devices in the same transaction
-- as the membership transition.  This trigger also covers trusted status
-- mutations that predate this device table.
create function app.retire_push_devices_for_inactive_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  configured_correlation uuid;
begin
  if new.status <> 'active' and old.status = 'active' and new.user_id is not null then
    begin
      configured_correlation := nullif(
        pg_catalog.current_setting('greenroster.correlation_id', true),
        ''
      )::uuid;
    exception when others then
      configured_correlation := null;
    end;
    configured_correlation := coalesce(configured_correlation, pg_catalog.gen_random_uuid());

    with retired_devices as (
      update public.push_devices as device
      set active = false,
          retired_at = pg_catalog.clock_timestamp(),
          retirement_reason = 'membership_inactive',
          retirement_correlation_id = configured_correlation,
          version = device.version + 1
      where device.user_id = new.user_id
        and device.active
      returning
        device.device_id,
        device.platform,
        device.last_seen_at,
        device.retired_at,
        device.retirement_reason,
        device.retirement_correlation_id,
        device.version
    )
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
    select
      new.group_id,
      (select auth.uid())::app.entity_id,
      'member.push_device_retired',
      'push_device',
      retired.device_id,
      retired.version,
      pg_catalog.jsonb_build_object(
        'device_id', retired.device_id,
        'platform', retired.platform,
        'active', true,
        'version', retired.version - 1
      ),
      pg_catalog.jsonb_build_object(
        'device_id', retired.device_id,
        'platform', retired.platform,
        'active', false,
        'last_seen_at', retired.last_seen_at,
        'retired_at', retired.retired_at,
        'retirement_reason', retired.retirement_reason,
        'retirement_correlation_id', retired.retirement_correlation_id,
        'version', retired.version
      ),
      'membership_status_trigger',
      retired.retirement_correlation_id,
      null,
      'membership_inactive'
    from retired_devices as retired;
  end if;
  return new;
end;
$$;

revoke all on function app.retire_push_devices_for_inactive_member()
from public, anon, authenticated, service_role;

create trigger memberships_retire_push_devices
after update of status on public.memberships
for each row execute function app.retire_push_devices_for_inactive_member();

alter table public.notification_category_policies enable row level security;
alter table public.notification_category_policies force row level security;
alter table public.notification_preferences enable row level security;
alter table public.notification_preferences force row level security;
alter table public.push_devices enable row level security;
alter table public.push_devices force row level security;

revoke all on table
  public.notification_category_policies,
  public.notification_preferences,
  public.push_devices
from public, anon, authenticated, service_role;

create function app.resolve_notification_actor()
returns table (
  membership_id app.entity_id,
  group_id app.entity_id,
  user_id app.entity_id,
  role public.membership_role,
  membership_version bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  actor_user_id uuid := (select auth.uid());
begin
  if actor_user_id is null then
    raise exception 'identity_context_unavailable' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from auth.users as identity
    where identity.id = actor_user_id
      and coalesce(identity.raw_app_meta_data, '{}'::jsonb) ? 'greenroster_password_recovery'
  ) then
    raise exception 'recovery_session_forbidden' using errcode = 'P0003';
  end if;

  return query
  select membership.id,
         membership.group_id,
         membership.user_id,
         membership.role,
         membership.version
  from public.memberships as membership
  join public.user_profiles as profile on profile.user_id = membership.user_id
  join auth.users as identity on identity.id = membership.user_id
  where membership.user_id = actor_user_id
    and membership.status = 'active'
    and profile.disabled_at is null
    and identity.email_confirmed_at is not null
    and identity.deleted_at is null
    and not identity.is_anonymous
    and not (coalesce(identity.raw_app_meta_data, '{}'::jsonb) ? 'greenroster_password_recovery')
    and (identity.banned_until is null or identity.banned_until <= pg_catalog.statement_timestamp());

  if not found then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;
end;
$$;

revoke all on function app.resolve_notification_actor()
from public, anon, authenticated, service_role;

create function public.resolve_mobile_member_notification_preferences()
returns table (
  membership_id app.entity_id,
  group_id app.entity_id,
  category public.notification_preference_category,
  mandatory boolean,
  email_allowed boolean,
  push_allowed boolean,
  email_enabled boolean,
  push_enabled boolean,
  version bigint,
  updated_at app.utc_instant
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  actor record;
begin
  select * into actor from app.resolve_notification_actor() limit 1;

  return query
  select actor.membership_id,
         actor.group_id,
         policy.category,
         policy.mandatory,
         policy.email_allowed,
         policy.push_allowed,
         coalesce(preference.email_enabled, policy.default_email_enabled),
         coalesce(preference.push_enabled, policy.default_push_enabled),
         coalesce(preference.version, 0),
         preference.updated_at
  from public.notification_category_policies as policy
  left join public.notification_preferences as preference
    on preference.membership_id = actor.membership_id
   and preference.group_id = actor.group_id
   and preference.category = policy.category
  order by policy.category;
end;
$$;

comment on function public.resolve_mobile_member_notification_preferences() is
  'Returns every notification category for the authenticated active verified member, with mandatory and channel capabilities derived by the server.';

revoke all on function public.resolve_mobile_member_notification_preferences()
from public, anon, service_role;
grant execute on function public.resolve_mobile_member_notification_preferences() to authenticated;

create function public.set_mobile_member_notification_preference(
  p_category public.notification_preference_category,
  p_channel public.notification_preference_channel,
  p_enabled boolean,
  p_expected_preference_version bigint,
  p_correlation_id uuid,
  p_operation_id uuid
)
returns table (
  membership_id app.entity_id,
  group_id app.entity_id,
  category public.notification_preference_category,
  email_enabled boolean,
  push_enabled boolean,
  version bigint,
  updated_at app.utc_instant
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  actor record;
  locked_membership public.memberships%rowtype;
  policy_record public.notification_category_policies%rowtype;
  preference_record public.notification_preferences%rowtype;
  saved_preference public.notification_preferences%rowtype;
  prior_event public.audit_events%rowtype;
  request_payload jsonb;
  request_fingerprint text;
  before_state jsonb;
  after_state jsonb;
  actor_user_id uuid := (select auth.uid());
  now_at timestamptz := pg_catalog.clock_timestamp();
  requested_email_enabled boolean;
  requested_push_enabled boolean;
begin
  if p_category is null or p_channel is null or p_enabled is null then
    raise exception 'notification_preference_context_required' using errcode = '22004';
  end if;
  if p_correlation_id is null or p_operation_id is null then
    raise exception 'operation_context_required' using errcode = '22004';
  end if;
  if p_expected_preference_version is null or p_expected_preference_version < 0 then
    raise exception 'notification_preference_version_invalid' using errcode = '22023';
  end if;

  select policy.*
  into policy_record
  from public.notification_category_policies as policy
  where policy.category = p_category;
  if not found then
    raise exception 'notification_preference_category_invalid' using errcode = '22023';
  end if;

  if (p_channel = 'email' and not policy_record.email_allowed)
    or (p_channel = 'push' and not policy_record.push_allowed)
  then
    raise exception 'notification_preference_channel_forbidden' using errcode = '22023';
  end if;

  if p_enabled = false and policy_record.mandatory then
    raise exception 'notification_preference_mandatory' using errcode = '22023';
  end if;

  select * into actor from app.resolve_notification_actor() limit 1;
  perform 1 from public.groups where id = actor.group_id for update;

  select membership.*
  into locked_membership
  from public.memberships as membership
  join public.user_profiles as profile on profile.user_id = membership.user_id
  join auth.users as identity on identity.id = membership.user_id
  where membership.id = actor.membership_id
    and membership.group_id = actor.group_id
    and membership.user_id = actor_user_id
    and membership.status = 'active'
    and profile.disabled_at is null
    and identity.email_confirmed_at is not null
    and identity.deleted_at is null
    and not identity.is_anonymous
    and not (coalesce(identity.raw_app_meta_data, '{}'::jsonb) ? 'greenroster_password_recovery')
    and (identity.banned_until is null or identity.banned_until <= now_at)
  for update of membership;
  if not found or locked_membership.id is null then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  request_payload := pg_catalog.jsonb_build_object(
    'category', p_category::text,
    'channel', p_channel::text,
    'enabled', p_enabled,
    'expected_preference_version', p_expected_preference_version
  );
  request_fingerprint := app.member_request_fingerprint(
    request_payload,
    actor_user_id::text || ':' || p_operation_id::text
  );

  select event.*
  into prior_event
  from public.audit_events as event
  where event.group_id = actor.group_id
    and event.actor_user_id = actor_user_id
    and event.action = 'member.notification_preference_changed'
    and event.operation_id = p_operation_id;
  if found then
    if prior_event.after_state ->> 'request_fingerprint' <> request_fingerprint then
      raise exception 'operation_id_reused' using errcode = '23505';
    end if;
    return query
    select
      (prior_event.after_state ->> 'membership_id')::app.entity_id,
      prior_event.group_id,
      (prior_event.after_state ->> 'category')::public.notification_preference_category,
      (prior_event.after_state ->> 'email_enabled')::boolean,
      (prior_event.after_state ->> 'push_enabled')::boolean,
      (prior_event.after_state ->> 'version')::bigint,
      (prior_event.after_state ->> 'updated_at')::app.utc_instant;
    return;
  end if;

  select preference.*
  into preference_record
  from public.notification_preferences as preference
  where preference.membership_id = locked_membership.id
    and preference.group_id = locked_membership.group_id
    and preference.category = p_category
  for update;

  if found then
    if preference_record.version <> p_expected_preference_version then
      raise exception 'notification_preference_version_changed' using errcode = '40001';
    end if;
    before_state := pg_catalog.jsonb_build_object(
      'membership_id', preference_record.membership_id,
      'category', preference_record.category,
      'email_enabled', preference_record.email_enabled,
      'push_enabled', preference_record.push_enabled,
      'version', preference_record.version
    );
    requested_email_enabled := preference_record.email_enabled;
    requested_push_enabled := preference_record.push_enabled;
    if p_channel = 'email' then
      requested_email_enabled := p_enabled;
    else
      requested_push_enabled := p_enabled;
    end if;
    update public.notification_preferences as preference
    set email_enabled = requested_email_enabled,
        push_enabled = requested_push_enabled,
        version = preference.version + 1
    where preference.membership_id = preference_record.membership_id
      and preference.category = preference_record.category
    returning * into saved_preference;
  else
    if p_expected_preference_version <> 0 then
      raise exception 'notification_preference_version_changed' using errcode = '40001';
    end if;
    requested_email_enabled := policy_record.default_email_enabled;
    requested_push_enabled := policy_record.default_push_enabled;
    if p_channel = 'email' then
      requested_email_enabled := p_enabled;
    else
      requested_push_enabled := p_enabled;
    end if;
    insert into public.notification_preferences (
      membership_id,
      group_id,
      category,
      email_enabled,
      push_enabled,
      version
    )
    values (
      locked_membership.id,
      locked_membership.group_id,
      p_category,
      requested_email_enabled,
      requested_push_enabled,
      1
    )
    returning * into saved_preference;
    before_state := pg_catalog.jsonb_build_object(
      'membership_id', locked_membership.id,
      'category', p_category,
      'email_enabled', policy_record.default_email_enabled,
      'push_enabled', policy_record.default_push_enabled,
      'version', 0
    );
  end if;

  after_state := pg_catalog.jsonb_build_object(
    'membership_id', saved_preference.membership_id,
    'category', saved_preference.category,
    'email_enabled', saved_preference.email_enabled,
    'push_enabled', saved_preference.push_enabled,
    'version', saved_preference.version,
    'updated_at', saved_preference.updated_at,
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
    operation_id
  )
  values (
    saved_preference.group_id,
    actor_user_id,
    'member.notification_preference_changed',
    'notification_preference',
    saved_preference.membership_id,
    saved_preference.version,
    before_state,
    after_state,
    'mobile',
    p_correlation_id,
    p_operation_id
  );

  return query
  select saved_preference.membership_id,
         saved_preference.group_id,
         saved_preference.category,
         saved_preference.email_enabled,
         saved_preference.push_enabled,
         saved_preference.version,
         saved_preference.updated_at;
end;
$$;

comment on function public.set_mobile_member_notification_preference(public.notification_preference_category, public.notification_preference_channel, boolean, bigint, uuid, uuid) is
  'Updates one channel for the authenticated active verified member. Tenant, membership, defaults, and mandatory-category enforcement are server-derived.';

revoke all on function public.set_mobile_member_notification_preference(public.notification_preference_category, public.notification_preference_channel, boolean, bigint, uuid, uuid)
from public, anon, service_role;
grant execute on function public.set_mobile_member_notification_preference(public.notification_preference_category, public.notification_preference_channel, boolean, bigint, uuid, uuid)
to authenticated;

create function public.register_mobile_push_device(
  p_device_id uuid,
  p_expo_push_token text,
  p_platform public.push_device_platform,
  p_correlation_id uuid,
  p_operation_id uuid
)
returns table (
  device_id app.entity_id,
  user_id app.entity_id,
  platform public.push_device_platform,
  active boolean,
  last_seen_at app.utc_instant,
  version bigint
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  actor record;
  locked_membership public.memberships%rowtype;
  existing_device public.push_devices%rowtype;
  token_device public.push_devices%rowtype;
  saved_device public.push_devices%rowtype;
  prior_event public.audit_events%rowtype;
  request_payload jsonb;
  request_fingerprint text;
  before_state jsonb;
  after_state jsonb;
  device_handoff boolean := false;
  actor_user_id uuid := (select auth.uid());
  normalized_token text := nullif(pg_catalog.btrim(p_expo_push_token), '');
  now_at timestamptz := pg_catalog.clock_timestamp();
begin
  if p_device_id is null or p_platform is null or normalized_token is null then
    raise exception 'push_device_context_required' using errcode = '22004';
  end if;
  if p_correlation_id is null or p_operation_id is null then
    raise exception 'operation_context_required' using errcode = '22004';
  end if;
  if normalized_token <> p_expo_push_token
    or pg_catalog.length(normalized_token) > 512
    or normalized_token ~ '[[:space:]]'
  then
    raise exception 'push_device_token_invalid' using errcode = '22023';
  end if;

  select * into actor from app.resolve_notification_actor() limit 1;
  perform 1 from public.groups where id = actor.group_id for update;

  -- Revalidate after group serialization so a concurrent membership
  -- inactivation cannot register a new token for a revoked member.
  select membership.*
  into locked_membership
  from public.memberships as membership
  join public.user_profiles as profile on profile.user_id = membership.user_id
  join auth.users as identity on identity.id = membership.user_id
  where membership.id = actor.membership_id
    and membership.group_id = actor.group_id
    and membership.user_id = actor_user_id
    and membership.status = 'active'
    and profile.disabled_at is null
    and identity.email_confirmed_at is not null
    and identity.deleted_at is null
    and not identity.is_anonymous
    and not (coalesce(identity.raw_app_meta_data, '{}'::jsonb) ? 'greenroster_password_recovery')
    and (identity.banned_until is null or identity.banned_until <= now_at)
  for update of membership;
  if not found or locked_membership.id is null then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  request_payload := pg_catalog.jsonb_build_object(
    'device_id', p_device_id,
    'expo_push_token', normalized_token,
    'platform', p_platform::text
  );
  request_fingerprint := app.member_request_fingerprint(
    request_payload,
    actor_user_id::text || ':' || p_operation_id::text
  );

  select event.*
  into prior_event
  from public.audit_events as event
  where event.group_id = actor.group_id
    and event.actor_user_id = actor_user_id
    and event.action = 'member.push_device_registered'
    and event.operation_id = p_operation_id;
  if found then
    if prior_event.after_state ->> 'request_fingerprint' <> request_fingerprint then
      raise exception 'operation_id_reused' using errcode = '23505';
    end if;
    return query
    select
      (prior_event.after_state ->> 'device_id')::app.entity_id,
      actor_user_id::app.entity_id,
      (prior_event.after_state ->> 'platform')::public.push_device_platform,
      (prior_event.after_state ->> 'active')::boolean,
      (prior_event.after_state ->> 'last_seen_at')::app.utc_instant,
      (prior_event.after_state ->> 'version')::bigint;
    return;
  end if;

  select device.*
  into existing_device
  from public.push_devices as device
  where device.device_id = p_device_id
  for update;
  if found and existing_device.user_id <> actor_user_id then
    if existing_device.active or existing_device.expo_push_token <> normalized_token then
      raise exception 'push_device_unavailable' using errcode = 'P0003';
    end if;
    device_handoff := true;
  end if;

  select device.*
  into token_device
  from public.push_devices as device
  where device.expo_push_token = normalized_token
  for update;
  if found and token_device.device_id <> p_device_id then
    raise exception 'push_device_token_in_use' using errcode = '23505';
  end if;

  if existing_device.device_id is not null then
    before_state := pg_catalog.jsonb_build_object(
      'device_id', existing_device.device_id,
      'platform', existing_device.platform,
      'active', existing_device.active,
      'retired_at', existing_device.retired_at,
      'retirement_reason', existing_device.retirement_reason,
      'version', existing_device.version,
      'handoff', device_handoff
    );
  end if;

  if existing_device.device_id is null then
    insert into public.push_devices (
      device_id,
      user_id,
      expo_push_token,
      platform,
      last_seen_at,
      active,
      version
    )
    values (
      p_device_id,
      actor_user_id::app.entity_id,
      normalized_token,
      p_platform,
      now_at,
      true,
      1
    )
    returning * into saved_device;
  else
    if device_handoff then
      perform pg_catalog.set_config('greenroster.push_device_handoff', 'on', true);
    end if;

    update public.push_devices as device
    set user_id = actor_user_id::app.entity_id,
        expo_push_token = normalized_token,
        platform = p_platform,
        last_seen_at = now_at,
        active = true,
        retired_at = null,
        retirement_reason = null,
        retirement_correlation_id = null,
        version = device.version + 1
    where device.device_id = existing_device.device_id
    returning * into saved_device;

    if device_handoff then
      perform pg_catalog.set_config('greenroster.push_device_handoff', 'off', true);
    end if;
  end if;

  after_state := pg_catalog.jsonb_build_object(
    'device_id', saved_device.device_id,
    'platform', saved_device.platform,
    'active', saved_device.active,
    'last_seen_at', saved_device.last_seen_at,
    'retired_at', saved_device.retired_at,
    'retirement_reason', saved_device.retirement_reason,
    'retirement_correlation_id', saved_device.retirement_correlation_id,
    'version', saved_device.version,
    'handoff', device_handoff,
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
    operation_id
  )
  values (
    actor.group_id,
    actor_user_id,
    'member.push_device_registered',
    'push_device',
    saved_device.device_id,
    saved_device.version,
    before_state,
    after_state,
    'mobile',
    p_correlation_id,
    p_operation_id
  );

  return query
  select saved_device.device_id,
         saved_device.user_id,
         saved_device.platform,
         saved_device.active,
         saved_device.last_seen_at,
         saved_device.version;
end;
$$;

comment on function public.register_mobile_push_device(uuid, text, public.push_device_platform, uuid, uuid) is
  'Registers or refreshes one Expo token for the authenticated active verified user. Active ownership cannot cross identities; a signed-out inactive install may be reclaimed only with its original token.';

revoke all on function public.register_mobile_push_device(uuid, text, public.push_device_platform, uuid, uuid)
from public, anon, service_role;
grant execute on function public.register_mobile_push_device(uuid, text, public.push_device_platform, uuid, uuid)
to authenticated;

create function public.retire_mobile_push_device(
  p_device_id uuid,
  p_correlation_id uuid,
  p_operation_id uuid
)
returns table (
  device_id app.entity_id,
  user_id app.entity_id,
  platform public.push_device_platform,
  active boolean,
  last_seen_at app.utc_instant,
  version bigint
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  actor record;
  device_record public.push_devices%rowtype;
  saved_device public.push_devices%rowtype;
  prior_event public.audit_events%rowtype;
  request_payload jsonb;
  request_fingerprint text;
  after_state jsonb;
  actor_user_id uuid := (select auth.uid());
begin
  if p_device_id is null then
    raise exception 'push_device_context_required' using errcode = '22004';
  end if;
  if p_correlation_id is null or p_operation_id is null then
    raise exception 'operation_context_required' using errcode = '22004';
  end if;

  select * into actor from app.resolve_notification_actor() limit 1;
  perform 1 from public.groups where id = actor.group_id for update;

  request_payload := pg_catalog.jsonb_build_object('device_id', p_device_id);
  request_fingerprint := app.member_request_fingerprint(
    request_payload,
    actor_user_id::text || ':' || p_operation_id::text
  );

  select event.*
  into prior_event
  from public.audit_events as event
  where event.group_id = actor.group_id
    and event.actor_user_id = actor_user_id
    and event.action = 'member.push_device_retired'
    and event.operation_id = p_operation_id;
  if found then
    if prior_event.after_state ->> 'request_fingerprint' <> request_fingerprint then
      raise exception 'operation_id_reused' using errcode = '23505';
    end if;
    return query
    select
      (prior_event.after_state ->> 'device_id')::app.entity_id,
      actor_user_id::app.entity_id,
      (prior_event.after_state ->> 'platform')::public.push_device_platform,
      (prior_event.after_state ->> 'active')::boolean,
      (prior_event.after_state ->> 'last_seen_at')::app.utc_instant,
      (prior_event.after_state ->> 'version')::bigint;
    return;
  end if;

  select device.*
  into device_record
  from public.push_devices as device
  where device.device_id = p_device_id
    and device.user_id = actor_user_id
  for update;
  if not found then
    raise exception 'push_device_not_found' using errcode = 'P0002';
  end if;

  if device_record.active then
    update public.push_devices as device
    set active = false,
        retired_at = pg_catalog.clock_timestamp(),
        retirement_reason = 'signed_out',
        retirement_correlation_id = p_correlation_id,
        version = device.version + 1
    where device.device_id = device_record.device_id
      and device.user_id = actor_user_id
    returning * into saved_device;
  else
    saved_device := device_record;
  end if;

  after_state := pg_catalog.jsonb_build_object(
    'device_id', saved_device.device_id,
    'platform', saved_device.platform,
    'active', saved_device.active,
    'last_seen_at', saved_device.last_seen_at,
    'retired_at', saved_device.retired_at,
    'retirement_reason', saved_device.retirement_reason,
    'retirement_correlation_id', saved_device.retirement_correlation_id,
    'version', saved_device.version,
    'request_fingerprint', request_fingerprint
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
    actor.group_id,
    actor_user_id,
    'member.push_device_retired',
    'push_device',
    saved_device.device_id,
    saved_device.version,
    after_state,
    'mobile',
    p_correlation_id,
    p_operation_id
  );

  return query
  select saved_device.device_id,
         saved_device.user_id,
         saved_device.platform,
         saved_device.active,
         saved_device.last_seen_at,
         saved_device.version;
end;
$$;

comment on function public.retire_mobile_push_device(uuid, uuid, uuid) is
  'Retires only the authenticated user''s device. Repeated retirement is idempotent and stores no raw token in audit state.';

revoke all on function public.retire_mobile_push_device(uuid, uuid, uuid)
from public, anon, service_role;
grant execute on function public.retire_mobile_push_device(uuid, uuid, uuid)
to authenticated;
