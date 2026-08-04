-- Phase 06: eligible official quota history and server-side recomputation.
--
-- Seed totals remain bootstrap inputs.  Only retained official completion runs
-- contribute round history; reopened runs are excluded by their run state.

alter table public.round_completion_runs
  add constraint round_completion_runs_id_round_group_unique
  unique (id, round_id, group_id);

create table public.membership_quota_history (
  id app.entity_id primary key default extensions.gen_random_uuid(),
  membership_id app.entity_id not null,
  group_id app.entity_id not null,
  completion_id app.entity_id not null,
  round_id app.entity_id not null,
  completed_at app.utc_instant not null,
  point_total app.golf_points_value not null,
  plus_minus app.plus_minus_value,
  quota_before app.quota_value,
  quota_after app.quota_value not null,
  method public.quota_method not null,
  source jsonb not null default '{}'::jsonb,
  created_at app.utc_instant not null default pg_catalog.now(),
  constraint membership_quota_history_id_group_unique unique (id, group_id),
  constraint membership_quota_history_completion_round_group_fk
    foreign key (completion_id, round_id, group_id)
    references public.round_completion_runs (id, round_id, group_id)
    on delete restrict,
  constraint membership_quota_history_membership_group_fk
    foreign key (membership_id, group_id)
    references public.memberships (id, group_id)
    on delete restrict,
  constraint membership_quota_history_round_group_fk
    foreign key (round_id, group_id)
    references public.rounds (id, group_id)
    on delete restrict,
  constraint membership_quota_history_source_object check (
    pg_catalog.jsonb_typeof(source) = 'object'
  ),
  constraint membership_quota_history_before_valid check (
    quota_before is null or quota_before between 0 and 100
  ),
  constraint membership_quota_history_unique_completion_member
    unique (completion_id, membership_id)
);

create index membership_quota_history_member_order_idx
on public.membership_quota_history (group_id, membership_id, completed_at, completion_id);

comment on table public.membership_quota_history is
  'Eligible member golf-point history derived only from official completion runs; guests, reopened runs, cancelled rounds, and non-playing participants never enter it.';

create function app.reject_quota_history_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'membership_quota_history_immutable' using errcode = 'P0001';
end;
$$;

revoke all on function app.reject_quota_history_mutation() from public, anon, authenticated, service_role;

create trigger membership_quota_history_append_only
before update or delete on public.membership_quota_history
for each row execute function app.reject_quota_history_mutation();

alter table public.membership_quota_history enable row level security;
alter table public.membership_quota_history force row level security;
revoke all on table public.membership_quota_history from public, anon, authenticated, service_role;

