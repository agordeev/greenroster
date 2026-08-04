-- Phase 06: server-authoritative completion consequences.
--
-- The coordinator must see who won, which members' quota/standing projections
-- will change, and the participant names before confirming the consequential
-- completion transaction. This remains a stable read-only projection: it does
-- not write quota, standings, completion, or notification state.

create or replace function public.preview_live_round_completion_server(
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
  consequence_summary jsonb;
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

  with ranked_values as (
    select
      ranked.participant_id,
      ranked.participant_kind,
      ranked.membership_id,
      ranked.sponsor_membership_id,
      ranked.ranking_value,
      ranked.competition_rank,
      participant.guest_first_name,
      participant.guest_last_name,
      coalesce(golfer.first_name, profile.first_name) as member_first_name,
      coalesce(golfer.last_name, profile.last_name) as member_last_name,
      projection.golf_points,
      projection.gross_score,
      projection.net_score,
      participant.quota_snapshot,
      projection.plus_minus,
      projection.last_revision_id as score_revision_id,
      coalesce(target_snapshot.participation_merit, 0)::numeric as participation_merit,
      coalesce(placement.merit_points, 0)::numeric as placement_merit,
      coalesce(projection.manual_merit, 0)::numeric as manual_merit
    from app.round_competition_ranking(p_round_id, p_group_id) as ranked
    join public.round_participants as participant
      on participant.id = ranked.participant_id
     and participant.round_id = p_round_id
     and participant.group_id = p_group_id
    left join public.participant_score_projections as projection
      on projection.participant_id = ranked.participant_id
     and projection.round_id = p_round_id
     and projection.group_id = p_group_id
    left join public.memberships as membership
      on membership.id = ranked.membership_id
     and membership.group_id = p_group_id
    left join public.membership_golfer_profiles as golfer
      on golfer.membership_id = membership.id
     and golfer.group_id = p_group_id
    left join public.user_profiles as profile
      on profile.user_id = membership.user_id
    left join lateral (
      select max((placement.value ->> 'points')::numeric) as merit_points
      from pg_catalog.jsonb_array_elements(
        coalesce(target_snapshot.placement_merit, '[]'::jsonb)
      ) as placement(value)
      where (placement.value ->> 'rank')::bigint = ranked.competition_rank
    ) as placement on true
  ), valued as (
    select
      ranked_values.*,
      case
        when ranked_values.participant_kind = 'member'::public.round_participant_kind
        then ranked_values.participation_merit + ranked_values.placement_merit
        else 0
      end as generated_merit,
      case
        when ranked_values.participant_kind = 'member'::public.round_participant_kind
        then ranked_values.participation_merit
          + ranked_values.placement_merit
          + ranked_values.manual_merit
        else 0
      end as total_merit
    from ranked_values
  ), member_values as materialized (
    select *
    from valued
    where participant_kind = 'member'::public.round_participant_kind
      and membership_id is not null
  ), member_scored_values as materialized (
    select *
    from member_values
    where golf_points is not null
      and exists (
        select 1
        from public.group_quota_settings as settings
        where settings.group_id = p_group_id
      )
  ), current_quota as materialized (
    select
      member_values.membership_id,
      projection.projected_quota::app.quota_value as quota_before
    from member_values
    cross join lateral app.member_quota_projection(
      member_values.membership_id,
      p_group_id
    ) as projection
    where exists (
      select 1
      from public.group_quota_settings as settings
      where settings.group_id = p_group_id
    )
  ), candidate_quota as materialized (
    select
      member_scored_values.membership_id,
      candidate.quota_after::app.quota_value as quota_after
    from member_scored_values
    cross join lateral app.member_quota_projection_after_result(
      member_scored_values.membership_id,
      p_group_id,
      p_round_id,
      p_round_id,
      coalesce(target_round.scheduled_at, pg_catalog.statement_timestamp())::app.utc_instant,
      member_scored_values.golf_points,
      member_scored_values.plus_minus
    ) as candidate
  ), quota_impacts as (
    select
      member_values.membership_id,
      current_quota.quota_before,
      candidate_quota.quota_after
    from member_values
    left join current_quota
      on current_quota.membership_id = member_values.membership_id
    left join candidate_quota
      on candidate_quota.membership_id = member_values.membership_id
  ), standing_inputs as (
    select
      membership.id as membership_id,
      current_standing.standing_rank as standing_before,
      coalesce(current_standing.merit_total, 0)::numeric
        + coalesce(valued.total_merit, 0)::numeric as merit_after,
      coalesce(current_standing.rounds_played, 0)::bigint
        + case when valued.membership_id is null then 0 else 1 end as rounds_after
    from public.memberships as membership
    join auth.users as identity
      on identity.id = membership.user_id
    join public.user_profiles as profile
      on profile.user_id = membership.user_id
    left join public.membership_standings_projections as current_standing
      on current_standing.membership_id = membership.id
     and current_standing.group_id = p_group_id
    left join valued
      on valued.membership_id = membership.id
     and valued.participant_kind = 'member'::public.round_participant_kind
    where membership.group_id = p_group_id
      and membership.status = 'active'
      and profile.disabled_at is null
      and identity.email_confirmed_at is not null
      and identity.deleted_at is null
      and not identity.is_anonymous
  ), standing_after as (
    select
      standing_inputs.*,
      case
        when standing_inputs.rounds_after = 0 then null::bigint
        else pg_catalog.rank() over (
          order by (standing_inputs.rounds_after = 0), standing_inputs.merit_after desc
        )
      end as standing_after
    from standing_inputs
  ), impacts as (
    select
      valued.*,
      quota_impacts.quota_before,
      quota_impacts.quota_after,
      standing_after.standing_before,
      standing_after.standing_after,
      case
        when standing_after.standing_before is null
          or standing_after.standing_after is null
        then null::bigint
        else standing_after.standing_before - standing_after.standing_after
      end as standing_delta
    from valued
    left join quota_impacts
      on quota_impacts.membership_id = valued.membership_id
    left join standing_after
      on standing_after.membership_id = valued.membership_id
  ), winner_counts as (
    select count(*) filter (where competition_rank = 1)::bigint as winner_count
    from impacts
  )
  select
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'participant_id', impacts.participant_id,
          'participant_kind', impacts.participant_kind,
          'membership_id', impacts.membership_id,
          'sponsor_membership_id', impacts.sponsor_membership_id,
          'participant_name', case
            when impacts.participant_kind = 'guest'::public.round_participant_kind
              then pg_catalog.concat_ws(' ', impacts.guest_first_name, impacts.guest_last_name)
            else pg_catalog.concat_ws(' ', impacts.member_first_name, impacts.member_last_name)
          end,
          'ranking_value', impacts.ranking_value,
          'competition_rank', impacts.competition_rank,
          'is_winner', impacts.competition_rank = 1,
          'winner_tie_size', case
            when impacts.competition_rank = 1 then winner_counts.winner_count
            else 0
          end,
          'golf_points', impacts.golf_points,
          'gross_score', impacts.gross_score,
          'net_score', impacts.net_score,
          'quota_snapshot', impacts.quota_snapshot,
          'quota_before', impacts.quota_before,
          'quota_after', impacts.quota_after,
          'plus_minus', impacts.plus_minus,
          'score_revision_id', impacts.score_revision_id,
          'standing_before', impacts.standing_before,
          'standing_after', impacts.standing_after,
          'standing_delta', impacts.standing_delta,
          'merit', pg_catalog.jsonb_build_object(
            'participation', impacts.participation_merit,
            'placement', impacts.placement_merit,
            'generated', impacts.generated_merit,
            'manual', impacts.manual_merit,
            'total', impacts.total_merit
          )
        )
        order by impacts.competition_rank nulls last, impacts.participant_id
      ),
      '[]'::jsonb
    ),
    pg_catalog.jsonb_build_object(
      'winner_count', winner_counts.winner_count,
      'winner_is_tie', winner_counts.winner_count > 1,
      'participant_count', count(*)::bigint,
      'member_quota_impact_count', count(*) filter (
        where impacts.participant_kind = 'member'::public.round_participant_kind
          and impacts.quota_before is distinct from impacts.quota_after
      )::bigint,
      'standing_impact_count', count(*) filter (
        where impacts.participant_kind = 'member'::public.round_participant_kind
          and impacts.standing_before is distinct from impacts.standing_after
      )::bigint
    )
  into participant_rows, consequence_summary
  from impacts
  cross join winner_counts
  group by winner_counts.winner_count;

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
    'consequences', consequence_summary,
    'participants', participant_rows
  );
end;
$$;

comment on function public.preview_live_round_completion_server(app.entity_id, app.entity_id) is
  'Stable service-only completion preview with server-computed winner, quota, standing, participant-name, and consequence projections.';
