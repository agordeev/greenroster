-- Phase 06: atomic official completion, current quota/standings projections,
-- and durable results-published outbox work.
--
-- This migration is deliberately service-only.  The round remains Live until
-- every server and mobile readiness check passes, then one transaction writes
-- the immutable completion run/results, eligible quota history, current
-- projections, standings, round state, audit, and notification outbox entry.

create table public.membership_standings_projections (
  membership_id app.entity_id primary key,
  group_id app.entity_id not null,
  projection_version bigint not null default 1,
  reset_date date,
  merit_total numeric not null default 0,
  rounds_played bigint not null default 0,
  standing_rank bigint,
  source_completion_ids jsonb not null default '[]'::jsonb,
  updated_at app.utc_instant not null default pg_catalog.now(),
  constraint membership_standings_projections_id_group_unique unique (membership_id, group_id),
  constraint membership_standings_projections_membership_group_fk
    foreign key (membership_id, group_id)
    references public.memberships (id, group_id)
    on delete restrict,
  constraint membership_standings_projections_version_positive check (projection_version > 0),
  constraint membership_standings_projections_merit_valid check (
    merit_total <> 'NaN'::numeric
    and merit_total = pg_catalog.round(merit_total, 2)
  ),
  constraint membership_standings_projections_rounds_nonnegative check (rounds_played >= 0),
  constraint membership_standings_projections_rank_positive check (
    standing_rank is null or standing_rank > 0
  ),
  constraint membership_standings_projections_source_array check (
    pg_catalog.jsonb_typeof(source_completion_ids) = 'array'
  )
);

comment on table public.membership_standings_projections is
  'Current server-calculated Order of Merit projection. Official result snapshots remain the historical source of truth.';

create index membership_standings_projections_group_rank_idx
  on public.membership_standings_projections (group_id, standing_rank nulls last, membership_id);

create trigger membership_standings_projections_immutable_membership
before update of membership_id on public.membership_standings_projections
for each row execute function app.reject_id_change('membership_id');

create trigger membership_standings_projections_immutable_group
before update of group_id on public.membership_standings_projections
for each row execute function app.reject_id_change('group_id');

create trigger membership_standings_projections_set_updated_at
before update on public.membership_standings_projections
for each row execute function app.set_updated_at();

alter table public.membership_standings_projections enable row level security;
alter table public.membership_standings_projections force row level security;
revoke all on table public.membership_standings_projections
from public, anon, authenticated, service_role;

create function app.member_quota_projection_after_result(
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
      'official_round_ids', source_rounds
    ),
    use_initial_next,
    history_count;
end;
$$;

comment on function app.member_quota_projection_after_result(
  app.entity_id, app.entity_id, app.entity_id, app.entity_id,
  app.utc_instant, app.golf_points_value, app.plus_minus_value
) is
  'Calculates the next eligible quota before the immutable history row exists, including the candidate official result.';

revoke all on function app.member_quota_projection_after_result(
  app.entity_id, app.entity_id, app.entity_id, app.entity_id,
  app.utc_instant, app.golf_points_value, app.plus_minus_value
) from public, anon, authenticated, service_role;
grant usage on schema app to service_role;
grant execute on function app.member_quota_projection_after_result(
  app.entity_id, app.entity_id, app.entity_id, app.entity_id,
  app.utc_instant, app.golf_points_value, app.plus_minus_value
) to service_role;

