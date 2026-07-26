-- Phase 02: member-owned initial quota and seed-history projection.
-- Seed totals are calculation inputs only; they are never round records.

-- The composite key lets seed/projection rows carry an immutable tenant column
-- while PostgreSQL itself proves that membership_id and group_id agree.
alter table public.memberships
  add constraint memberships_id_group_id_unique unique (id, group_id);

create table public.membership_quota_seed_totals (
  id app.entity_id primary key default pg_catalog.gen_random_uuid(),
  membership_id app.entity_id not null references public.memberships (id) on delete restrict,
  group_id app.entity_id not null references public.groups (id) on delete restrict,
  position smallint not null,
  point_total app.golf_points_value not null,
  source text not null default 'member_bootstrap',
  source_metadata jsonb not null default '{}'::jsonb,
  created_at app.utc_instant not null default pg_catalog.now(),
  constraint membership_quota_seed_totals_position_valid
    check (position between 1 and 20),
  constraint membership_quota_seed_totals_source_not_blank
    check (pg_catalog.btrim(source) <> ''),
  constraint membership_quota_seed_totals_metadata_object
    check (pg_catalog.jsonb_typeof(source_metadata) = 'object'),
  constraint membership_quota_seed_totals_membership_group_fk
    foreign key (membership_id, group_id)
    references public.memberships (id, group_id)
    on delete restrict,
  constraint membership_quota_seed_totals_position_unique
    unique (membership_id, position)
);

comment on table public.membership_quota_seed_totals is
  'At most 20 ordered setup point totals. These inputs do not represent rounds, results, participation, or standings.';
comment on column public.membership_quota_seed_totals.position is
  'One-based oldest-first order supplied during member bootstrap.';
comment on column public.membership_quota_seed_totals.source_metadata is
  'Safe provenance metadata only; secrets and personal data are not permitted by the server contract.';

create trigger membership_quota_seed_totals_immutable_id
before update of id on public.membership_quota_seed_totals
for each row execute function app.reject_id_change('id');

create trigger membership_quota_seed_totals_immutable_membership
before update of membership_id on public.membership_quota_seed_totals
for each row execute function app.reject_id_change('membership_id');

create trigger membership_quota_seed_totals_immutable_group
before update of group_id on public.membership_quota_seed_totals
for each row execute function app.reject_id_change('group_id');

create index membership_quota_seed_totals_group_membership_idx
  on public.membership_quota_seed_totals (group_id, membership_id, position);

create table public.membership_quota_projections (
  membership_id app.entity_id primary key references public.memberships (id) on delete restrict,
  group_id app.entity_id not null references public.groups (id) on delete restrict,
  projection_version bigint not null default 1,
  settings_version bigint not null default 0,
  projection_ready boolean not null default false,
  projected_quota app.quota_value,
  projection_source jsonb not null default '{}'::jsonb,
  effective_at app.utc_instant not null default pg_catalog.now(),
  updated_at app.utc_instant not null default pg_catalog.now(),
  constraint membership_quota_projections_projection_version_positive
    check (projection_version > 0),
  constraint membership_quota_projections_settings_version_nonnegative
    check (settings_version >= 0),
  constraint membership_quota_projections_readiness_consistent
    check (projection_ready = (projected_quota is not null)),
  constraint membership_quota_projections_source_object
    check (pg_catalog.jsonb_typeof(projection_source) = 'object'),
  constraint membership_quota_projections_membership_group_fk
    foreign key (membership_id, group_id)
    references public.memberships (id, group_id)
    on delete restrict
);

comment on table public.membership_quota_projections is
  'One current, server-calculated quota projection per membership. It is not a historical round or result snapshot.';
comment on column public.membership_quota_projections.settings_version is
  'The group quota-settings version used for this projection; zero means no settings were configured.';
comment on column public.membership_quota_projections.projection_source is
  'Safe calculation provenance. Future round source identifiers may be added without fabricating round rows for seeds.';

create trigger membership_quota_projections_immutable_membership
before update of membership_id on public.membership_quota_projections
for each row execute function app.reject_id_change('membership_id');

