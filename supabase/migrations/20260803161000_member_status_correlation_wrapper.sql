-- Preserve the existing member-status implementation while adding the
-- transaction-local correlation context consumed by notification device
-- retirement triggers.  Keeping this as a follow-up migration also upgrades
-- databases that already applied the original status function.
alter function public.set_member_status(
  uuid,
  uuid,
  public.membership_status,
  bigint,
  boolean,
  text,
  uuid,
  uuid
)
rename to set_member_status_impl;

revoke all on function public.set_member_status_impl(
  uuid,
  uuid,
  public.membership_status,
  bigint,
  boolean,
  text,
  uuid,
  uuid
)
from public, anon, authenticated, service_role;

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
begin
  perform pg_catalog.set_config(
    'greenroster.correlation_id',
    p_correlation_id::text,
    true
  );

  return query
  select result.changed_membership_id,
         result.changed_group_id,
         result.membership_version,
         result.status,
         result.inactivated_at,
         result.cancelled_notification_count
  from public.set_member_status_impl(
    p_actor_user_id,
    p_membership_id,
    p_new_status,
    p_expected_membership_version,
    p_confirmed,
    p_reason,
    p_correlation_id,
    p_operation_id
  ) as result;
end;
$$;

comment on function public.set_member_status(uuid, uuid, public.membership_status, bigint, boolean, text, uuid, uuid) is
  'Service-only confirmed/reasoned member status transition. The wrapper supplies transaction-local correlation context before delegating to the original implementation.';

revoke all on function public.set_member_status(uuid, uuid, public.membership_status, bigint, boolean, text, uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.set_member_status(uuid, uuid, public.membership_status, bigint, boolean, text, uuid, uuid)
to service_role;
