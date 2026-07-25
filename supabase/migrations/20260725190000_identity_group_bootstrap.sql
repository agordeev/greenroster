create type public.membership_role as enum ('member', 'coordinator', 'administrator');
create type public.membership_status as enum ('pending', 'active', 'inactive');

create function app.is_valid_time_zone(value text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from pg_catalog.pg_timezone_names
    where name = value
  );
$$;

create domain app.iana_time_zone as text
  check (app.is_valid_time_zone(value));

create function app.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

revoke all on function app.is_valid_time_zone(text) from public, anon, authenticated;
revoke all on function app.set_updated_at() from public, anon, authenticated;
revoke usage on type app.iana_time_zone from public;

create table public.user_profiles (
  user_id app.entity_id primary key references auth.users (id) on delete restrict,
  display_name text,
  first_name text,
  last_name text,
  accepted_terms_version text,
  accepted_terms_at app.utc_instant,
  accepted_privacy_version text,
  accepted_privacy_at app.utc_instant,
  disabled_at app.utc_instant,
  created_at app.utc_instant not null default pg_catalog.now(),
  updated_at app.utc_instant not null default pg_catalog.now(),
  constraint user_profiles_display_name_not_blank
    check (display_name is null or pg_catalog.btrim(display_name) <> ''),
  constraint user_profiles_first_name_not_blank
    check (first_name is null or pg_catalog.btrim(first_name) <> ''),
  constraint user_profiles_last_name_not_blank
    check (last_name is null or pg_catalog.btrim(last_name) <> ''),
  constraint user_profiles_terms_acceptance_complete
    check ((accepted_terms_version is null) = (accepted_terms_at is null)),
  constraint user_profiles_privacy_acceptance_complete
    check ((accepted_privacy_version is null) = (accepted_privacy_at is null))
);

comment on column public.user_profiles.user_id is
  'Reference to the Auth-owned identity and its globally unique account e-mail; e-mail is intentionally not duplicated here.';
comment on column public.user_profiles.disabled_at is
  'Application profile state without inventing a second authentication authority; Auth remains authoritative for sign-in eligibility.';

create trigger user_profiles_immutable_id
before update of user_id on public.user_profiles
for each row execute function app.reject_id_change('user_id');

create trigger user_profiles_set_updated_at
before update on public.user_profiles
for each row execute function app.set_updated_at();

create table public.groups (
  id app.entity_id primary key default pg_catalog.gen_random_uuid(),
  name text not null,
  time_zone app.iana_time_zone not null,
  onboarding_completed_at app.utc_instant,
  version bigint not null default 1 check (version > 0),
  created_at app.utc_instant not null default pg_catalog.now(),
  updated_at app.utc_instant not null default pg_catalog.now(),
  constraint groups_name_not_blank check (pg_catalog.btrim(name) <> '')
);

comment on column public.groups.onboarding_completed_at is
  'Stored completion marker; the checklist itself is derived from authoritative group configuration and feature records.';

create trigger groups_immutable_id
before update of id on public.groups
for each row execute function app.reject_id_change('id');

create trigger groups_set_updated_at
before update on public.groups
for each row execute function app.set_updated_at();

create table public.memberships (
  id app.entity_id primary key default pg_catalog.gen_random_uuid(),
  group_id app.entity_id not null references public.groups (id) on delete restrict,
  user_id app.entity_id references auth.users (id) on delete restrict,
  role public.membership_role not null,
  status public.membership_status not null,
  dues_paid boolean not null default false,
  initial_quota app.quota_value,
  uses_initial_quota boolean not null default false,
  initial_quota_provenance text,
  invited_at app.utc_instant,
  activated_at app.utc_instant,
  inactivated_at app.utc_instant,
  created_at app.utc_instant not null default pg_catalog.now(),
  updated_at app.utc_instant not null default pg_catalog.now(),
  constraint memberships_active_identity_required
    check (status <> 'active' or user_id is not null),
  constraint memberships_active_date_required
    check (status <> 'active' or activated_at is not null),
  constraint memberships_inactive_date_required
    check (status <> 'inactive' or inactivated_at is not null),
  constraint memberships_initial_quota_consistent
    check (
      (initial_quota is null and initial_quota_provenance is null and not uses_initial_quota)
      or (
        initial_quota is not null
        and initial_quota_provenance is not null
        and pg_catalog.btrim(initial_quota_provenance) <> ''
      )
    )
);