create trigger membership_quota_projections_immutable_group
before update of group_id on public.membership_quota_projections
for each row execute function app.reject_id_change('group_id');

create trigger membership_quota_projections_set_updated_at
before update on public.membership_quota_projections
for each row execute function app.set_updated_at();

alter table public.membership_quota_seed_totals enable row level security;
alter table public.membership_quota_seed_totals force row level security;
alter table public.membership_quota_projections enable row level security;
alter table public.membership_quota_projections force row level security;

revoke all on table
  public.membership_quota_seed_totals,
  public.membership_quota_projections
from public, anon, authenticated;

-- The trusted Next.js service client is the only direct table reader/writer.
-- Authenticated clients use the two narrowly-scoped SECURITY DEFINER RPCs below.
grant select on table
  public.membership_quota_seed_totals,
  public.membership_quota_projections
to service_role;

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
  projection_version bigint,
  projection_ready boolean,
  projected_quota app.quota_value,
  projection_source jsonb,
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

  select membership.group_id
  into target_group_id
  from public.memberships as membership
  where membership.id = p_membership_id
    and membership.group_id = actor_group_id;

  if not found then
    raise exception 'membership_unavailable' using errcode = 'P0002';
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

  return query
  select
    target.id,
    target.group_id,
    target.initial_quota,
    target.uses_initial_quota,
    target.initial_quota_provenance,
    coalesce(projection.projection_version, 0),
    coalesce(projection.projection_ready, false),
    projection.projected_quota,
    coalesce(projection.projection_source, '{}'::jsonb),
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
  left join public.group_quota_settings as settings
    on settings.group_id = target.group_id
  where target.id = p_membership_id
    and target.group_id = target_group_id;
end;
$$;

comment on function public.resolve_membership_quota_bootstrap_context(uuid, uuid) is
  'Trusted server read boundary for one administrator-owned membership and its current quota policy/projection context.';

