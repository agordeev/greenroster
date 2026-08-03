-- Phase 06: deterministic, read-only completion preview.
--
-- This boundary deliberately does not mutate a round or claim that native
-- mobile queues are synchronized. It packages the server checks, ranking
-- projection, and merit preview so a future completion transaction can use
-- the same authoritative inputs without creating a second client rule engine.

create function public.preview_live_round_completion(
  p_round_id app.entity_id,
  p_group_id app.entity_id
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_round public.rounds%rowtype;
  target_snapshot public.round_rule_snapshots%rowtype;
  readiness_rows jsonb;
  participant_rows jsonb;
  blocker_count bigint;
  warning_count bigint;
begin
  if p_round_id is null or p_group_id is null then
    raise exception 'round_completion_context_required' using errcode = '22004';
  end if;

  select round_record.*
  into target_round
  from public.rounds as round_record
  where round_record.id = p_round_id
    and round_record.group_id = p_group_id;
  if not found then
    raise exception 'round_not_found' using errcode = 'P0002';
  end if;

  select snapshot.*
  into target_snapshot
  from public.round_rule_snapshots as snapshot
  where snapshot.round_id = p_round_id
    and snapshot.group_id = p_group_id;

  select
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'readiness_status', readiness.readiness_status,
          'blocker_code', readiness.blocker_code,
          'warning_code', readiness.warning_code,
          'participant_id', readiness.participant_id,
          'participant_kind', readiness.participant_kind,
          'details', readiness.details
        )
        order by readiness.readiness_status, readiness.blocker_code nulls last,
          readiness.warning_code nulls last, readiness.participant_id
      ),
      '[]'::jsonb
    ),
    count(*) filter (where readiness.readiness_status = 'blocked'),
    count(*) filter (where readiness.readiness_status = 'warning')
  into readiness_rows, blocker_count, warning_count
  from app.round_completion_readiness(p_round_id, p_group_id) as readiness;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'participant_id', ranked.participant_id,
        'participant_kind', ranked.participant_kind,
        'membership_id', ranked.membership_id,
        'sponsor_membership_id', ranked.sponsor_membership_id,
        'ranking_value', ranked.ranking_value,
        'competition_rank', ranked.competition_rank,
        'golf_points', projection.golf_points,
        'gross_score', projection.gross_score,
        'net_score', projection.net_score,
        'quota_snapshot', participant.quota_snapshot,
        'plus_minus', projection.plus_minus,
        'score_revision_id', projection.last_revision_id,
        'merit', pg_catalog.jsonb_build_object(
          'participation', case
            when ranked.participant_kind = 'member'::public.round_participant_kind
              then coalesce(target_snapshot.participation_merit, 0)
            else 0
          end,
          'placement', case
            when ranked.participant_kind = 'member'::public.round_participant_kind
              and ranked.competition_rank is not null
            then coalesce(
              (
                select (placement.value ->> 'points')::numeric
                from pg_catalog.jsonb_array_elements(target_snapshot.placement_merit) as placement(value)
                where (placement.value ->> 'rank')::bigint = ranked.competition_rank
              ),
              0
            )
            else 0
          end,
          'manual', case
            when ranked.participant_kind = 'member'::public.round_participant_kind
              then coalesce(projection.manual_merit, 0)
            else 0
          end,
          'generated', case
            when ranked.participant_kind = 'member'::public.round_participant_kind
            then coalesce(target_snapshot.participation_merit, 0) + coalesce(
              (
                select (placement.value ->> 'points')::numeric
                from pg_catalog.jsonb_array_elements(target_snapshot.placement_merit) as placement(value)
                where (placement.value ->> 'rank')::bigint = ranked.competition_rank
              ),
              0
            )
            else 0
          end,
          'total', case
            when ranked.participant_kind = 'member'::public.round_participant_kind
            then coalesce(target_snapshot.participation_merit, 0) + coalesce(
              (
                select (placement.value ->> 'points')::numeric
                from pg_catalog.jsonb_array_elements(target_snapshot.placement_merit) as placement(value)
                where (placement.value ->> 'rank')::bigint = ranked.competition_rank
              ),
              0
            ) + coalesce(projection.manual_merit, 0)
            else 0
          end
        )
      )
      order by ranked.competition_rank nulls last, ranked.participant_id
    ),
    '[]'::jsonb
  )
  into participant_rows
  from app.round_competition_ranking(p_round_id, p_group_id) as ranked
  join public.round_participants as participant
    on participant.id = ranked.participant_id
   and participant.round_id = p_round_id
   and participant.group_id = p_group_id
  left join public.participant_score_projections as projection
    on projection.participant_id = ranked.participant_id
   and projection.round_id = p_round_id
   and projection.group_id = p_group_id;

  return pg_catalog.jsonb_build_object(
    'round_id', target_round.id,
    'group_id', target_round.group_id,
    'format', target_round.format,
    'state', target_round.state,
    'snapshot_present', target_snapshot.round_id is not null,
    'readiness', readiness_rows,
    'server_checks_passed', blocker_count = 0,
    'warning_count', warning_count,
    'mobile_sync_check', 'unavailable',
    'completion_handshake_required', true,
    'completion_allowed', false,
    'participants', participant_rows
  );
end;
$$;

comment on function public.preview_live_round_completion(app.entity_id, app.entity_id) is
  'Returns a deterministic, read-only completion preview; official completion and native mobile queue synchronization remain separate boundaries.';

revoke all on function public.preview_live_round_completion(app.entity_id, app.entity_id)
from public, anon, authenticated, service_role;
grant execute on function public.preview_live_round_completion(app.entity_id, app.entity_id)
to service_role;
