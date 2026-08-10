-- Keep server-side affiliation and recovery reads column-scoped.  The local
-- Supabase role bootstrap can grant broad table privileges to service_role;
-- those grants would bypass the explicit column contract in the foundation
-- migrations.  RPCs remain the write boundary for these tables.

revoke all on table
  public.memberships,
  public.user_profiles,
  public.password_recovery_sessions
from service_role;

grant select (id, user_id)
on table public.memberships
to service_role;

grant select (user_id, disabled_at)
on table public.user_profiles
to service_role;

grant select
on table public.password_recovery_sessions
to service_role;