comment on column public.memberships.user_id is
  'Nullable until a pending invitation is attached; v1 permits at most one attached membership for an Auth identity.';

create unique index memberships_one_attached_identity_idx
  on public.memberships (user_id)
  where user_id is not null;
comment on index public.memberships_one_attached_identity_idx is
  'V1 lifetime invariant: an attached identity retains one membership across active and inactive history; pending unattached invitations keep user_id null.';
create index memberships_group_id_idx on public.memberships (group_id);
create index memberships_group_status_idx on public.memberships (group_id, status);

create trigger memberships_immutable_id
before update of id on public.memberships
for each row execute function app.reject_id_change('id');

create trigger memberships_immutable_group
before update of group_id on public.memberships
for each row execute function app.reject_id_change('group_id');

create function app.reject_attached_user_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.user_id is not null and new.user_id is distinct from old.user_id then
    raise exception 'attached membership identity cannot be changed'
      using errcode = '22000';
  end if;

  return new;
end;
$$;

revoke all on function app.reject_attached_user_change() from public, anon, authenticated;

create trigger memberships_immutable_attached_user
before update of user_id on public.memberships
for each row execute function app.reject_attached_user_change();

create trigger memberships_set_updated_at
before update on public.memberships
for each row execute function app.set_updated_at();

create table public.audit_events (
  id app.entity_id primary key default pg_catalog.gen_random_uuid(),
  group_id app.entity_id not null references public.groups (id) on delete restrict,
  actor_user_id app.entity_id references auth.users (id) on delete restrict,
  action text not null check (pg_catalog.btrim(action) <> ''),
  target_type text not null check (pg_catalog.btrim(target_type) <> ''),
  target_id app.entity_id,
  target_version bigint check (target_version is null or target_version > 0),
  before_state jsonb,
  after_state jsonb,
  source text not null check (pg_catalog.btrim(source) <> ''),
  correlation_id uuid not null,
  operation_id uuid,
  reason text,
  occurred_at app.utc_instant not null default pg_catalog.now()
);

comment on table public.audit_events is
  'Append-only investigation record. Action and source values are implementation-contract identifiers, not membership or actor enums.';

create index audit_events_group_occurred_at_idx
  on public.audit_events (group_id, occurred_at desc);
create index audit_events_correlation_id_idx on public.audit_events (correlation_id);
create unique index audit_events_actor_action_operation_idx
  on public.audit_events (actor_user_id, action, operation_id)
  where actor_user_id is not null and operation_id is not null;

create trigger audit_events_immutable_id
before update of id on public.audit_events
for each row execute function app.reject_id_change('id');

create function app.reject_audit_event_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'audit_events_append_only'
    using errcode = 'P0001';
end;
$$;

revoke all on function app.reject_audit_event_mutation() from public, anon, authenticated;

create trigger audit_events_append_only
before update or delete on public.audit_events
for each row execute function app.reject_audit_event_mutation();

create function app.active_group_id()
returns app.entity_id
language sql
stable
security definer
set search_path = ''
as $$
  select membership.group_id
  from public.memberships as membership
  join public.user_profiles as profile on profile.user_id = membership.user_id
  join auth.users as identity on identity.id = membership.user_id
  where membership.user_id = (select auth.uid())
    and membership.status = 'active'
    and profile.disabled_at is null
    and identity.email_confirmed_at is not null
    and identity.deleted_at is null
    and not identity.is_anonymous
    and (identity.banned_until is null or identity.banned_until <= pg_catalog.now())
  limit 1;
$$;

create function app.active_membership_role()
returns public.membership_role
language sql
stable
security definer
set search_path = ''
as $$
  select membership.role
  from public.memberships as membership
  join public.user_profiles as profile on profile.user_id = membership.user_id
  join auth.users as identity on identity.id = membership.user_id
  where membership.user_id = (select auth.uid())
    and membership.status = 'active'
    and profile.disabled_at is null
    and identity.email_confirmed_at is not null
    and identity.deleted_at is null
    and not identity.is_anonymous
    and (identity.banned_until is null or identity.banned_until <= pg_catalog.now())
  limit 1;
$$;

revoke all on function app.active_group_id() from public, anon, authenticated;
revoke all on function app.active_membership_role() from public, anon, authenticated;
grant usage on schema app to authenticated;
grant execute on function app.active_group_id() to authenticated;
grant execute on function app.active_membership_role() to authenticated;

