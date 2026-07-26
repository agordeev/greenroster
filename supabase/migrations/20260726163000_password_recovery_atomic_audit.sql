alter table public.identity_security_audit_events
add column operation_id uuid;

create unique index identity_security_audit_events_user_action_operation_idx
on public.identity_security_audit_events (user_id, action, operation_id)
where operation_id is not null;

create function app.finalize_password_recovery_claim(
  p_session_id uuid,
  p_user_id uuid,
  p_claim_id uuid,
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
begin
  update public.password_recovery_sessions
  set consumed_at = pg_catalog.clock_timestamp(),
      consumed_correlation_id = p_correlation_id
  where session_id = p_session_id
    and user_id = p_user_id
    and claim_id = p_claim_id
    and reset_operation_id = p_correlation_id
    and consumed_at is null;
  get diagnostics affected = row_count;

  if affected <> 1 then
    return false;
  end if;

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
      correlation_id,
      operation_id
    )
    values (
      recovery_group_id,
      p_user_id,
      'identity.password_recovered',
      'user',
      p_user_id,
      pg_catalog.jsonb_build_object('recovery_session_consumed', true),
      'server',
      p_correlation_id,
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
      correlation_id,
      operation_id
    )
    values (
      p_user_id,
      'identity.password_recovered',
      'user',
      p_user_id,
      pg_catalog.jsonb_build_object('recovery_session_consumed', true),
      'server',
      p_correlation_id,
      p_correlation_id
    );
  end if;

  return true;
end;
$$;

comment on function app.finalize_password_recovery_claim(
  uuid, uuid, uuid, uuid
) is
  'Private exactly-once recovery finalizer. Session consumption and the tenant or unattached-identity security audit commit together.';

revoke all on function app.finalize_password_recovery_claim(
  uuid, uuid, uuid, uuid
) from public, anon, authenticated, service_role;

