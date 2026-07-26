create type public.quota_method as enum (
  'moving_average',
  'best_10_of_20',
  'previous_plus_minus'
);

create type public.quota_rounding_rule as enum ('half_away_from_zero');

create table public.group_quota_settings (
  group_id app.entity_id primary key references public.groups (id) on delete restrict,
  method public.quota_method not null,
  moving_average_history_length smallint,
  precision smallint not null,
  rounding_rule public.quota_rounding_rule not null default 'half_away_from_zero',
  version bigint not null default 1,
  updated_by app.entity_id not null references auth.users (id) on delete restrict,
  created_at app.utc_instant not null default pg_catalog.now(),
  updated_at app.utc_instant not null default pg_catalog.now(),
  constraint group_quota_settings_history_length_matches_method check (
    (
      method = 'moving_average'
      and moving_average_history_length is not null
      and moving_average_history_length between 4 and 20
    )
    or (method <> 'moving_average' and moving_average_history_length is null)
  ),
  constraint group_quota_settings_precision_valid check (precision between 0 and 2),
  constraint group_quota_settings_version_positive check (version > 0)
);

comment on table public.group_quota_settings is
  'The current prospective quota calculation policy for one tenant. Official rounds snapshot this policy in the phase that publishes them.';

create trigger group_quota_settings_immutable_group
before update of group_id on public.group_quota_settings
for each row execute function app.reject_id_change('group_id');

create trigger group_quota_settings_set_updated_at
before update on public.group_quota_settings
for each row execute function app.set_updated_at();

create table public.quota_adjustment_bands (
  id app.entity_id primary key default pg_catalog.gen_random_uuid(),
  group_id app.entity_id not null references public.group_quota_settings (group_id) on delete cascade,
  position smallint not null check (position > 0),
  lower_bound app.plus_minus_value not null,
  lower_inclusive boolean not null,
  upper_bound app.plus_minus_value not null,
  upper_inclusive boolean not null,
  adjustment app.quota_adjustment_value not null,
  constraint quota_adjustment_bands_position_unique unique (group_id, position),
  constraint quota_adjustment_bands_bounds_ordered check (
    lower_bound < upper_bound
    or (
      lower_bound = upper_bound
      and lower_inclusive
      and upper_inclusive
    )
  )
);

comment on table public.quota_adjustment_bands is
  'An ordered, atomically replaced Method C partition of the complete allowed plus/minus range.';

create trigger quota_adjustment_bands_immutable_id
before update of id on public.quota_adjustment_bands
for each row execute function app.reject_id_change('id');

create trigger quota_adjustment_bands_immutable_group
before update of group_id on public.quota_adjustment_bands
for each row execute function app.reject_id_change('group_id');

alter table public.group_quota_settings enable row level security;
alter table public.group_quota_settings force row level security;
alter table public.quota_adjustment_bands enable row level security;
alter table public.quota_adjustment_bands force row level security;

create policy group_quota_settings_tenant_read
on public.group_quota_settings
for select
to authenticated
using (
  group_id = (select app.active_group_id())
  and (select app.active_membership_role()) in ('coordinator', 'administrator')
);

create policy quota_adjustment_bands_tenant_read
on public.quota_adjustment_bands
for select
to authenticated
using (
  group_id = (select app.active_group_id())
  and (select app.active_membership_role()) in ('coordinator', 'administrator')
);

revoke all on table public.group_quota_settings from public, anon, authenticated;
revoke all on table public.quota_adjustment_bands from public, anon, authenticated;
grant select on table public.group_quota_settings to authenticated;
grant select on table public.quota_adjustment_bands to authenticated;

