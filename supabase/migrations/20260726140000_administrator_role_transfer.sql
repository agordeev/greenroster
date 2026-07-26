create or replace function app.reject_last_active_administrator()
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

  if removes_active_administrator then
    -- Serialize every server path that can remove an administrator on the
    -- tenant row. Without this lock, two demotions can each observe the other
    -- administrator and commit a group with none remaining.
    perform 1
    from public.groups as protected_group
    where protected_group.id = old.group_id
    for update;

    if not exists (
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
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

revoke all on function app.reject_last_active_administrator()
from public, anon, authenticated;

create function public.transfer_group_administrator(
  p_actor_user_id uuid,
  p_replacement_membership_id uuid,
  p_expected_group_version bigint,
  p_confirmed boolean,
  p_reason text,
  p_correlation_id uuid,
  p_operation_id uuid
)
returns table (
  transferred_group_id app.entity_id,
  group_version bigint,
  previous_administrator_membership_id app.entity_id,
  previous_administrator_role public.membership_role,
  replacement_membership_id app.entity_id,
  replacement_role public.membership_role
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_group_id uuid;
  actor_membership public.memberships%rowtype;
  replacement_membership public.memberships%rowtype;
  locked_group public.groups%rowtype;
  prior_event public.audit_events%rowtype;
  normalized_reason text;
  replacement_prior_role public.membership_role;
begin
  if p_actor_user_id is null then
    raise exception 'actor_identity_required' using errcode = '22004';
  end if;

  if p_correlation_id is null or p_operation_id is null then
    raise exception 'operation_context_required' using errcode = '22004';
  end if;

  if p_replacement_membership_id is null
    or p_expected_group_version is null
    or p_expected_group_version < 1
  then
    raise exception 'transfer_input_invalid' using errcode = '22023';
  end if;

  normalized_reason := pg_catalog.btrim(p_reason);
  if p_confirmed is distinct from true
    or normalized_reason is null
    or normalized_reason = ''
    or pg_catalog.length(normalized_reason) > 500
  then
    raise exception 'transfer_confirmation_required' using errcode = '22023';
  end if;

  -- Derive the tenant only from the trusted server actor. The replacement ID
  -- is never allowed to select or widen the group scope.
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

  -- Re-resolve authorization after taking the tenant lock so a concurrent
  -- role or status change takes effect before this mutation executes.
  select membership.*
  into actor_membership
  from public.memberships as membership
  join public.user_profiles as profile
    on profile.user_id = membership.user_id
  join auth.users as identity
    on identity.id = membership.user_id
  where membership.user_id = p_actor_user_id
    and membership.group_id = locked_group.id
    and membership.status = 'active'
    and profile.disabled_at is null
    and identity.email_confirmed_at is not null
    and identity.deleted_at is null
    and not identity.is_anonymous
    and (identity.banned_until is null or identity.banned_until <= pg_catalog.now())
  for update of membership;

  if not found then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  -- An authenticated, still-active actor may reconcile their own prior success
  -- even though that success changed their role from administrator.
  select event.*
  into prior_event
  from public.audit_events as event
  where event.group_id = actor_membership.group_id
    and event.actor_user_id = p_actor_user_id
    and event.action = 'membership.administrator_transferred'
    and event.operation_id = p_operation_id;

  if found then
    return query select
      prior_event.group_id,
      prior_event.target_version,
      (prior_event.after_state -> 'previous_administrator' ->> 'membership_id')::app.entity_id,
      (prior_event.after_state -> 'previous_administrator' ->> 'role')::public.membership_role,
      (prior_event.after_state -> 'replacement' ->> 'membership_id')::app.entity_id,
      (prior_event.after_state -> 'replacement' ->> 'role')::public.membership_role;
    return;
  end if;

  if actor_membership.role <> 'administrator' then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  if actor_membership.id = p_replacement_membership_id then
    raise exception 'replacement_unavailable' using errcode = 'P0002';
  end if;

  select membership.*
  into replacement_membership
  from public.memberships as membership
  join public.user_profiles as profile
    on profile.user_id = membership.user_id
  join auth.users as identity
    on identity.id = membership.user_id
  where membership.id = p_replacement_membership_id
    and membership.group_id = actor_membership.group_id
    and membership.status = 'active'
    and membership.user_id is not null
    and profile.disabled_at is null
    and identity.email_confirmed_at is not null
    and identity.deleted_at is null
    and not identity.is_anonymous
    and (identity.banned_until is null or identity.banned_until <= pg_catalog.now())
  for update of membership;

  if not found then
    raise exception 'replacement_unavailable' using errcode = 'P0002';
  end if;

  if locked_group.version <> p_expected_group_version then
    raise exception 'group_version_changed' using errcode = '40001';
  end if;

  replacement_prior_role := replacement_membership.role;

  update public.memberships
  set role = 'administrator'
  where id = replacement_membership.id
    and role <> 'administrator'
  returning * into replacement_membership;

  if not found then
    select *
    into replacement_membership
    from public.memberships
    where id = p_replacement_membership_id;
  end if;

  update public.memberships
  set role = 'coordinator'
  where id = actor_membership.id
  returning * into actor_membership;

  update public.groups
  set version = version + 1
  where id = locked_group.id
  returning * into locked_group;

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
    locked_group.id,
    p_actor_user_id,
    'membership.administrator_transferred',
    'group',
    locked_group.id,
    locked_group.version,
    pg_catalog.jsonb_build_object(
      'group_version', p_expected_group_version,
      'previous_administrator', pg_catalog.jsonb_build_object(
        'membership_id', actor_membership.id,
        'role', 'administrator'
      ),
      'replacement', pg_catalog.jsonb_build_object(
        'membership_id', replacement_membership.id,
        'role', replacement_prior_role
      )
    ),
    pg_catalog.jsonb_build_object(
      'group_version', locked_group.version,
      'previous_administrator', pg_catalog.jsonb_build_object(
        'membership_id', actor_membership.id,
        'role', actor_membership.role
      ),
      'replacement', pg_catalog.jsonb_build_object(
        'membership_id', replacement_membership.id,
        'role', replacement_membership.role
      )
    ),
    'portal',
    p_correlation_id,
    p_operation_id,
    normalized_reason
  );

  return query select
    locked_group.id,
    locked_group.version,
    actor_membership.id,
    actor_membership.role,
    replacement_membership.id,
    replacement_membership.role;
end;
$$;

comment on function public.transfer_group_administrator(
  uuid, uuid, bigint, boolean, text, uuid, uuid
) is
  'Server-only administrator transfer. Tenant and actor role are re-resolved under a group lock; confirmation, version, idempotency, state changes, and audit commit atomically.';

revoke all on function public.transfer_group_administrator(
  uuid, uuid, bigint, boolean, text, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.transfer_group_administrator(
  uuid, uuid, bigint, boolean, text, uuid, uuid
) to service_role;