create or replace function public.claim_password_recovery_session(
  p_session_id uuid,
  p_user_id uuid,
  p_claim_id uuid,
  p_claimed_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected integer;
  v_claimed_at timestamptz := pg_catalog.clock_timestamp();
  v_operation_id uuid;
begin
  if p_claimed_at is null then
    return false;
  end if;

  -- Serialize claims per Auth identity. A password change can therefore map to
  -- exactly one active claimed recovery operation in its auth.users trigger.
  perform 1
  from auth.users as identity
  where identity.id = p_user_id
  for update;

  if not found then
    return false;
  end if;

  -- Expired recovery handles cannot authorize another application request.
  -- Clear their abandoned claim while holding the same identity lock so a new
  -- reset can recover availability without replacing a live command.
  update public.password_recovery_sessions
  set claim_id = null,
      claimed_at = null
  where user_id = p_user_id
    and claim_id is not null
    and consumed_at is null
    and expires_at <= v_claimed_at;
  get diagnostics affected = row_count;

  if affected > 0 then
    update auth.users
    set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
      - 'greenroster_password_recovery'
    where id = p_user_id;
  end if;

  select recovery.reset_operation_id
  into v_operation_id
    from public.password_recovery_sessions as recovery
    where recovery.session_id = p_session_id
      and recovery.user_id = p_user_id
      and recovery.claim_id = p_claim_id
      and recovery.consumed_at is null
  ;

  if found then
    update auth.users
    set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
      || pg_catalog.jsonb_build_object(
        'greenroster_password_recovery',
        pg_catalog.jsonb_build_object(
          'session_id', p_session_id,
          'claim_id', p_claim_id,
          'operation_id', v_operation_id
        )
      )
    where id = p_user_id;
    return true;
  end if;

  -- Never replace a live claimed operation. It must be released, consumed, or
  -- expire before another reset can be attributed.
  if exists (
    select 1
    from public.password_recovery_sessions as recovery
    where recovery.user_id = p_user_id
      and recovery.session_id <> p_session_id
      and recovery.claim_id is not null
      and recovery.consumed_at is null
  ) then
    return false;
  end if;

  update public.password_recovery_sessions
  set claim_id = p_claim_id,
      claimed_at = v_claimed_at
  where session_id = p_session_id
    and user_id = p_user_id
    and claim_id is null
    and consumed_at is null
    and expires_at > v_claimed_at
  returning reset_operation_id into v_operation_id;
  get diagnostics affected = row_count;

  if affected <> 1 then
    return false;
  end if;

  update auth.users
  set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
    || pg_catalog.jsonb_build_object(
      'greenroster_password_recovery',
      pg_catalog.jsonb_build_object(
        'session_id', p_session_id,
        'claim_id', p_claim_id,
        'operation_id', v_operation_id
      )
    )
  where id = p_user_id;
  return true;
end;
$$;

create or replace function public.release_password_recovery_claim(
  p_session_id uuid,
  p_user_id uuid,
  p_claim_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected integer;
begin
  -- Serialize against the auth.users password-update trigger. If Auth commits,
  -- the trigger consumes first and this release becomes a no-op; if Auth rolls
  -- back, release clears the still-live claim.
  perform 1
  from auth.users as identity
  where identity.id = p_user_id
  for update;

  if not found then
    return false;
  end if;

  update public.password_recovery_sessions
  set claim_id = null,
      claimed_at = null
  where session_id = p_session_id
    and user_id = p_user_id
    and claim_id = p_claim_id
    and consumed_at is null;
  get diagnostics affected = row_count;

  if affected = 1 then
    update auth.users
    set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
      - 'greenroster_password_recovery'
    where id = p_user_id;
  end if;

  return affected = 1;
end;
$$;

create or replace function public.consume_password_recovery_session(
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
  prior_consumed_at timestamptz;
  prior_consumed_correlation_id uuid;
  prior_claim_id uuid;
begin
  if p_consumed_at is null then
    raise exception 'recovery_confirmation_time_required'
      using errcode = '22004';
  end if;

  if p_correlation_id is null then
    raise exception 'recovery_correlation_required' using errcode = '22004';
  end if;

  perform 1
  from auth.users as identity
  where identity.id = p_user_id
  for update;

  if not found then
    return false;
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

create function app.finalize_recovery_after_password_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recovery_marker jsonb;
  recovery_session_id uuid;
  recovery_claim_id uuid;
  recovery_operation_id uuid;
begin
  recovery_marker := new.raw_app_meta_data -> 'greenroster_password_recovery';
  if recovery_marker is null then
    return new;
  end if;

  -- The marker is an ephemeral server-generated command, never identity data.
  -- Removing it in this BEFORE trigger keeps recovery handles out of Auth rows.
  new.raw_app_meta_data := new.raw_app_meta_data
    - 'greenroster_password_recovery';

  begin
    recovery_session_id := (recovery_marker ->> 'session_id')::uuid;
    recovery_claim_id := (recovery_marker ->> 'claim_id')::uuid;
    recovery_operation_id := (recovery_marker ->> 'operation_id')::uuid;
  exception
    when invalid_text_representation or null_value_not_allowed then
      raise exception 'invalid_password_recovery_marker'
        using errcode = 'P0001';
  end;

  if not app.finalize_password_recovery_claim(
    recovery_session_id,
    new.id,
    recovery_claim_id,
    recovery_operation_id
  ) then
    raise exception 'password_recovery_claim_mismatch'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

comment on function app.finalize_recovery_after_password_change() is
  'Consumes the exact server-marked recovery claim and appends its audit in the same transaction as Supabase Auth changes the password hash. Coupled to the locally pinned auth.users.encrypted_password schema; retain live GoTrue compatibility coverage on Supabase upgrades.';

revoke all on function app.finalize_recovery_after_password_change()
from public, anon, authenticated, service_role;

-- Forward migration safety: the previous registry allowed more than one claim
-- per identity and had no Auth command marker. Preserve one live exact claim;
-- release expired or ambiguous legacy claims so they fail closed and can retry.
with claimed_users as materialized (
  select user_id, count(*) as claim_count
  from public.password_recovery_sessions
  where claim_id is not null
    and consumed_at is null
  group by user_id
)
update public.password_recovery_sessions as recovery
set claim_id = null,
    claimed_at = null
from claimed_users
where claimed_users.user_id = recovery.user_id
  and recovery.claim_id is not null
  and recovery.consumed_at is null
  and (
    claimed_users.claim_count <> 1
    or recovery.expires_at <= pg_catalog.clock_timestamp()
  );

update auth.users as identity
set raw_app_meta_data = coalesce(identity.raw_app_meta_data, '{}'::jsonb)
  || pg_catalog.jsonb_build_object(
    'greenroster_password_recovery',
    pg_catalog.jsonb_build_object(
      'session_id', recovery.session_id,
      'claim_id', recovery.claim_id,
      'operation_id', recovery.reset_operation_id
    )
  )
from public.password_recovery_sessions as recovery
where recovery.user_id = identity.id
  and recovery.claim_id is not null
  and recovery.consumed_at is null
  and recovery.expires_at > pg_catalog.clock_timestamp();

create trigger auth_user_password_recovery_audit
before update of encrypted_password on auth.users
for each row
when (old.encrypted_password is distinct from new.encrypted_password)
execute function app.finalize_recovery_after_password_change();
