create table public.password_recovery_intents (
  state_hash text primary key check (state_hash ~ '^[0-9a-f]{64}$'),
  email_hash text not null check (email_hash ~ '^[0-9a-f]{64}$'),
  code_verifier text not null check (pg_catalog.length(code_verifier) between 43 and 128),
  expires_at app.utc_instant not null,
  consumed_at app.utc_instant,
  created_at app.utc_instant not null default pg_catalog.now(),
  constraint password_recovery_intents_expiry_after_creation
    check (expires_at > created_at),
  constraint password_recovery_intents_consumption_after_creation
    check (consumed_at is null or consumed_at >= created_at)
);

comment on table public.password_recovery_intents is
  'Server-only, expiring proof that a mobile recovery callback originated from a GreenRoster recovery request.';

create table public.identity_security_audit_events (
  id app.entity_id primary key default pg_catalog.gen_random_uuid(),
  user_id app.entity_id not null references auth.users (id) on delete restrict,
  action text not null check (pg_catalog.btrim(action) <> ''),
  target_type text not null check (pg_catalog.btrim(target_type) <> ''),
  target_id app.entity_id,
  after_state jsonb,
  source text not null check (pg_catalog.btrim(source) <> ''),
  correlation_id uuid not null,
  occurred_at app.utc_instant not null default pg_catalog.now()
);

comment on table public.identity_security_audit_events is
  'Server-only append-only security audit for identity events that have no tenant group yet.';

create index identity_security_audit_events_user_occurred_at_idx
  on public.identity_security_audit_events (user_id, occurred_at desc);
create index identity_security_audit_events_correlation_id_idx
  on public.identity_security_audit_events (correlation_id);

create trigger identity_security_audit_events_immutable_id
before update of id on public.identity_security_audit_events
for each row execute function app.reject_id_change('id');

create trigger identity_security_audit_events_append_only
before update or delete on public.identity_security_audit_events
for each row execute function app.reject_audit_event_mutation();

alter table public.identity_security_audit_events enable row level security;
alter table public.identity_security_audit_events force row level security;

revoke all on table public.identity_security_audit_events
from public, anon, authenticated, service_role;
grant select on table public.identity_security_audit_events to service_role;

alter table public.password_recovery_intents enable row level security;
alter table public.password_recovery_intents force row level security;

revoke all on table public.password_recovery_intents
from public, anon, authenticated, service_role;
grant select on table public.password_recovery_intents to service_role;

