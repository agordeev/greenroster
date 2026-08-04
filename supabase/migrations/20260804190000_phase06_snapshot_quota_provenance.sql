-- Phase 06: candidate quota calculations must use the immutable publication
-- snapshot, not whatever prospective group settings happen to be current.

create or replace function app.member_quota_projection_after_result(
  p_membership_id app.entity_id,
  p_group_id app.entity_id,
  p_round_id app.entity_id,
  p_completion_id app.entity_id,
  p_completed_at app.utc_instant,
  p_point_total app.golf_points_value,
  p_plus_minus app.plus_minus_value
)
returns table (
  quota_before app.quota_value,
  quota_after app.quota_value,
  projection_ready boolean,
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
  target_snapshot public.round_rule_snapshots%rowtype;
  current_projection record;
  history_count bigint;
  official_count bigint;
  threshold integer;
  calculated_quota numeric;
  source_kind text;
  source_rounds jsonb := '[]'::jsonb;
  use_initial_next boolean := false;
  method_ready boolean := true;
  current_quota numeric;
  row_record record;
  band_item jsonb;
  band_match_count integer;
  band_adjustment numeric;
  band_lower numeric;
  band_upper numeric;
  band_lower_inclusive boolean;
  band_upper_inclusive boolean;
begin
  if p_membership_id is null
    or p_group_id is null
    or p_round_id is null
    or p_completion_id is null
    or p_completed_at is null
    or p_point_total is null
  then
    raise exception 'quota_projection_candidate_context_required' using errcode = '22004';
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

  select snapshot.*
  into target_snapshot
  from public.round_rule_snapshots as snapshot
  where snapshot.round_id = p_round_id
    and snapshot.group_id = p_group_id;
  if not found or target_snapshot.settings_version = 0 or target_snapshot.quota_method is null then
    raise exception 'rule_snapshot_missing' using errcode = 'P0002';
  end if;

  -- Keep the existing group-settings row only as a typed record.  Every
  -- prospective policy value used below comes from the published snapshot.
  settings_record.method := target_snapshot.quota_method;
  settings_record.moving_average_history_length := target_snapshot.moving_average_history_length;
  settings_record.precision := target_snapshot.quota_precision;
  settings_record.rounding_rule := target_snapshot.quota_rounding_rule;
  settings_record.version := target_snapshot.settings_version;

  select projection.*
  into current_projection
  from app.member_quota_projection(p_membership_id, p_group_id) as projection;
  current_quota := current_projection.projected_quota;

  select count(*)
  into history_count
  from (
    select seed.id
    from public.membership_quota_seed_totals as seed
    where seed.membership_id = p_membership_id
      and seed.group_id = p_group_id
    union all
    select history.id
    from public.membership_quota_history as history
    join public.round_completion_runs as completion
      on completion.id = history.completion_id
     and completion.round_id = history.round_id
     and completion.group_id = history.group_id
     and completion.state = 'official'::public.round_completion_run_state
    where history.membership_id = p_membership_id
      and history.group_id = p_group_id
  ) as existing_history;
  history_count := history_count + 1;

  select count(*) + 1
  into official_count
  from public.membership_quota_history as history
  join public.round_completion_runs as completion
    on completion.id = history.completion_id
   and completion.round_id = history.round_id
   and completion.group_id = history.group_id
   and completion.state = 'official'::public.round_completion_run_state
  where history.membership_id = p_membership_id
    and history.group_id = p_group_id;

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
    else
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
          history.completed_at,
          history.id,
          history.round_id,
          history.point_total
        from public.membership_quota_history as history
        join public.round_completion_runs as completion
          on completion.id = history.completion_id
         and completion.round_id = history.round_id
         and completion.group_id = history.group_id
         and completion.state = 'official'::public.round_completion_run_state
        where history.membership_id = p_membership_id
          and history.group_id = p_group_id
        union all
        select true, null::bigint, p_completed_at, p_completion_id, p_round_id, p_point_total
      ), selected as (
        select history.*
        from history
        order by history.is_official desc, history.completed_at desc nulls last,
          history.seed_position desc nulls last, history.tie_id desc
        limit settings_record.moving_average_history_length
      )
      select avg(selected.point_total)
      into calculated_quota
      from selected;
      source_kind := case when official_count > 0 then 'official_history' else 'seed_history' end;
      select coalesce(
        pg_catalog.jsonb_agg(selected.round_id order by selected.completed_at, selected.tie_id)
          filter (where selected.round_id is not null),
        '[]'::jsonb
      )
      into source_rounds
      from (
        with history as (
          select false as is_official, seed.position::bigint as seed_position,
            null::app.utc_instant as completed_at, seed.id as tie_id,
            null::app.entity_id as round_id, seed.point_total
          from public.membership_quota_seed_totals as seed
          where seed.membership_id = p_membership_id and seed.group_id = p_group_id
          union all
          select true, null::bigint, history.completed_at, history.id,
            history.round_id, history.point_total
          from public.membership_quota_history as history
          join public.round_completion_runs as completion
            on completion.id = history.completion_id
           and completion.round_id = history.round_id
           and completion.group_id = history.group_id
           and completion.state = 'official'::public.round_completion_run_state
          where history.membership_id = p_membership_id and history.group_id = p_group_id
          union all
          select true, null::bigint, p_completed_at, p_completion_id, p_round_id, p_point_total
        )
        select history.*
        from history
        order by history.is_official desc, history.completed_at desc nulls last,
          history.seed_position desc nulls last, history.tie_id desc
        limit settings_record.moving_average_history_length
      ) as selected;
    end if;
  elsif settings_record.method = 'best_10_of_20'::public.quota_method then
    if use_initial_next then
      calculated_quota := membership_record.initial_quota;
      source_kind := 'initial_quota';
    else
      with history as (
        select false as is_official, seed.position::bigint as seed_position,
          null::app.utc_instant as completed_at, seed.id as tie_id,
          null::app.entity_id as round_id, seed.point_total
        from public.membership_quota_seed_totals as seed
        where seed.membership_id = p_membership_id and seed.group_id = p_group_id
        union all
        select true, null::bigint, history.completed_at, history.id,
          history.round_id, history.point_total
        from public.membership_quota_history as history
        join public.round_completion_runs as completion
          on completion.id = history.completion_id
         and completion.round_id = history.round_id
         and completion.group_id = history.group_id
         and completion.state = 'official'::public.round_completion_run_state
        where history.membership_id = p_membership_id and history.group_id = p_group_id
        union all
        select true, null::bigint, p_completed_at, p_completion_id, p_round_id, p_point_total
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
      select avg(selected.point_total)
      into calculated_quota
      from selected;
      source_kind := case when official_count > 0 then 'official_history' else 'seed_history' end;
      select coalesce(
        pg_catalog.jsonb_agg(selected.round_id order by selected.completed_at, selected.tie_id)
          filter (where selected.round_id is not null),
        '[]'::jsonb
      )
      into source_rounds
      from (
        with history as (
          select false as is_official, seed.position::bigint as seed_position,
            null::app.utc_instant as completed_at, seed.id as tie_id,
            null::app.entity_id as round_id, seed.point_total
          from public.membership_quota_seed_totals as seed
          where seed.membership_id = p_membership_id and seed.group_id = p_group_id
          union all
          select true, null::bigint, history.completed_at, history.id,
            history.round_id, history.point_total
          from public.membership_quota_history as history
          join public.round_completion_runs as completion
            on completion.id = history.completion_id
           and completion.round_id = history.round_id
           and completion.group_id = history.group_id
           and completion.state = 'official'::public.round_completion_run_state
          where history.membership_id = p_membership_id and history.group_id = p_group_id
          union all
          select true, null::bigint, p_completed_at, p_completion_id, p_round_id, p_point_total
        ), last_twenty as (
          select history.*
          from history
          order by history.is_official desc, history.completed_at desc nulls last,
            history.seed_position desc nulls last, history.tie_id desc
          limit 20
        )
        select last_twenty.*
        from last_twenty
        order by last_twenty.point_total desc, last_twenty.tie_id desc
        limit 10
      ) as selected;
    end if;
  else
    current_quota := coalesce(current_quota, membership_record.initial_quota);
    if current_quota is null or p_plus_minus is null then
      method_ready := false;
    else
      select snapshot.quota_precision, snapshot.adjustment_bands
      into row_record
      from public.round_rule_snapshots as snapshot
      where snapshot.round_id = p_round_id
        and snapshot.group_id = p_group_id;
      if not found then
        raise exception 'rule_snapshot_missing' using errcode = 'P0002';
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
          p_plus_minus > band_lower
          or (p_plus_minus = band_lower and band_lower_inclusive)
        ) and (
          p_plus_minus < band_upper
          or (p_plus_minus = band_upper and band_upper_inclusive)
        ) then
          band_match_count := band_match_count + 1;
          band_adjustment := (band_item ->> 'adjustment')::numeric;
        end if;
      end loop;
      if band_match_count <> 1 then
        method_ready := false;
      else
        calculated_quota := pg_catalog.round(current_quota + band_adjustment, row_record.quota_precision);
        source_kind := 'method_c_chain';
        select coalesce(
          pg_catalog.jsonb_agg(history.round_id order by history.completed_at, history.completion_id),
          '[]'::jsonb
        )
        into source_rounds
        from (
          select history.round_id, history.completed_at, history.completion_id
          from public.membership_quota_history as history
          join public.round_completion_runs as completion
            on completion.id = history.completion_id
           and completion.round_id = history.round_id
           and completion.group_id = history.group_id
           and completion.state = 'official'::public.round_completion_run_state
          where history.membership_id = p_membership_id
            and history.group_id = p_group_id
          union all
          select p_round_id, p_completed_at, p_completion_id
        ) as history;
      end if;
    end if;
    use_initial_next := false;
  end if;

  if calculated_quota is null then
    method_ready := false;
  else
    calculated_quota := pg_catalog.round(calculated_quota, settings_record.precision);
    if calculated_quota < 0 or calculated_quota > 100 then
      method_ready := false;
    end if;
  end if;

  return query select
    current_projection.projected_quota::app.quota_value,
    case when method_ready then calculated_quota::app.quota_value else null::app.quota_value end,
    method_ready,
    pg_catalog.jsonb_build_object(
      'kind', case when method_ready then source_kind else 'not_ready' end,
      'settings_version', settings_record.version,
      'method', settings_record.method,
      'history_length', settings_record.moving_average_history_length,
      'precision', settings_record.precision,
      'rounding_rule', settings_record.rounding_rule,
      'eligible_count', history_count,
      'official_round_ids', source_rounds,
      'round_snapshot_id', p_round_id
    ),
    use_initial_next,
    history_count;
end;
$$;

comment on function app.member_quota_projection_after_result(
  app.entity_id, app.entity_id, app.entity_id, app.entity_id,
  app.utc_instant, app.golf_points_value, app.plus_minus_value
) is
  'Calculates the next eligible quota from the immutable published round snapshot before the history row exists.';

revoke all on function app.member_quota_projection_after_result(
  app.entity_id, app.entity_id, app.entity_id, app.entity_id,
  app.utc_instant, app.golf_points_value, app.plus_minus_value
) from public, anon, authenticated, service_role;
grant usage on schema app to service_role;
grant execute on function app.member_quota_projection_after_result(
  app.entity_id, app.entity_id, app.entity_id, app.entity_id,
  app.utc_instant, app.golf_points_value, app.plus_minus_value
) to service_role;