create function public.configure_group_quota_rules(
  p_actor_user_id uuid,
  p_method public.quota_method,
  p_moving_average_history_length integer,
  p_precision integer,
  p_rounding_rule public.quota_rounding_rule,
  p_bands jsonb,
  p_expected_settings_version bigint,
  p_reason text,
  p_correlation_id uuid,
  p_operation_id uuid
)
returns table (
  configured_group_id app.entity_id,
  settings_version bigint,
  configured_method public.quota_method,
  configured_history_length smallint,
  configured_precision smallint,
  configured_rounding_rule public.quota_rounding_rule
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_group_id uuid;
  actor_membership public.memberships%rowtype;
  locked_group public.groups%rowtype;
  prior_settings public.group_quota_settings%rowtype;
  saved_settings public.group_quota_settings%rowtype;
  prior_event public.audit_events%rowtype;
  normalized_reason text;
  band_count integer;
  invalid_band_count integer;
  invalid_boundary_count integer;
  before_state jsonb;
begin
  if p_actor_user_id is null then
    raise exception 'actor_identity_required' using errcode = '22004';
  end if;

  if p_correlation_id is null or p_operation_id is null then
    raise exception 'operation_context_required' using errcode = '22004';
  end if;

  normalized_reason := pg_catalog.btrim(p_reason);
  if normalized_reason is null
    or normalized_reason = ''
    or pg_catalog.length(normalized_reason) > 500
  then
    raise exception 'quota_settings_reason_required' using errcode = '22023';
  end if;

  if p_method is null
    or p_precision is null
    or p_precision not between 0 and 2
    or p_rounding_rule is null
    or p_expected_settings_version is null
    or p_expected_settings_version < 0
    or p_bands is null
    or pg_catalog.jsonb_typeof(p_bands) <> 'array'
  then
    raise exception 'quota_settings_input_invalid' using errcode = '22023';
  end if;

  if (
    p_method = 'moving_average'
    and (
      p_moving_average_history_length is null
      or p_moving_average_history_length not between 4 and 20
    )
  )
    or (p_method <> 'moving_average' and p_moving_average_history_length is not null)
  then
    raise exception 'quota_history_length_invalid' using errcode = '22023';
  end if;

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

  select membership.*
  into actor_membership
  from public.memberships as membership
  join public.user_profiles as profile on profile.user_id = membership.user_id
  join auth.users as identity on identity.id = membership.user_id
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

  select event.*
  into prior_event
  from public.audit_events as event
  where event.group_id = actor_membership.group_id
    and event.actor_user_id = p_actor_user_id
    and event.action = 'group.quota_rules_configured'
    and event.operation_id = p_operation_id;

  if found then
    return query select
      prior_event.group_id,
      prior_event.target_version,
      (prior_event.after_state ->> 'method')::public.quota_method,
      (prior_event.after_state ->> 'moving_average_history_length')::smallint,
      (prior_event.after_state ->> 'precision')::smallint,
      (prior_event.after_state ->> 'rounding_rule')::public.quota_rounding_rule;
    return;
  end if;

  if actor_membership.role <> 'administrator' then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  select settings.*
  into prior_settings
  from public.group_quota_settings as settings
  where settings.group_id = locked_group.id
  for update;

  if found then
    if p_expected_settings_version <> prior_settings.version then
      raise exception 'quota_settings_version_changed' using errcode = '40001';
    end if;

    before_state := pg_catalog.jsonb_build_object(
      'method', prior_settings.method,
      'moving_average_history_length', prior_settings.moving_average_history_length,
      'precision', prior_settings.precision,
      'rounding_rule', prior_settings.rounding_rule,
      'version', prior_settings.version,
      'bands', (
        select coalesce(
          pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'position', band.position,
              'lower_bound', band.lower_bound,
              'lower_inclusive', band.lower_inclusive,
              'upper_bound', band.upper_bound,
              'upper_inclusive', band.upper_inclusive,
              'adjustment', band.adjustment
            ) order by band.position
          ),
          '[]'::jsonb
        )
        from public.quota_adjustment_bands as band
        where band.group_id = locked_group.id
      )
    );
  elsif p_expected_settings_version <> 0 then
    raise exception 'quota_settings_version_changed' using errcode = '40001';
  else
    before_state := null;
  end if;

  select pg_catalog.jsonb_array_length(p_bands) into band_count;

  if p_method <> 'previous_plus_minus' and band_count <> 0 then
    raise exception 'quota_bands_not_allowed' using errcode = '22023';
  end if;

  if p_method = 'previous_plus_minus' then
    if band_count = 0 then
      raise exception 'quota_bands_incomplete' using errcode = '22023';
    end if;

    with supplied_bands as (
      select
        ordinal::integer as position,
        (value ->> 'lower_bound')::numeric as lower_bound,
        (value ->> 'lower_inclusive')::boolean as lower_inclusive,
        (value ->> 'upper_bound')::numeric as upper_bound,
        (value ->> 'upper_inclusive')::boolean as upper_inclusive,
        (value ->> 'adjustment')::numeric as adjustment,
        value
      from pg_catalog.jsonb_array_elements(p_bands) with ordinality as item(value, ordinal)
    )
    select count(*)
    into invalid_band_count
    from supplied_bands
    where pg_catalog.jsonb_typeof(value) <> 'object'
      or not (value ?& array[
        'lower_bound', 'lower_inclusive', 'upper_bound', 'upper_inclusive', 'adjustment'
      ])
      or lower_bound <> pg_catalog.round(lower_bound, 2)
      or lower_bound not between -100 and 100
      or upper_bound <> pg_catalog.round(upper_bound, 2)
      or upper_bound not between -100 and 100
      or adjustment <> pg_catalog.round(adjustment, 2)
      or adjustment not between -20 and 20
      or lower_bound > upper_bound
      or (lower_bound = upper_bound and not (lower_inclusive and upper_inclusive));

    if invalid_band_count <> 0 then
      raise exception 'quota_band_invalid' using errcode = '22023';
    end if;

    with supplied_bands as (
      select
        ordinal::integer as position,
        (value ->> 'lower_bound')::numeric as lower_bound,
        (value ->> 'lower_inclusive')::boolean as lower_inclusive,
        (value ->> 'upper_bound')::numeric as upper_bound,
        (value ->> 'upper_inclusive')::boolean as upper_inclusive
      from pg_catalog.jsonb_array_elements(p_bands) with ordinality as item(value, ordinal)
    ), checked_bands as (
      select
        band.*,
        pg_catalog.lag(upper_bound) over (order by position) as prior_upper_bound,
        pg_catalog.lag(upper_inclusive) over (order by position) as prior_upper_inclusive
      from supplied_bands as band
    )
    select count(*)
    into invalid_boundary_count
    from checked_bands
    where (position = 1 and (lower_bound <> -100 or not lower_inclusive))
      or (position = band_count and (upper_bound <> 100 or not upper_inclusive))
      or (
        position > 1
        and (
          lower_bound <> prior_upper_bound
          or lower_inclusive = prior_upper_inclusive
        )
      );

    if invalid_boundary_count <> 0 then
      raise exception 'quota_bands_incomplete_or_overlapping' using errcode = '22023';
    end if;
  end if;

  insert into public.group_quota_settings (
    group_id,
    method,
    moving_average_history_length,
    precision,
    rounding_rule,
    version,
    updated_by
  )
  values (
    locked_group.id,
    p_method,
    p_moving_average_history_length,
    p_precision,
    p_rounding_rule,
    1,
    p_actor_user_id
  )
  on conflict (group_id) do update
  set method = excluded.method,
      moving_average_history_length = excluded.moving_average_history_length,
      precision = excluded.precision,
      rounding_rule = excluded.rounding_rule,
      version = public.group_quota_settings.version + 1,
      updated_by = excluded.updated_by
  returning * into saved_settings;

  delete from public.quota_adjustment_bands
  where group_id = locked_group.id;

  if p_method = 'previous_plus_minus' then
    insert into public.quota_adjustment_bands (
      group_id,
      position,
      lower_bound,
      lower_inclusive,
      upper_bound,
      upper_inclusive,
      adjustment
    )
    select
      locked_group.id,
      ordinal::smallint,
      (value ->> 'lower_bound')::app.plus_minus_value,
      (value ->> 'lower_inclusive')::boolean,
      (value ->> 'upper_bound')::app.plus_minus_value,
      (value ->> 'upper_inclusive')::boolean,
      (value ->> 'adjustment')::app.quota_adjustment_value
    from pg_catalog.jsonb_array_elements(p_bands) with ordinality as item(value, ordinal);
  end if;

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
    'group.quota_rules_configured',
    'group_quota_settings',
    locked_group.id,
    saved_settings.version,
    before_state,
    pg_catalog.jsonb_build_object(
      'method', saved_settings.method,
      'moving_average_history_length', saved_settings.moving_average_history_length,
      'precision', saved_settings.precision,
      'rounding_rule', saved_settings.rounding_rule,
      'version', saved_settings.version,
      'bands', p_bands
    ),
    'server',
    p_correlation_id,
    p_operation_id,
    normalized_reason
  );

  return query select
    saved_settings.group_id,
    saved_settings.version,
    saved_settings.method,
    saved_settings.moving_average_history_length,
    saved_settings.precision,
    saved_settings.rounding_rule;
