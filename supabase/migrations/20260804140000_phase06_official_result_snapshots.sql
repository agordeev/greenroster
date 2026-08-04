-- Phase 06: immutable official-result run and participant snapshots.
--
-- Completion mutation is deliberately a later boundary.  This migration
-- establishes the append-only result shape and a server-only calculator so
-- the eventual transaction can persist exactly the values reviewed by the
-- coordinator without recalculating them in a client.

create type public.round_completion_run_state as enum ('official', 'reopened');

create table public.round_completion_runs (
  id app.entity_id primary key default extensions.gen_random_uuid(),
  round_id app.entity_id not null,
  group_id app.entity_id not null,
  completion_number bigint not null,
  state public.round_completion_run_state not null default 'official',
  completed_at app.utc_instant not null,
  completed_by app.entity_id not null references auth.users (id) on delete restrict,
  reopened_at app.utc_instant,
  reopened_by app.entity_id references auth.users (id) on delete restrict,
  reopen_reason text,
  round_version bigint not null,
  correlation_id uuid not null,
  operation_id uuid not null,
  created_at app.utc_instant not null default pg_catalog.now(),
  constraint round_completion_runs_id_group_unique unique (id, group_id),
  constraint round_completion_runs_round_group_fk
    foreign key (round_id, group_id)
    references public.rounds (id, group_id)
    on delete restrict,
  constraint round_completion_runs_number_positive check (completion_number > 0),
  constraint round_completion_runs_round_version_positive check (round_version > 0),
  constraint round_completion_runs_reopen_consistent check (
    (
      state = 'official'
      and reopened_at is null
      and reopened_by is null
      and reopen_reason is null
    )
    or (
      state = 'reopened'
      and reopened_at is not null
      and reopened_by is not null
      and reopen_reason is not null
      and pg_catalog.btrim(reopen_reason) = reopen_reason
      and pg_catalog.length(reopen_reason) between 1 and 500
    )
  )
);

create unique index round_completion_runs_current_official_idx
on public.round_completion_runs (round_id, group_id)
where state = 'official';

create unique index round_completion_runs_operation_idx
on public.round_completion_runs (completed_by, operation_id);

create index round_completion_runs_round_history_idx
on public.round_completion_runs (group_id, round_id, completion_number desc);

comment on table public.round_completion_runs is
  'One retained completion attempt per round. Reopened runs remain for investigation while only one official run may be current.';

create table public.round_official_results (
  completion_id app.entity_id not null,
  round_id app.entity_id not null,
  group_id app.entity_id not null,
  participant_id app.entity_id not null,
  participant_kind public.round_participant_kind not null,
  membership_id app.entity_id,
  sponsor_membership_id app.entity_id,
  score_revision_id app.entity_id not null,
  golf_points app.golf_points_value,
  gross_score app.golf_score_value,
  net_score app.golf_score_value,
  quota_snapshot app.quota_value,
  plus_minus app.plus_minus_value,
  ranking_value app.plus_minus_value,
  competition_rank bigint,
  participation_merit app.participation_merit_value not null default 0,
  placement_merit app.placement_merit_value not null default 0,
  manual_merit app.manual_merit_value not null default 0,
  generated_merit app.generated_merit_value not null default 0,
  total_merit numeric not null default 0,
  created_at app.utc_instant not null default pg_catalog.now(),
  primary key (completion_id, participant_id),
  constraint round_official_results_completion_group_fk
    foreign key (completion_id, group_id)
    references public.round_completion_runs (id, group_id)
    on delete restrict,
  constraint round_official_results_participant_round_group_fk
    foreign key (participant_id, round_id, group_id)
    references public.round_participants (id, round_id, group_id)
    on delete restrict,
  constraint round_official_results_revision_group_fk
    foreign key (score_revision_id, group_id)
    references public.score_revisions (id, group_id)
    on delete restrict,
  constraint round_official_results_kind_shape check (
    (
      participant_kind = 'member'
      and membership_id is not null
      and sponsor_membership_id is null
    )
    or (
      participant_kind = 'guest'
      and membership_id is null
      and sponsor_membership_id is not null
    )
  ),
  constraint round_official_results_rank_consistent check (
    (ranking_value is null and competition_rank is null)
    or (ranking_value is not null and competition_rank is not null and competition_rank > 0)
  ),
  constraint round_official_results_generated_merit_consistent check (
    generated_merit = participation_merit + placement_merit
  ),
  constraint round_official_results_total_merit_valid check (
    total_merit = generated_merit + manual_merit
    and total_merit <> 'NaN'::numeric
    and total_merit between -1000 and 1600
    and total_merit = pg_catalog.round(total_merit, 2)
  )
);