create function app.member_quota_projection(
  p_membership_id app.entity_id,
  p_group_id app.entity_id
)
returns table (
  membership_id app.entity_id,
  group_id app.entity_id,
  projection_ready boolean,
  projected_quota app.quota_value,
  projection_source jsonb,
  uses_initial_quota_next boolean,
  eligible_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  membership_record public.memberships%rowtype;
  settings_record public.group_quota_settings%rowtype;
  history_count bigint;
  official_count bigint;
  threshold integer;
  calculated_quota numeric;
  source_kind text;
  source_rounds jsonb;
  use_initial_next boolean;
  current_quota numeric;
  row_record record;
  band_item jsonb;
  band_match_count integer;
  band_adjustment numeric;
  band_lower numeric;
  band_upper numeric;
  band_lower_inclusive boolean;
  band_upper_inclusive boolean;
  method_ready boolean := true;
begin
  if p_membership_id is null or p_group_id is null then
    raise exception 'quota_projection_context_required' using errcode = '22004';
  end if;

  select membership.*
  into membership_record
  from public.memberships as membership
  where membership.id = p_membership_id
    and membership.group_id = p_group_id;
  if not found then
    raise exception 'membership_unavailable' using errcode = 'P0002';
  end if;

  select settings.*
  into settings_record
  from public.group_quota_settings as settings
  where settings.group_id = p_group_id;
  if not found then
    raise exception 'quota_settings_unavailable' using errcode = 'P0002';
  end if;

  select count(*)
  into history_count
  from (
    select seed.id
    from public.membership_quota_seed_totals as seed
    where seed.membership_id = p_membership_id
      and seed.group_id = p_group_id
    union all
    select result.id
    from public.membership_quota_history as result
    where result.membership_id = p_membership_id
      and result.group_id = p_group_id
      and exists (
        select 1
        from public.round_completion_runs as completion
        where completion.id = result.completion_id
          and completion.round_id = result.round_id
          and completion.group_id = result.group_id
          and completion.state = 'official'::public.round_completion_run_state
      )
  ) as history;

  select count(*)
  into official_count
  from public.membership_quota_history as result
  where result.membership_id = p_membership_id
    and result.group_id = p_group_id
    and exists (
      select 1
      from public.round_completion_runs as completion
      where completion.id = result.completion_id
        and completion.round_id = result.round_id
        and completion.group_id = result.group_id
        and completion.state = 'official'::public.round_completion_run_state
    );

  select coalesce(
    pg_catalog.jsonb_agg(value.round_id order by value.completed_at, value.completion_id),
    '[]'::jsonb
  )
  into source_rounds
  from (
    select history.round_id, history.completed_at, history.completion_id
    from public.membership_quota_history as history
    where history.membership_id = p_membership_id
      and history.group_id = p_group_id
      and exists (
        select 1
        from public.round_completion_runs as completion
        where completion.id = history.completion_id
          and completion.round_id = history.round_id
          and completion.group_id = history.group_id
          and completion.state = 'official'::public.round_completion_run_state
      )
  ) as value;

  threshold := case
    when settings_record.method = 'moving_average'::public.quota_method
      then settings_record.moving_average_history_length
    when settings_record.method = 'best_10_of_20'::public.quota_method
      then 10
    else 1
  end;
  use_initial_next := membership_record.initial_quota is not null
    and membership_record.uses_initial_quota
    and history_count < threshold;

  if settings_record.method = 'moving_average'::public.quota_method then
    if use_initial_next then
      calculated_quota := membership_record.initial_quota;
      source_kind := 'initial_quota';
    elsif history_count = 0 then
      calculated_quota := membership_record.initial_quota;
      source_kind := 'initial_quota';
      if calculated_quota is null then method_ready := false; end if;
    else
      with history as (
        select
          false as is_official,
          seed.position::bigint as seed_position,
          null::app.utc_instant as completed_at,
          seed.id as tie_id,
          seed.point_total
        from public.membership_quota_seed_totals as seed
        where seed.membership_id = p_membership_id
          and seed.group_id = p_group_id
        union all
        select
          true,
          null::bigint,
          quota.completed_at,
          quota.id,
          quota.point_total
        from public.membership_quota_history as quota
        join public.round_completion_runs as completion
          on completion.id = quota.completion_id
         and completion.round_id = quota.round_id
         and completion.group_id = quota.group_id
         and completion.state = 'official'::public.round_completion_run_state
        where quota.membership_id = p_membership_id
          and quota.group_id = p_group_id
      )
      select avg(selected.point_total)
      into calculated_quota
      from (
        select history.point_total
        from history
        order by history.is_official desc, history.completed_at desc nulls last,
          history.seed_position desc nulls last, history.tie_id desc
        limit settings_record.moving_average_history_length
      ) as selected;
      source_kind := case when official_count > 0 then 'official_history' else 'seed_history' end;
    end if;
  elsif settings_record.method = 'best_10_of_20'::public.quota_method then
    if use_initial_next then
      calculated_quota := membership_record.initial_quota;
      source_kind := 'initial_quota';
    elsif history_count = 0 then
      calculated_quota := membership_record.initial_quota;
      source_kind := 'initial_quota';
      if calculated_quota is null then method_ready := false; end if;
    else
      with history as (
        select
          false as is_official,
          seed.position::bigint as seed_position,
          null::app.utc_instant as completed_at,
          seed.id as tie_id,
          seed.point_total
        from public.membership_quota_seed_totals as seed
        where seed.membership_id = p_membership_id
          and seed.group_id = p_group_id
        union all
        select
          true,
          null::bigint,
          quota.completed_at,
          quota.id,
          quota.point_total
        from public.membership_quota_history as quota
        join public.round_completion_runs as completion
          on completion.id = quota.completion_id
         and completion.round_id = quota.round_id
         and completion.group_id = quota.group_id
         and completion.state = 'official'::public.round_completion_run_state
        where quota.membership_id = p_membership_id
          and quota.group_id = p_group_id
      ), last_twenty as (
        select history.point_total
        from history
        order by history.is_official desc, history.completed_at desc nulls last,
          history.seed_position desc nulls last, history.tie_id desc
        limit 20
      )
      select avg(selected.point_total)
      into calculated_quota
      from (
        select last_twenty.point_total
        from last_twenty
        order by last_twenty.point_total desc
        limit 10
      ) as selected;
      source_kind := case when official_count > 0 then 'official_history' else 'seed_history' end;
    end if;
  else
    current_quota := membership_record.initial_quota;
    for row_record in
      select
        quota.point_total,
        quota.plus_minus,
        snapshot.quota_precision,
        snapshot.adjustment_bands
      from public.membership_quota_history as quota
      join public.round_completion_runs as completion
        on completion.id = quota.completion_id
       and completion.round_id = quota.round_id
       and completion.group_id = quota.group_id
       and completion.state = 'official'::public.round_completion_run_state
      join public.round_rule_snapshots as snapshot
        on snapshot.round_id = quota.round_id
       and snapshot.group_id = quota.group_id
      where quota.membership_id = p_membership_id
        and quota.group_id = p_group_id
      order by quota.completed_at, quota.completion_id
    loop
      if current_quota is null or row_record.plus_minus is null then
        method_ready := false;
        exit;
      end if;
      band_match_count := 0;
      band_adjustment := null;
      for band_item in
        select value
        from pg_catalog.jsonb_array_elements(row_record.adjustment_bands) as element(value)
      loop
        band_lower := (band_item ->> 'lower_bound')::numeric;
        band_upper := (band_item ->> 'upper_bound')::numeric;
        band_lower_inclusive := (band_item ->> 'lower_inclusive')::boolean;
        band_upper_inclusive := (band_item ->> 'upper_inclusive')::boolean;
        if (
          row_record.plus_minus > band_lower
          or (row_record.plus_minus = band_lower and band_lower_inclusive)
        ) and (
          row_record.plus_minus < band_upper
          or (row_record.plus_minus = band_upper and band_upper_inclusive)
        ) then
          band_match_count := band_match_count + 1;
          band_adjustment := (band_item ->> 'adjustment')::numeric;
        end if;
      end loop;
      if band_match_count <> 1 then
        method_ready := false;
        exit;
      end if;
      current_quota := pg_catalog.round(
        current_quota + band_adjustment,
        row_record.quota_precision
      );
      if current_quota < 0 or current_quota > 100 then
        method_ready := false;
        exit;
      end if;
    end loop;
    calculated_quota := current_quota;
    source_kind := case
      when official_count > 0 then 'method_c_chain'
      when calculated_quota is not null then 'initial_quota'
      else 'not_ready'
    end;
    use_initial_next := membership_record.initial_quota is not null
      and membership_record.uses_initial_quota
      and official_count = 0;
  end if;

  if settings_record.method = 'moving_average'::public.quota_method
    and not use_initial_next
    and history_count > 0
  then
    with history as (
      select
        false as is_official,
        seed.position::bigint as seed_position,
        null::app.utc_instant as completed_at,
        seed.id as tie_id,
        null::app.entity_id as round_id,
        seed.point_total
      from public.membership_quota_seed_totals as seed
      where seed.membership_id = p_membership_id
        and seed.group_id = p_group_id
      union all
      select
        true,
        null::bigint,
        quota.completed_at,
        quota.id,
        quota.round_id,
        quota.point_total
      from public.membership_quota_history as quota
      join public.round_completion_runs as completion
        on completion.id = quota.completion_id
       and completion.round_id = quota.round_id
       and completion.group_id = quota.group_id
       and completion.state = 'official'::public.round_completion_run_state
      where quota.membership_id = p_membership_id
        and quota.group_id = p_group_id
    ), selected as (
      select history.*
      from history
      order by history.is_official desc, history.completed_at desc nulls last,
        history.seed_position desc nulls last, history.tie_id desc
      limit settings_record.moving_average_history_length
    )
    select coalesce(
      pg_catalog.jsonb_agg(selected.round_id order by selected.completed_at, selected.tie_id)
        filter (where selected.round_id is not null),
      '[]'::jsonb
    )
    into source_rounds
    from selected;
  elsif settings_record.method = 'best_10_of_20'::public.quota_method
    and not use_initial_next
    and history_count > 0
  then
    with history as (
      select
        false as is_official,
        seed.position::bigint as seed_position,
        null::app.utc_instant as completed_at,
        seed.id as tie_id,
        null::app.entity_id as round_id,
        seed.point_total
      from public.membership_quota_seed_totals as seed
      where seed.membership_id = p_membership_id
        and seed.group_id = p_group_id
      union all
      select
        true,
        null::bigint,
        quota.completed_at,
        quota.id,
        quota.round_id,
        quota.point_total
      from public.membership_quota_history as quota
      join public.round_completion_runs as completion
        on completion.id = quota.completion_id
       and completion.round_id = quota.round_id
       and completion.group_id = quota.group_id
       and completion.state = 'official'::public.round_completion_run_state
      where quota.membership_id = p_membership_id
        and quota.group_id = p_group_id
    ), last_twenty as (
      select history.*
      from history
      order by history.is_official desc, history.completed_at desc nulls last,
        history.seed_position desc nulls last, history.tie_id desc
      limit 20
    ), selected as (
      select last_twenty.*
      from last_twenty
      order by last_twenty.point_total desc, last_twenty.tie_id desc
      limit 10
    )
    select coalesce(
      pg_catalog.jsonb_agg(selected.round_id order by selected.completed_at, selected.tie_id)
        filter (where selected.round_id is not null),
      '[]'::jsonb
    )
    into source_rounds
    from selected;
  elsif settings_record.method = 'previous_plus_minus'::public.quota_method then
    select coalesce(
      pg_catalog.jsonb_agg(history.round_id order by history.completed_at, history.completion_id),
      '[]'::jsonb
    )
    into source_rounds
    from public.membership_quota_history as history
    join public.round_completion_runs as completion
      on completion.id = history.completion_id
     and completion.round_id = history.round_id
     and completion.group_id = history.group_id
     and completion.state = 'official'::public.round_completion_run_state
    where history.membership_id = p_membership_id
      and history.group_id = p_group_id;
  else
    source_rounds := '[]'::jsonb;
  end if;

  if calculated_quota is not null then
    calculated_quota := pg_catalog.round(calculated_quota, settings_record.precision);
    if calculated_quota < 0 or calculated_quota > 100 then
      method_ready := false;
    end if;
  end if;

  return query select
    p_membership_id,
    p_group_id,
    method_ready and calculated_quota is not null,
    case when method_ready then calculated_quota::app.quota_value else null::app.quota_value end,
    pg_catalog.jsonb_build_object(
      'kind', case when method_ready and calculated_quota is not null then source_kind else 'not_ready' end,
      'settings_version', settings_record.version,
      'method', settings_record.method,
      'history_length', settings_record.moving_average_history_length,
      'precision', settings_record.precision,
      'rounding_rule', settings_record.rounding_rule,
      'eligible_count', history_count,
      'official_round_ids', source_rounds
    ),
    use_initial_next,
    history_count;
end;
$$;

comment on function app.member_quota_projection(app.entity_id, app.entity_id) is
  'Calculates the current member quota from seed totals plus active official result history using the group method and exact rounding policy.';

revoke all on function app.member_quota_projection(app.entity_id, app.entity_id)
from public, anon, authenticated, service_role;
grant usage on schema app to service_role;
grant execute on function app.member_quota_projection(app.entity_id, app.entity_id)
to service_role;