end;
$$;

comment on function public.configure_group_quota_rules(
  uuid,
  public.quota_method,
  integer,
  integer,
  public.quota_rounding_rule,
  jsonb,
  bigint,
  text,
  uuid,
  uuid
) is
  'Atomically validates and replaces the actor-derived group quota policy through the trusted server boundary.';

revoke all on function public.configure_group_quota_rules(
  uuid,
  public.quota_method,
  integer,
  integer,
  public.quota_rounding_rule,
  jsonb,
  bigint,
  text,
  uuid,
  uuid
) from public, anon, authenticated;
grant execute on function public.configure_group_quota_rules(
  uuid,
  public.quota_method,
  integer,
  integer,
  public.quota_rounding_rule,
  jsonb,
  bigint,
  text,
  uuid,
  uuid
) to service_role;

drop function public.resolve_group_onboarding();

create function public.resolve_group_onboarding()
returns table (
  group_profile_complete boolean,
  quota_rules_configured boolean,
  additional_membership_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    pg_catalog.btrim(group_record.name) <> ''
      and group_record.time_zone is not null as group_profile_complete,
    quota_settings.group_id is not null as quota_rules_configured,
    count(membership.id) filter (
      where membership.user_id is distinct from (select auth.uid())
    ) as additional_membership_count
  from public.groups as group_record
  left join public.group_quota_settings as quota_settings
    on quota_settings.group_id = group_record.id
  left join public.memberships as membership
    on membership.group_id = group_record.id
  where group_record.id = (select app.active_group_id())
    and (select app.active_membership_role()) in ('coordinator', 'administrator')
  group by
    group_record.id,
    group_record.name,
    group_record.time_zone,
    quota_settings.group_id;
$$;

comment on function public.resolve_group_onboarding() is
  'Returns onboarding facts derived from authoritative records in the authenticated coordinator or administrator group.';

revoke all on function public.resolve_group_onboarding() from public, anon;
grant execute on function public.resolve_group_onboarding() to authenticated;