create function public.create_password_recovery_intent(
  p_state_hash text,
  p_email_hash text,
  p_code_verifier text,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.password_recovery_intents
  where consumed_at is null
    and expires_at <= pg_catalog.clock_timestamp();

  if p_expires_at <= pg_catalog.clock_timestamp()
    or p_expires_at > pg_catalog.clock_timestamp() + interval '15 minutes'
  then
    return false;
  end if;

  insert into public.password_recovery_intents (
    state_hash,
    email_hash,
    code_verifier,
    expires_at
  )
  values (p_state_hash, p_email_hash, p_code_verifier, p_expires_at);
  return true;
end;
$$;

create function public.register_mobile_password_recovery_session(
  p_state_hash text,
  p_email_hash text,
  p_handle_hash text,
  p_reset_operation_id uuid,
  p_session_id uuid,
  p_user_id uuid,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected integer;
  registered boolean;
begin
  if exists (
    select 1
    from public.password_recovery_sessions
    where session_id = p_session_id
      and user_id = p_user_id
      and handle_hash = p_handle_hash
      and reset_operation_id = p_reset_operation_id
  ) then
    return true;
  end if;

  delete from public.password_recovery_intents
  where state_hash = p_state_hash
    and email_hash = p_email_hash
    and consumed_at is null
    and expires_at > pg_catalog.clock_timestamp();
  get diagnostics affected = row_count;
  if affected <> 1 then
    return false;
  end if;

  select public.register_password_recovery_session(
    p_session_id,
    p_user_id,
    p_expires_at
  ) into registered;

  if not registered then
    raise exception 'password_recovery_registration_failed' using errcode = 'P0001';
  end if;

  update public.password_recovery_sessions
  set handle_hash = p_handle_hash,
      reset_operation_id = p_reset_operation_id
  where session_id = p_session_id
    and user_id = p_user_id;

  return true;
end;
$$;

alter table public.password_recovery_sessions
  add column consumed_correlation_id uuid,
  add column handle_hash text check (handle_hash is null or handle_hash ~ '^[0-9a-f]{64}$'),
  add column reset_operation_id uuid;

create unique index password_recovery_sessions_handle_hash_idx
  on public.password_recovery_sessions (handle_hash)
  where handle_hash is not null;

update public.password_recovery_sessions
set consumed_correlation_id = case
      when consumed_at is not null then coalesce(consumed_correlation_id, pg_catalog.gen_random_uuid())
      else consumed_correlation_id
    end,
    reset_operation_id = coalesce(reset_operation_id, pg_catalog.gen_random_uuid());

alter table public.password_recovery_sessions
  alter column reset_operation_id set not null;

create or replace function public.register_password_recovery_session(
  p_session_id uuid,
  p_user_id uuid,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_expires_at <= pg_catalog.clock_timestamp()
    or p_expires_at > pg_catalog.clock_timestamp() + interval '15 minutes'
  then
    return false;
  end if;

  insert into public.password_recovery_sessions (
    session_id,
    user_id,
    expires_at,
    reset_operation_id
  )
  values (p_session_id, p_user_id, p_expires_at, pg_catalog.gen_random_uuid());
  return true;
end;
$$;

alter table public.password_recovery_sessions
  add constraint password_recovery_sessions_consumption_correlation_complete
  check (consumed_at is null or consumed_correlation_id is not null);

create function app.is_password_recovery_session()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.password_recovery_sessions as recovery
    where recovery.session_id::text = (select auth.jwt() ->> 'session_id')
      and recovery.user_id = (select auth.uid())
  );
$$;

comment on function app.is_password_recovery_session() is
  'Returns true for every registered Auth session, including expired and consumed recovery sessions.';

revoke all on function app.is_password_recovery_session()
from public, anon, authenticated, service_role;

create or replace function app.active_group_id()
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
    and not (select app.is_password_recovery_session())
  limit 1;
$$;

create or replace function app.active_membership_role()
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
    and not (select app.is_password_recovery_session())
  limit 1;
$$;

create or replace function public.resolve_identity_context()
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
    and (identity.banned_until is null or identity.banned_until <= pg_catalog.now())
    and not (select app.is_password_recovery_session());
$$;

revoke all on function public.create_password_recovery_intent(text, text, text, timestamptz)
from public, anon, authenticated;
revoke all on function public.register_mobile_password_recovery_session(text, text, text, uuid, uuid, uuid, timestamptz)
from public, anon, authenticated;

grant execute on function public.create_password_recovery_intent(text, text, text, timestamptz)
to service_role;
grant execute on function public.register_mobile_password_recovery_session(text, text, text, uuid, uuid, uuid, timestamptz)
to service_role;

revoke all on function public.consume_password_recovery_session(uuid, uuid, uuid, timestamptz)
from public, anon, authenticated, service_role;

drop function public.consume_password_recovery_session(uuid, uuid, uuid, timestamptz);

create function public.consume_password_recovery_session(
  p_session_id uuid,
  p_user_id uuid,
  p_claim_id uuid,
  p_consumed_at timestamptz,
  p_correlation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected integer;
  recovery_group_id uuid;
  prior_consumed_at timestamptz;
  prior_consumed_correlation_id uuid;
  prior_claim_id uuid;
begin
  if p_correlation_id is null then
    raise exception 'recovery_correlation_required' using errcode = '22004';
  end if;

  update public.password_recovery_sessions
  set consumed_at = p_consumed_at
    , consumed_correlation_id = p_correlation_id
  where session_id = p_session_id
    and user_id = p_user_id
    and claim_id = p_claim_id
    and consumed_at is null;
  get diagnostics affected = row_count;

  if affected = 1 then
    select membership.group_id
    into recovery_group_id
    from public.memberships as membership
    where membership.user_id = p_user_id
    limit 1;

    if recovery_group_id is not null then
      insert into public.audit_events (
        group_id,
        actor_user_id,
        action,
        target_type,
        target_id,
        after_state,
        source,
        correlation_id
      )
      values (
        recovery_group_id,
        p_user_id,
        'identity.password_recovered',
        'user',
        p_user_id,
        pg_catalog.jsonb_build_object('recovery_session_consumed', true),
        'server',
        p_correlation_id
      );
    else
      insert into public.identity_security_audit_events (
        user_id,
        action,
        target_type,
        target_id,
        after_state,
        source,
        correlation_id
      )
      values (
        p_user_id,
        'identity.password_recovered',
        'user',
        p_user_id,
        pg_catalog.jsonb_build_object('recovery_session_consumed', true),
        'server',
        p_correlation_id
      );
    end if;

    return true;
  end if;

  select consumed_at, consumed_correlation_id, claim_id
  into prior_consumed_at, prior_consumed_correlation_id, prior_claim_id
  from public.password_recovery_sessions
  where session_id = p_session_id
    and user_id = p_user_id;

  return prior_consumed_at is not null
    and prior_consumed_correlation_id = p_correlation_id
    and prior_claim_id = p_claim_id;
end;
$$;

revoke all on function public.consume_password_recovery_session(uuid, uuid, uuid, timestamptz, uuid)
from public, anon, authenticated;

grant execute on function public.consume_password_recovery_session(uuid, uuid, uuid, timestamptz, uuid)
to service_role;