create index round_official_results_round_order_idx
on public.round_official_results (group_id, round_id, competition_rank nulls last, participant_id);

comment on table public.round_official_results is
  'Immutable participant-level official result snapshot. It includes all display and investigation inputs and never changes when prospective settings change.';

create function app.reject_official_result_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'round_official_result_immutable' using errcode = 'P0001';
end;
$$;

revoke all on function app.reject_official_result_mutation() from public, anon, authenticated, service_role;

create trigger round_official_results_append_only
before update or delete on public.round_official_results
for each row execute function app.reject_official_result_mutation();

create function app.validate_official_result_snapshot()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  completion_record public.round_completion_runs%rowtype;
  participant_record public.round_participants%rowtype;
  revision_exists boolean;
begin
  select completion.*
  into completion_record
  from public.round_completion_runs as completion
  where completion.id = new.completion_id
    and completion.group_id = new.group_id;
  if not found or completion_record.round_id <> new.round_id then
    raise exception 'official_result_completion_mismatch' using errcode = '22023';
  end if;

  select participant.*
  into participant_record
  from public.round_participants as participant
  where participant.id = new.participant_id
    and participant.round_id = new.round_id
    and participant.group_id = new.group_id;
  if not found
    or participant_record.participant_kind <> new.participant_kind
    or participant_record.membership_id is distinct from new.membership_id
    or participant_record.sponsor_membership_id is distinct from new.sponsor_membership_id
  then
    raise exception 'official_result_participant_mismatch' using errcode = '22023';
  end if;

  select exists (
    select 1
    from public.score_revisions as revision
    where revision.id = new.score_revision_id
      and revision.group_id = new.group_id
      and revision.round_id = new.round_id
      and revision.participant_id = new.participant_id
  )
  into revision_exists;
  if not revision_exists then
    raise exception 'official_result_revision_mismatch' using errcode = '22023';
  end if;

  return new;
end;
$$;

revoke all on function app.validate_official_result_snapshot() from public, anon, authenticated, service_role;

create trigger round_official_results_validate_snapshot
before insert on public.round_official_results
for each row execute function app.validate_official_result_snapshot();

alter table public.round_completion_runs enable row level security;
alter table public.round_completion_runs force row level security;
alter table public.round_official_results enable row level security;
alter table public.round_official_results force row level security;

revoke all on table
  public.round_completion_runs,
  public.round_official_results
from public, anon, authenticated, service_role;