revoke all on function public.resolve_membership_quota_bootstrap_context(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.resolve_membership_quota_bootstrap_context(uuid, uuid)
to service_role;

create function public.configure_membership_quota_bootstrap(
  p_actor_user_id uuid,
  p_membership_id uuid,
  p_initial_quota app.quota_value,
  p_use_initial_quota boolean,
  p_seed_totals jsonb,
  p_projection_ready boolean,
  p_projected_quota app.quota_value,
  p_projection_source jsonb,
  p_expected_projection_version bigint,
  p_expected_settings_version bigint,
  p_reason text,
  p_correlation_id uuid,
  p_operation_id uuid
)
returns table (
  configured_membership_id app.entity_id,
  configured_group_id app.entity_id,
  projection_version bigint,
  settings_version bigint,
  projection_ready boolean,
  projected_quota app.quota_value,
  projection_source jsonb,
  uses_initial_quota boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_group_id uuid;
  locked_group public.groups%rowtype;
  actor_membership public.memberships%rowtype;
  target_membership public.memberships%rowtype;
  current_settings public.group_quota_settings%rowtype;
  current_projection public.membership_quota_projections%rowtype;
  prior_event public.audit_events%rowtype;
  normalized_use_initial boolean;
  normalized_reason text;
  seed_count integer;
  invalid_seed_count integer;
  source_kind text;
  source_settings_version bigint;
  source_precision integer;
  source_method text;
  source_history_length integer;
  source_rounding_rule text;
  next_projection_version bigint;
  before_state jsonb;
  after_state jsonb;
begin
  if p_actor_user_id is null or p_membership_id is null then
    raise exception 'quota_bootstrap_input_invalid' using errcode = '22004';
  end if;

  if p_correlation_id is null or p_operation_id is null then
    raise exception 'operation_context_required' using errcode = '22004';
  end if;

  normalized_reason := pg_catalog.btrim(p_reason);
  if normalized_reason is null
    or normalized_reason = ''
    or pg_catalog.length(normalized_reason) > 500
  then
    raise exception 'quota_bootstrap_reason_required' using errcode = '22023';
  end if;

  if p_expected_projection_version is null
    or p_expected_projection_version < 0
    or p_expected_settings_version is null
    or p_expected_settings_version < 0
    or p_seed_totals is null
    or pg_catalog.jsonb_typeof(p_seed_totals) <> 'array'
    or p_projection_source is null
    or pg_catalog.jsonb_typeof(p_projection_source) <> 'object'
    or p_projection_ready is null
  then
    raise exception 'quota_bootstrap_input_invalid' using errcode = '22023';
  end if;

  seed_count := pg_catalog.jsonb_array_length(p_seed_totals);
  if seed_count > 20 then
    raise exception 'quota_seed_limit_exceeded' using errcode = '22023';
  end if;

  select count(*)
  into invalid_seed_count
  from pg_catalog.jsonb_array_elements(p_seed_totals) as item(value)
  where pg_catalog.jsonb_typeof(item.value) <> 'string'
    or (item.value #>> '{}') !~ '^[+]?[0-9]+([.][0-9]{1,2})?$'
    or (item.value #>> '{}')::numeric not between 0 and 100
    or (item.value #>> '{}')::numeric <> pg_catalog.round((item.value #>> '{}')::numeric, 2);

  if invalid_seed_count <> 0 then
    raise exception 'quota_seed_invalid' using errcode = '22023';
  end if;

  if p_initial_quota is null and coalesce(p_use_initial_quota, false) then
    raise exception 'quota_initial_use_without_value' using errcode = '22023';
  end if;

  if p_projection_ready and p_projected_quota is null then
    raise exception 'quota_projection_value_required' using errcode = '22023';
  end if;
  if not p_projection_ready and p_projected_quota is not null then
    raise exception 'quota_projection_readiness_mismatch' using errcode = '22023';
  end if;

  source_kind := p_projection_source ->> 'kind';
  if source_kind is null
    or source_kind not in (
      'initial_quota',
      'seed_history',
      'method_c_chain',
      'official_history',
      'manual_override',
      'not_ready'
    )
  then
    raise exception 'quota_projection_source_invalid' using errcode = '22023';
  end if;

  if p_projection_source ? 'settings_version' then
    begin
      source_settings_version := (p_projection_source ->> 'settings_version')::bigint;
    exception when others then
      raise exception 'quota_projection_source_invalid' using errcode = '22023';
    end;
  else
    raise exception 'quota_projection_source_invalid' using errcode = '22023';
  end if;

  if p_projection_source ? 'precision' then
    begin
      source_precision := (p_projection_source ->> 'precision')::integer;
    exception when others then
      raise exception 'quota_projection_source_invalid' using errcode = '22023';
    end;
  else
    raise exception 'quota_projection_source_invalid' using errcode = '22023';
  end if;

  source_method := p_projection_source ->> 'method';
  source_rounding_rule := p_projection_source ->> 'rounding_rule';
  if source_method is null
    or source_rounding_rule is null
    or not p_projection_source ? 'history_length'
  then
    raise exception 'quota_projection_source_invalid' using errcode = '22023';
  end if;

  if pg_catalog.jsonb_typeof(p_projection_source -> 'history_length') = 'null' then
    source_history_length := null;
  elsif pg_catalog.jsonb_typeof(p_projection_source -> 'history_length') = 'number' then
    begin
      source_history_length := (p_projection_source ->> 'history_length')::integer;
    exception when others then
      raise exception 'quota_projection_source_invalid' using errcode = '22023';
    end;
  else
    raise exception 'quota_projection_source_invalid' using errcode = '22023';
  end if;

  -- The tenant is derived from the actor. Locking the group serializes this
  -- mutation with quota-settings changes and all other group mutations.
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

  if not found or actor_membership.role <> 'administrator' then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  select event.*
  into prior_event
  from public.audit_events as event
  where event.group_id = locked_group.id
    and event.actor_user_id = p_actor_user_id
    and event.action = 'membership.quota_bootstrap_configured'
    and event.operation_id = p_operation_id;

  if found then
    return query
    select
      (prior_event.after_state ->> 'membership_id')::app.entity_id,
      prior_event.group_id,
      (prior_event.after_state ->> 'projection_version')::bigint,
      (prior_event.after_state ->> 'settings_version')::bigint,
      (prior_event.after_state ->> 'projection_ready')::boolean,
      (prior_event.after_state ->> 'projected_quota')::app.quota_value,
      (prior_event.after_state -> 'projection_source'),
      (prior_event.after_state ->> 'uses_initial_quota')::boolean;
    return;
  end if;

  select membership.*
  into target_membership
  from public.memberships as membership
  where membership.id = p_membership_id
    and membership.group_id = locked_group.id
  for update;

  if not found then
    raise exception 'membership_unavailable' using errcode = 'P0002';
  end if;

  select settings.*
  into current_settings
  from public.group_quota_settings as settings
  where settings.group_id = locked_group.id
  for update;

  if found then
    if p_expected_settings_version <> current_settings.version then
      raise exception 'quota_settings_version_changed' using errcode = '40001';
    end if;
  else
    if p_expected_settings_version <> 0 then
      raise exception 'quota_settings_version_changed' using errcode = '40001';
    end if;
    raise exception 'quota_settings_unavailable' using errcode = 'P0002';
  end if;

  if source_settings_version <> p_expected_settings_version then
    raise exception 'quota_projection_settings_mismatch' using errcode = '22023';
  end if;

  if source_method <> current_settings.method::text
    or source_history_length is distinct from current_settings.moving_average_history_length::integer
    or source_rounding_rule <> current_settings.rounding_rule::text
  then
    raise exception 'quota_projection_rules_mismatch' using errcode = '22023';
  end if;

  if source_precision is not null
    and (
      source_precision not between 0 and 2
      or source_precision <> current_settings.precision
    )
  then
    raise exception 'quota_projection_precision_invalid' using errcode = '22023';
  end if;

  if p_projection_ready
    and p_projected_quota <> pg_catalog.round(p_projected_quota, current_settings.precision)
  then
    raise exception 'quota_projection_precision_invalid' using errcode = '22023';
  end if;

  normalized_use_initial := case
    when p_initial_quota is null then false
    when current_settings.method = 'moving_average'
      and seed_count >= current_settings.moving_average_history_length then false
    when current_settings.method = 'best_10_of_20'
      and seed_count >= 10 then false
    else coalesce(p_use_initial_quota, true)
  end;

  select projection.*
  into current_projection
  from public.membership_quota_projections as projection
  where projection.membership_id = target_membership.id
    and projection.group_id = locked_group.id
  for update;

  if found then
    if p_expected_projection_version <> current_projection.projection_version then
      raise exception 'quota_projection_version_changed' using errcode = '40001';
    end if;
    next_projection_version := current_projection.projection_version + 1;
    before_state := pg_catalog.jsonb_build_object(
      'membership_id', target_membership.id,
      'group_id', locked_group.id,
      'initial_quota', target_membership.initial_quota,
      'uses_initial_quota', target_membership.uses_initial_quota,
      'initial_quota_provenance', target_membership.initial_quota_provenance,
      'seed_totals', (
        select coalesce(
          pg_catalog.jsonb_agg(seed.point_total order by seed.position),
          '[]'::jsonb
        )
        from public.membership_quota_seed_totals as seed
        where seed.membership_id = target_membership.id
      ),
      'projection_version', current_projection.projection_version,
      'settings_version', current_projection.settings_version,
      'projection_ready', current_projection.projection_ready,
      'projected_quota', current_projection.projected_quota,
      'projection_source', current_projection.projection_source
    );
  else
    if p_expected_projection_version <> 0 then
      raise exception 'quota_projection_version_changed' using errcode = '40001';
    end if;
    next_projection_version := 1;
    before_state := pg_catalog.jsonb_build_object(
      'membership_id', target_membership.id,
      'group_id', locked_group.id,
      'initial_quota', target_membership.initial_quota,
      'uses_initial_quota', target_membership.uses_initial_quota,
      'initial_quota_provenance', target_membership.initial_quota_provenance,
      'seed_totals', (
        select coalesce(
          pg_catalog.jsonb_agg(seed.point_total order by seed.position),
          '[]'::jsonb
        )
        from public.membership_quota_seed_totals as seed
        where seed.membership_id = target_membership.id
      ),
      'projection_version', 0,
      'settings_version', null,
      'projection_ready', null,
      'projected_quota', null,
      'projection_source', null
    );
  end if;

  update public.memberships
  set initial_quota = p_initial_quota,
      uses_initial_quota = normalized_use_initial,
      initial_quota_provenance = case
        when p_initial_quota is null then null
        else 'member_bootstrap'
      end
  where id = target_membership.id;

  delete from public.membership_quota_seed_totals
  where membership_id = target_membership.id;

  insert into public.membership_quota_seed_totals (
    membership_id,
    group_id,
    position,
    point_total,
    source,
    source_metadata
  )
  select
    target_membership.id,
    locked_group.id,
    item.ordinal::smallint,
    (item.value #>> '{}')::app.golf_points_value,
    'member_bootstrap',
    pg_catalog.jsonb_build_object('position', item.ordinal)
  from pg_catalog.jsonb_array_elements(p_seed_totals) with ordinality as item(value, ordinal);

  insert into public.membership_quota_projections (
    membership_id,
    group_id,
    projection_version,
    settings_version,
    projection_ready,
    projected_quota,
    projection_source,
    effective_at
  )
  values (
    target_membership.id,
    locked_group.id,
    next_projection_version,
    p_expected_settings_version,
    p_projection_ready,
    p_projected_quota,
    p_projection_source,
    pg_catalog.now()
  )
  on conflict (membership_id) do update
  set group_id = excluded.group_id,
      projection_version = excluded.projection_version,
      settings_version = excluded.settings_version,
      projection_ready = excluded.projection_ready,
      projected_quota = excluded.projected_quota,
      projection_source = excluded.projection_source,
      effective_at = excluded.effective_at;

  after_state := pg_catalog.jsonb_build_object(
    'membership_id', target_membership.id,
    'group_id', locked_group.id,
    'initial_quota', p_initial_quota,
    'uses_initial_quota', normalized_use_initial,
    'initial_quota_provenance', case
      when p_initial_quota is null then null
      else 'member_bootstrap'
    end,
    'seed_totals', p_seed_totals,
    'projection_version', next_projection_version,
    'settings_version', p_expected_settings_version,
    'projection_ready', p_projection_ready,
    'projected_quota', p_projected_quota,
    'projection_source', p_projection_source
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
    operation_id,
    reason
  )
  values (
    locked_group.id,
    p_actor_user_id,
    'membership.quota_bootstrap_configured',
    'membership',
    target_membership.id,
    next_projection_version,
    before_state,
    after_state,
    'server',
    p_correlation_id,
    p_operation_id,
    normalized_reason
  );

  return query
  select
    target_membership.id,
    locked_group.id,
    next_projection_version,
    p_expected_settings_version,
    p_projection_ready,
    p_projected_quota,
    p_projection_source,
    normalized_use_initial;
end;
$$;

comment on function public.configure_membership_quota_bootstrap(
  uuid, uuid, app.quota_value, boolean, jsonb, boolean, app.quota_value,
  jsonb, bigint, bigint, text, uuid, uuid
) is
  'Atomic administrator-only member initial quota, ordered seed replacement, and trusted projection persistence.';

revoke all on function public.configure_membership_quota_bootstrap(
  uuid, uuid, app.quota_value, boolean, jsonb, boolean, app.quota_value,
  jsonb, bigint, bigint, text, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.configure_membership_quota_bootstrap(
  uuid, uuid, app.quota_value, boolean, jsonb, boolean, app.quota_value,
  jsonb, bigint, bigint, text, uuid, uuid
) to service_role;
