create table public.password_recovery_sessions (
  session_id uuid primary key,
  user_id app.entity_id not null references auth.users (id) on delete cascade,
  expires_at app.utc_instant not null,
  claim_id uuid,
  claimed_at app.utc_instant,
  consumed_at app.utc_instant,
  created_at app.utc_instant not null default pg_catalog.now(),
  constraint password_recovery_sessions_expiry_after_creation
    check (expires_at > created_at),
  constraint password_recovery_sessions_claim_complete
    check ((claim_id is null) = (claimed_at is null)),
  constraint password_recovery_sessions_claim_after_creation
    check (claimed_at is null or claimed_at >= created_at),
  constraint password_recovery_sessions_consumption_after_creation
    check (consumed_at is null or consumed_at >= created_at),
  constraint password_recovery_sessions_consumption_claimed
    check (consumed_at is null or claim_id is not null)
);

comment on table public.password_recovery_sessions is
  'Server-only registry that scopes an exchanged Auth recovery session to password reset until it is consumed or expires.';

alter table public.password_recovery_sessions enable row level security;
alter table public.password_recovery_sessions force row level security;

revoke all on table public.password_recovery_sessions
  from public, anon, authenticated;
grant select on table public.password_recovery_sessions to service_role;

create trigger password_recovery_sessions_immutable_session
before update of session_id on public.password_recovery_sessions
for each row execute function app.reject_id_change('session_id');

create trigger password_recovery_sessions_immutable_user
before update of user_id on public.password_recovery_sessions
for each row execute function app.reject_id_change('user_id');

create trigger password_recovery_sessions_immutable_expiry
before update of expires_at on public.password_recovery_sessions
for each row execute function app.reject_id_change('expires_at');

create function public.register_password_recovery_session(
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

  insert into public.password_recovery_sessions (session_id, user_id, expires_at)
  values (p_session_id, p_user_id, p_expires_at);
  return true;
end;
$$;

create function public.claim_password_recovery_session(
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
begin
  update public.password_recovery_sessions
  set claim_id = p_claim_id, claimed_at = p_claimed_at
  where session_id = p_session_id
    and user_id = p_user_id
    and claim_id is null
    and consumed_at is null
    and expires_at > p_claimed_at;
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;

create function public.release_password_recovery_claim(
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
  update public.password_recovery_sessions
  set claim_id = null, claimed_at = null
  where session_id = p_session_id
    and user_id = p_user_id
    and claim_id = p_claim_id
    and consumed_at is null;
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;

create function public.consume_password_recovery_session(
  p_session_id uuid,
  p_user_id uuid,
  p_claim_id uuid,
  p_consumed_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected integer;
begin
  update public.password_recovery_sessions
  set consumed_at = p_consumed_at
  where session_id = p_session_id
    and user_id = p_user_id
    and claim_id = p_claim_id
    and consumed_at is null;
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;

revoke all on function public.register_password_recovery_session(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.claim_password_recovery_session(uuid, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.release_password_recovery_claim(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.consume_password_recovery_session(uuid, uuid, uuid, timestamptz) from public, anon, authenticated;

grant execute on function public.register_password_recovery_session(uuid, uuid, timestamptz) to service_role;
grant execute on function public.claim_password_recovery_session(uuid, uuid, uuid, timestamptz) to service_role;
grant execute on function public.release_password_recovery_claim(uuid, uuid, uuid) to service_role;
grant execute on function public.consume_password_recovery_session(uuid, uuid, uuid, timestamptz) to service_role;