create function public.resolve_identity_context()
returns table (
  membership_id app.entity_id,
  group_id app.entity_id,
  role public.membership_role
)
language sql
stable
security definer
set search_path = ''
as $$
  select membership.id, membership.group_id, membership.role
  from public.memberships as membership
  join public.user_profiles as profile on profile.user_id = membership.user_id
  join auth.users as identity on identity.id = membership.user_id
  where membership.user_id = (select auth.uid())
    and membership.status = 'active'
    and profile.disabled_at is null
    and identity.email_confirmed_at is not null
    and identity.deleted_at is null
    and not identity.is_anonymous
    and (identity.banned_until is null or identity.banned_until <= pg_catalog.now());
$$;

comment on function public.resolve_identity_context() is
  'Returns only the authenticated caller''s active v1 membership. No client-supplied group or role is accepted.';

revoke all on function public.resolve_identity_context() from public, anon;
grant execute on function public.resolve_identity_context() to authenticated;

create function app.reject_last_active_administrator()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  removes_active_administrator boolean;
begin
  removes_active_administrator := old.role = 'administrator'
    and old.status = 'active'
    and (
      tg_op = 'DELETE'
      or new.group_id is distinct from old.group_id
      or new.role <> 'administrator'
      or new.status <> 'active'
    );

  if removes_active_administrator and not exists (
    select 1
    from public.memberships as replacement
    where replacement.group_id = old.group_id
      and replacement.id <> old.id
      and replacement.role = 'administrator'
      and replacement.status = 'active'
  ) then
    raise exception 'last_active_administrator'
      using errcode = 'P0001';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

revoke all on function app.reject_last_active_administrator() from public, anon, authenticated;

create trigger memberships_protect_last_active_administrator
before update or delete on public.memberships
for each row execute function app.reject_last_active_administrator();

create function public.bootstrap_group(
  p_administrator_user_id uuid,
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
  prior_group_id uuid;
begin
  if p_administrator_user_id is null then
    raise exception 'administrator_identity_required' using errcode = '22004';
  end if;

  if p_correlation_id is null or p_operation_id is null then
    raise exception 'operation_context_required' using errcode = '22004';
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
    and event.action = 'group.bootstrap'
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

  insert into public.user_profiles (user_id)
  values (p_administrator_user_id)
  on conflict (user_id) do nothing;

  if exists (
    select 1
    from public.user_profiles as profile
    where profile.user_id = p_administrator_user_id
      and profile.disabled_at is not null
  ) then
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
    'group.bootstrap',
    'group',
    group_record.id,
    group_record.version,
    pg_catalog.jsonb_build_object(
      'group_name', group_record.name,
      'group_time_zone', group_record.time_zone,
      'administrator_membership_id', membership_record.id,
      'membership_role', membership_record.role,
      'membership_status', membership_record.status
    ),
    'server',
    p_correlation_id,
    p_operation_id
  );

  return query select group_record.id, membership_record.id;
end;
$$;

comment on function public.bootstrap_group(uuid, text, text, uuid, uuid) is
  'Server-only atomic bootstrap. The trusted server supplies the already-authenticated, verified identity; application roles have no EXECUTE privilege.';

revoke all on function public.bootstrap_group(uuid, text, text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.bootstrap_group(uuid, text, text, uuid, uuid)
  to service_role;

alter table public.user_profiles enable row level security;
alter table public.user_profiles force row level security;
alter table public.groups enable row level security;
alter table public.groups force row level security;
alter table public.memberships enable row level security;
alter table public.memberships force row level security;
alter table public.audit_events enable row level security;
alter table public.audit_events force row level security;

create policy user_profiles_read_self
on public.user_profiles
for select
to authenticated
using (
  user_id = (select auth.uid())
  and (select app.active_group_id()) is not null
);

create policy groups_read_active_group
on public.groups
for select
to authenticated
using (id = (select app.active_group_id()));

create policy audit_events_read_group_administrator
on public.audit_events
for select
to authenticated
using (
  group_id = (select app.active_group_id())
  and (select app.active_membership_role()) = 'administrator'
);

revoke all on table
  public.user_profiles,
  public.groups,
  public.memberships,
  public.audit_events
from public, anon, authenticated;

grant select on table
  public.user_profiles,
  public.groups,
  public.audit_events
to authenticated;
