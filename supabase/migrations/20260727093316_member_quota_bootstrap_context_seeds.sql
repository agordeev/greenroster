-- Phase 02: expose the administrator-owned ordered seed inputs alongside the
-- existing quota bootstrap context.  The service-only RPC remains the single
-- read boundary for this data; clients never receive direct table privileges.

-- PostgREST must resolve the private domain used by the existing quota
-- mutation signature. USAGE exposes no tables or functions by itself.
grant usage on schema app to service_role;

drop function public.resolve_membership_quota_bootstrap_context(uuid, uuid);

create function public.resolve_membership_quota_bootstrap_context(
  p_actor_user_id uuid,
  p_membership_id uuid
)
returns table (
  context_membership_id app.entity_id,
  context_group_id app.entity_id,
  initial_quota app.quota_value,
  uses_initial_quota boolean,
  initial_quota_provenance text,
  seed_totals jsonb,
  projection_version bigint,
  projection_ready boolean,
  projected_quota app.quota_value,
  projection_source jsonb,
  projection_effective_at app.utc_instant,
  settings_version bigint,
  settings_method public.quota_method,
  settings_history_length smallint,
  settings_precision smallint,
  settings_rounding_rule public.quota_rounding_rule,
  adjustment_bands jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_group_id uuid;
  target_group_id uuid;
begin
  if p_actor_user_id is null or p_membership_id is null then
    raise exception 'quota_bootstrap_context_input_invalid' using errcode = '22004';
  end if;

  select membership.group_id
  into actor_group_id
  from public.memberships as membership
  where membership.user_id = p_actor_user_id;

  if not found then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  if not exists (
    select 1
    from public.memberships as actor_membership
    join public.user_profiles as profile on profile.user_id = actor_membership.user_id
    join auth.users as identity on identity.id = actor_membership.user_id
    where actor_membership.user_id = p_actor_user_id
      and actor_membership.group_id = actor_group_id
      and actor_membership.role = 'administrator'
      and actor_membership.status = 'active'
      and profile.disabled_at is null
      and identity.email_confirmed_at is not null
      and identity.deleted_at is null
      and not identity.is_anonymous
      and (identity.banned_until is null or identity.banned_until <= pg_catalog.now())
  ) then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  -- Authorize the actor before resolving the target. This keeps revoked or
  -- unusable former members from using target IDs as a membership oracle.
  select membership.group_id
  into target_group_id
  from public.memberships as membership
  where membership.id = p_membership_id
    and membership.group_id = actor_group_id;

  if not found then
    raise exception 'membership_unavailable' using errcode = 'P0002';
  end if;

  return query
  select
    target.id,
    target.group_id,
    target.initial_quota,
    target.uses_initial_quota,
    target.initial_quota_provenance,
    coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'position', seed.position,
            'point_total', seed.point_total::text
          ) order by seed.position
        )
        from public.membership_quota_seed_totals as seed
        where seed.membership_id = target.id
          and seed.group_id = target.group_id
      ),
      '[]'::jsonb
    ),
    coalesce(projection.projection_version, 0),
    coalesce(projection.projection_ready, false),
    projection.projected_quota,
    coalesce(projection.projection_source, '{}'::jsonb),
    projection.effective_at,
    coalesce(settings.version, 0),
    settings.method,
    settings.moving_average_history_length,
    settings.precision,
    settings.rounding_rule,
    coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'position', band.position,
            'lower_bound', band.lower_bound,
            'lower_inclusive', band.lower_inclusive,
            'upper_bound', band.upper_bound,
            'upper_inclusive', band.upper_inclusive,
            'adjustment', band.adjustment
          ) order by band.position
        )
        from public.quota_adjustment_bands as band
        where band.group_id = target.group_id
      ),
      '[]'::jsonb
    )
  from public.memberships as target
  left join public.membership_quota_projections as projection
    on projection.membership_id = target.id
   and projection.group_id = target.group_id
  left join public.group_quota_settings as settings
    on settings.group_id = target.group_id
  where target.id = p_membership_id
    and target.group_id = target_group_id;
end;
$$;

comment on function public.resolve_membership_quota_bootstrap_context(uuid, uuid) is
  'Trusted server read boundary for one administrator-owned membership, ordered seed inputs, and its current quota policy/projection context.';

revoke all on function public.resolve_membership_quota_bootstrap_context(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.resolve_membership_quota_bootstrap_context(uuid, uuid)
to service_role;