create function app.refresh_group_standings(p_group_id app.entity_id)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_group_id is null then
    raise exception 'standings_context_required' using errcode = '22004';
  end if;

  with group_context as (
    select group_record.id, group_record.time_zone, settings.standings_reset_date
    from public.groups as group_record
    left join public.group_quota_settings as settings on settings.group_id = group_record.id
    where group_record.id = p_group_id
  ), totals as (
    select
      membership.id as membership_id,
      membership.group_id,
      coalesce(sum(result.total_merit) filter (where completion.id is not null), 0)::numeric as merit_total,
      count(distinct result.completion_id) filter (where completion.id is not null)::bigint as rounds_played,
      coalesce(
        pg_catalog.jsonb_agg(result.completion_id order by completion.completed_at, result.completion_id)
          filter (where completion.id is not null),
        '[]'::jsonb
      ) as source_completion_ids
    from public.memberships as membership
    cross join group_context
    left join public.round_official_results as result
      on result.membership_id = membership.id
     and result.group_id = membership.group_id
     and result.participant_kind = 'member'::public.round_participant_kind
    left join public.round_completion_runs as completion
      on completion.id = result.completion_id
     and completion.round_id = result.round_id
     and completion.group_id = result.group_id
     and completion.state = 'official'::public.round_completion_run_state
    left join public.rounds as round_record
      on round_record.id = result.round_id
     and round_record.group_id = result.group_id
    where membership.group_id = p_group_id
      and membership.status = 'active'
      and (
        group_context.standings_reset_date is null
        or round_record.scheduled_at is null
        or (round_record.scheduled_at at time zone group_context.time_zone)::date
          >= group_context.standings_reset_date
      )
    group by membership.id, membership.group_id
  ), ranked as (
    select
      totals.*,
      case when totals.rounds_played = 0 then null::bigint else
        pg_catalog.rank() over (order by totals.merit_total desc)
      end as standing_rank
    from totals
  )
  insert into public.membership_standings_projections (
    membership_id, group_id, projection_version, reset_date,
    merit_total, rounds_played, standing_rank, source_completion_ids
  )
  select
    ranked.membership_id,
    ranked.group_id,
    1,
    group_context.standings_reset_date,
    ranked.merit_total,
    ranked.rounds_played,
    ranked.standing_rank,
    ranked.source_completion_ids
  from ranked
  cross join group_context
  on conflict (membership_id) do update
  set group_id = excluded.group_id,
      projection_version = public.membership_standings_projections.projection_version + 1,
      reset_date = excluded.reset_date,
      merit_total = excluded.merit_total,
      rounds_played = excluded.rounds_played,
      standing_rank = excluded.standing_rank,
      source_completion_ids = excluded.source_completion_ids,
      updated_at = pg_catalog.now();
end;
$$;

comment on function app.refresh_group_standings(app.entity_id) is
  'Recomputes the current tenant standings from official member result snapshots, excluding guests and reopened runs.';

revoke all on function app.refresh_group_standings(app.entity_id)
from public, anon, authenticated, service_role;
grant usage on schema app to service_role;
grant execute on function app.refresh_group_standings(app.entity_id)
to service_role;