create function app.round_official_result_snapshot(
  p_round_id app.entity_id,
  p_group_id app.entity_id
)
returns table (
  round_id app.entity_id,
  group_id app.entity_id,
  participant_id app.entity_id,
  participant_kind public.round_participant_kind,
  membership_id app.entity_id,
  sponsor_membership_id app.entity_id,
  score_revision_id app.entity_id,
  golf_points app.golf_points_value,
  gross_score app.golf_score_value,
  net_score app.golf_score_value,
  quota_snapshot app.quota_value,
  plus_minus app.plus_minus_value,
  ranking_value app.plus_minus_value,
  competition_rank bigint,
  participation_merit app.participation_merit_value,
  placement_merit app.placement_merit_value,
  manual_merit app.manual_merit_value,
  generated_merit app.generated_merit_value,
  total_merit numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_snapshot public.round_rule_snapshots%rowtype;
begin
  if p_round_id is null or p_group_id is null then
    raise exception 'round_completion_context_required' using errcode = '22004';
  end if;

  if not exists (
    select 1
    from public.rounds as round_record
    where round_record.id = p_round_id
      and round_record.group_id = p_group_id
  ) then
    raise exception 'round_not_found' using errcode = 'P0002';
  end if;

  select snapshot.*
  into target_snapshot
  from public.round_rule_snapshots as snapshot
  where snapshot.round_id = p_round_id
    and snapshot.group_id = p_group_id;
  if not found then
    raise exception 'rule_snapshot_missing' using errcode = '22023';
  end if;

  return query
  with ranked as (
    select *
    from app.round_competition_ranking(p_round_id, p_group_id)
  ), result_rows as (
    select
      ranked.round_id,
      ranked.group_id,
      ranked.participant_id,
      ranked.participant_kind,
      ranked.membership_id,
      ranked.sponsor_membership_id,
      projection.last_revision_id as score_revision_id,
      projection.golf_points,
      projection.gross_score,
      projection.net_score,
      participant.quota_snapshot,
      projection.plus_minus,
      ranked.ranking_value,
      ranked.competition_rank,
      case
        when ranked.participant_kind = 'member'::public.round_participant_kind
          then target_snapshot.participation_merit
        else 0::app.participation_merit_value
      end as participation_merit,
      case
        when ranked.participant_kind = 'member'::public.round_participant_kind
          then coalesce(
            (
              select (placement.value ->> 'points')::app.placement_merit_value
              from pg_catalog.jsonb_array_elements(target_snapshot.placement_merit) as placement(value)
              where (placement.value ->> 'rank')::bigint = ranked.competition_rank
            ),
            0::app.placement_merit_value
          )
        else 0::app.placement_merit_value
      end as placement_merit,
      case
        when ranked.participant_kind = 'member'::public.round_participant_kind
          then coalesce(projection.manual_merit, 0)::app.manual_merit_value
        else 0::app.manual_merit_value
      end as manual_merit
    from ranked
    join public.round_participants as participant
      on participant.id = ranked.participant_id
     and participant.round_id = p_round_id
     and participant.group_id = p_group_id
    left join public.participant_score_projections as projection
      on projection.participant_id = ranked.participant_id
     and projection.round_id = p_round_id
     and projection.group_id = p_group_id
  )
  select
    result_rows.round_id,
    result_rows.group_id,
    result_rows.participant_id,
    result_rows.participant_kind,
    result_rows.membership_id,
    result_rows.sponsor_membership_id,
    result_rows.score_revision_id,
    result_rows.golf_points,
    result_rows.gross_score,
    result_rows.net_score,
    result_rows.quota_snapshot,
    result_rows.plus_minus,
    result_rows.ranking_value,
    result_rows.competition_rank,
    result_rows.participation_merit,
    result_rows.placement_merit,
    result_rows.manual_merit,
    (result_rows.participation_merit + result_rows.placement_merit)::app.generated_merit_value,
    (
      result_rows.participation_merit
      + result_rows.placement_merit
      + result_rows.manual_merit
    )::numeric
  from result_rows
  order by result_rows.competition_rank nulls last, result_rows.participant_id;
end;
$$;

comment on function app.round_official_result_snapshot(app.entity_id, app.entity_id) is
  'Calculates immutable official-result values from the published snapshot and current server projection, including tie-aware merit components.';

revoke all on function app.round_official_result_snapshot(app.entity_id, app.entity_id)
from public, anon, authenticated, service_role;
grant usage on schema app to service_role;
grant execute on function app.round_official_result_snapshot(app.entity_id, app.entity_id)
to service_role;