create function public.complete_live_round(
  p_actor_user_id uuid,
  p_round_id uuid,
  p_expected_round_version bigint,
  p_confirmed boolean,
  p_correlation_id uuid,
  p_operation_id uuid
)
returns table (
  round_id app.entity_id,
  group_id app.entity_id,
  completion_id app.entity_id,
  completion_number bigint,
  state public.round_state,
  version bigint,
  completed_at app.utc_instant,
  outbox_job_id app.entity_id
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_group_id uuid;
  actor_membership_id uuid;
  actor_role public.membership_role;
  locked_group public.groups%rowtype;
  locked_round public.rounds%rowtype;
  saved_round public.rounds%rowtype;
  target_snapshot public.round_rule_snapshots%rowtype;
  prior_event public.audit_events%rowtype;
  completion_record public.round_completion_runs%rowtype;
  result_record record;
  quota_record record;
  projection_record public.membership_quota_projections%rowtype;
  outbox_record public.notification_outbox_jobs%rowtype;
  readiness_payload jsonb;
  result_payload jsonb;
  review_payload jsonb;
  request_fingerprint text;
  review_fingerprint text;
  before_state jsonb;
  after_state jsonb;
  completed_at_value timestamptz := pg_catalog.clock_timestamp();
  completion_number_value bigint;
  blocker_count bigint;
  result_count bigint := 0;
  quota_count bigint := 0;
  projection_version_value bigint;
begin
  if p_actor_user_id is null or p_round_id is null then
    raise exception 'round_completion_context_required' using errcode = '22004';
  end if;
  if p_expected_round_version is null or p_expected_round_version < 1 then
    raise exception 'round_version_invalid' using errcode = '22023';
  end if;
  if p_confirmed is distinct from true then
    raise exception 'round_completion_confirmation_required' using errcode = '22023';
  end if;
  if p_correlation_id is null or p_operation_id is null then
    raise exception 'operation_context_required' using errcode = '22004';
  end if;

  select actor.group_id, actor.membership_id, actor.actor_role
  into actor_group_id, actor_membership_id, actor_role
  from app.resolve_member_management_actor(p_actor_user_id) as actor
  limit 1;
  if actor_group_id is null or actor_role not in ('coordinator', 'administrator') then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;
  if exists (
    select 1
    from auth.users as identity
    where identity.id = p_actor_user_id
      and coalesce(identity.raw_app_meta_data, '{}'::jsonb) ? 'greenroster_password_recovery'
  ) then
    raise exception 'recovery_session_forbidden' using errcode = 'P0003';
  end if;

  select group_record.*
  into locked_group
  from public.groups as group_record
  where group_record.id = actor_group_id
  for update;
  if not found then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  perform membership.id
  from public.memberships as membership
  join public.user_profiles as profile on profile.user_id = membership.user_id
  join auth.users as identity on identity.id = membership.user_id
  where membership.id = actor_membership_id
    and membership.group_id = locked_group.id
    and membership.user_id = p_actor_user_id
    and membership.status = 'active'
    and membership.role in ('coordinator', 'administrator')
    and profile.disabled_at is null
    and identity.email_confirmed_at is not null
    and identity.deleted_at is null
    and not identity.is_anonymous
    and not (coalesce(identity.raw_app_meta_data, '{}'::jsonb) ? 'greenroster_password_recovery')
    and (identity.banned_until is null or identity.banned_until <= pg_catalog.clock_timestamp())
  for update of membership;
  if not found then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  -- Participants are locked before the round to match score-entry ordering:
  -- group -> actor membership -> participant -> round.
  perform participant.id
  from public.round_participants as participant
  where participant.round_id = p_round_id
    and participant.group_id = locked_group.id
  order by participant.id
  for update;
  perform projection.participant_id
  from public.participant_score_projections as projection
  where projection.round_id = p_round_id
    and projection.group_id = locked_group.id
  order by projection.participant_id
  for update;
  perform revision.id
  from public.score_revisions as revision
  where revision.round_id = p_round_id
    and revision.group_id = locked_group.id
  order by revision.id
  for update;
  perform receipt.participant_id
  from public.round_score_sync_receipts as receipt
  where receipt.round_id = p_round_id
    and receipt.group_id = locked_group.id
  order by receipt.participant_id
  for update;

  select round_record.*
  into locked_round
  from public.rounds as round_record
  where round_record.id = p_round_id
    and round_record.group_id = locked_group.id
  for update;
  if not found then
    raise exception 'round_not_found' using errcode = 'P0002';
  end if;

  request_fingerprint := app.member_request_fingerprint(
    pg_catalog.jsonb_build_object(
      'round_id', p_round_id,
      'expected_round_version', p_expected_round_version,
      'confirmed', p_confirmed
    ),
    p_actor_user_id::text || ':' || p_operation_id::text
  );

  select event.*
  into prior_event
  from public.audit_events as event
  where event.group_id = locked_group.id
    and event.actor_user_id = p_actor_user_id
    and event.action = 'round.completed'
    and event.operation_id = p_operation_id;
  if found then
    if prior_event.after_state ->> 'request_fingerprint' <> request_fingerprint then
      raise exception 'operation_id_reused' using errcode = '23505';
    end if;
    return query select
      (prior_event.after_state ->> 'round_id')::app.entity_id,
      prior_event.group_id,
      (prior_event.after_state ->> 'completion_id')::app.entity_id,
      (prior_event.after_state ->> 'completion_number')::bigint,
      (prior_event.after_state ->> 'state')::public.round_state,
      (prior_event.after_state ->> 'version')::bigint,
      (prior_event.after_state ->> 'completed_at')::app.utc_instant,
      (prior_event.after_state ->> 'outbox_job_id')::app.entity_id;
    return;
  end if;

  if locked_round.state <> 'live'::public.round_state then
    raise exception 'round_state_locked' using errcode = 'P0001';
  end if;
  if locked_round.version <> p_expected_round_version then
    raise exception 'round_version_changed' using errcode = '40001';
  end if;

  select count(*)
  into blocker_count
  from app.round_completion_readiness(p_round_id, locked_group.id) as readiness
  where readiness.readiness_status = 'blocked';
  if blocker_count <> 0 then
    select coalesce(
      pg_catalog.jsonb_agg(to_jsonb(readiness) order by readiness.readiness_status,
        readiness.blocker_code nulls last, readiness.warning_code nulls last,
        readiness.participant_id, readiness.details::text),
      '[]'::jsonb
    )
    into readiness_payload
    from app.round_completion_readiness(p_round_id, locked_group.id) as readiness;
    raise exception 'completion_not_ready'
      using errcode = 'P0001', detail = readiness_payload::text;
  end if;

  select snapshot.*
  into target_snapshot
  from public.round_rule_snapshots as snapshot
  where snapshot.round_id = p_round_id
    and snapshot.group_id = locked_group.id;
  if not found then
    raise exception 'rule_snapshot_missing' using errcode = 'P0002';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(to_jsonb(readiness) order by readiness.readiness_status,
      readiness.blocker_code nulls last, readiness.warning_code nulls last,
      readiness.participant_id, readiness.details::text),
    '[]'::jsonb
  )
  into readiness_payload
  from app.round_completion_readiness(p_round_id, locked_group.id) as readiness;
  select coalesce(
    pg_catalog.jsonb_agg(to_jsonb(snapshot_row) order by snapshot_row.participant_id),
    '[]'::jsonb
  )
  into result_payload
  from app.round_official_result_snapshot(p_round_id, locked_group.id) as snapshot_row;
  review_payload := pg_catalog.jsonb_build_object(
    'round_id', p_round_id,
    'round_version', locked_round.version,
    'readiness', readiness_payload,
    'results', result_payload
  );
  review_fingerprint := app.member_request_fingerprint(
    review_payload,
    p_actor_user_id::text || ':' || p_operation_id::text || ':review'
  );

  select coalesce(max(completion.completion_number), 0) + 1
  into completion_number_value
  from public.round_completion_runs as completion
  where completion.round_id = p_round_id
    and completion.group_id = locked_group.id;

  insert into public.round_completion_runs (
    round_id, group_id, completion_number, state, completed_at, completed_by,
    round_version, correlation_id, operation_id
  )
  values (
    p_round_id, locked_group.id, completion_number_value, 'official',
    completed_at_value, p_actor_user_id, locked_round.version + 1,
    p_correlation_id, p_operation_id
  )
  returning * into completion_record;

  for result_record in
    select *
    from app.round_official_result_snapshot(p_round_id, locked_group.id)
  loop
    if result_record.score_revision_id is null then
      raise exception 'completion_score_revision_missing' using errcode = 'P0002';
    end if;

    insert into public.round_official_results (
      completion_id, round_id, group_id, participant_id, participant_kind,
      membership_id, sponsor_membership_id, score_revision_id, golf_points,
      gross_score, net_score, quota_snapshot, plus_minus, ranking_value,
      competition_rank, participation_merit, placement_merit, manual_merit,
      generated_merit, total_merit
    )
    values (
      completion_record.id, result_record.round_id, result_record.group_id,
      result_record.participant_id, result_record.participant_kind,
      result_record.membership_id, result_record.sponsor_membership_id,
      result_record.score_revision_id, result_record.golf_points,
      result_record.gross_score, result_record.net_score, result_record.quota_snapshot,
      result_record.plus_minus, result_record.ranking_value, result_record.competition_rank,
      result_record.participation_merit, result_record.placement_merit,
      result_record.manual_merit, result_record.generated_merit, result_record.total_merit
    );
    result_count := result_count + 1;

    if result_record.participant_kind = 'member'::public.round_participant_kind
      and result_record.membership_id is not null
      and target_snapshot.quota_method is not null
    then
      select candidate.*
      into quota_record
      from app.member_quota_projection_after_result(
        result_record.membership_id,
        locked_group.id,
        p_round_id,
        completion_record.id,
        completed_at_value,
        result_record.golf_points,
        result_record.plus_minus
      ) as candidate;
      if not quota_record.projection_ready then
        raise exception 'completion_quota_not_ready'
          using errcode = 'P0001', detail = quota_record.projection_source::text;
      end if;

      insert into public.membership_quota_history (
        membership_id, group_id, completion_id, round_id, completed_at,
        point_total, plus_minus, quota_before, quota_after, method, source
      )
      values (
        result_record.membership_id, locked_group.id, completion_record.id,
        p_round_id, completed_at_value, result_record.golf_points,
        result_record.plus_minus, quota_record.quota_before,
        quota_record.quota_after, target_snapshot.quota_method,
        quota_record.projection_source
      );

      select projection.*
      into projection_record
      from public.membership_quota_projections as projection
      where projection.membership_id = result_record.membership_id
        and projection.group_id = locked_group.id
      for update;
      if found then
        projection_version_value := projection_record.projection_version + 1;
      else
        projection_version_value := 1;
      end if;
      insert into public.membership_quota_projections (
        membership_id, group_id, projection_version, settings_version,
        projection_ready, projected_quota, projection_source, effective_at
      )
      values (
        result_record.membership_id, locked_group.id, projection_version_value,
        target_snapshot.settings_version, quota_record.projection_ready,
        quota_record.quota_after, quota_record.projection_source, completed_at_value
      )
      on conflict (membership_id) do update
      set group_id = excluded.group_id,
          projection_version = excluded.projection_version,
          settings_version = excluded.settings_version,
          projection_ready = excluded.projection_ready,
          projected_quota = excluded.projected_quota,
          projection_source = excluded.projection_source,
          effective_at = excluded.effective_at;
      update public.memberships as membership
      set uses_initial_quota = quota_record.uses_initial_quota_next
      where membership.id = result_record.membership_id
        and membership.group_id = locked_group.id;
      quota_count := quota_count + 1;
    end if;
  end loop;

  update public.rounds as round_record
  set state = 'completed'::public.round_state,
      version = round_record.version + 1
  where round_record.id = p_round_id
    and round_record.group_id = locked_group.id
  returning * into saved_round;

  perform app.refresh_group_standings(locked_group.id);

  insert into public.notification_outbox_jobs (
    group_id, event_type, aggregate_type, aggregate_id, aggregate_version,
    idempotency_key
  )
  values (
    locked_group.id, 'results_published', 'round_completion', completion_record.id,
    saved_round.version, 'results_published:' || completion_record.id::text
  )
  returning * into outbox_record;

  before_state := pg_catalog.jsonb_build_object(
    'round_id', locked_round.id,
    'group_id', locked_round.group_id,
    'state', locked_round.state,
    'version', locked_round.version
  );
  after_state := pg_catalog.jsonb_build_object(
    'round_id', saved_round.id,
    'group_id', saved_round.group_id,
    'state', saved_round.state,
    'version', saved_round.version,
    'completion_id', completion_record.id,
    'completion_number', completion_record.completion_number,
    'completed_at', completion_record.completed_at,
    'result_count', result_count,
    'quota_count', quota_count,
    'outbox_job_id', outbox_record.id,
    'request_fingerprint', request_fingerprint,
    'review_fingerprint', review_fingerprint
  );
  insert into public.audit_events (
    group_id, actor_user_id, action, target_type, target_id, target_version,
    before_state, after_state, source, correlation_id, operation_id
  )
  values (
    locked_group.id, p_actor_user_id, 'round.completed', 'round', saved_round.id,
    saved_round.version, before_state, after_state, 'portal', p_correlation_id,
    p_operation_id
  );

  return query select
    saved_round.id,
    saved_round.group_id,
    completion_record.id,
    completion_record.completion_number,
    saved_round.state,
    saved_round.version,
    completion_record.completed_at,
    outbox_record.id;
end;
$$;

comment on function public.complete_live_round(uuid, uuid, bigint, boolean, uuid, uuid) is
  'Completes one Live round atomically after server and mobile readiness, preserving immutable results, eligible history, standings, audit, and results outbox work.';

revoke all on function public.complete_live_round(uuid, uuid, bigint, boolean, uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.complete_live_round(uuid, uuid, bigint, boolean, uuid, uuid)
to service_role;
