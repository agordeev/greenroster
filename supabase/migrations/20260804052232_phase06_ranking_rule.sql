-- Phase 06: server-authoritative competition ranking projection.
--
-- Ranking is intentionally a read-time, stable helper in the private app
-- schema.  It accepts both round and group keys so callers cannot accidentally
-- resolve a similarly named round from another tenant.  The trusted server is
-- the only role granted execution; clients never receive a direct ranking
-- mutation or table grant.

create function app.round_competition_ranking(
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
  rsvp_status public.round_rsvp_status,
  golf_points app.golf_points_value,
  plus_minus app.plus_minus_value,
  ranking_value app.plus_minus_value,
  competition_rank bigint
)
language sql
stable
security definer
set search_path = ''
as $$
with ranking_inputs as (
  select
    round_record.id as round_id,
    round_record.group_id,
    participant.id as participant_id,
    participant.participant_kind,
    participant.membership_id,
    participant.sponsor_membership_id,
    participant.rsvp_status,
    projection.golf_points,
    projection.plus_minus,
    case
      when snapshot.format = 'individual_net'::public.round_format
        then projection.plus_minus
      when snapshot.format = 'individual_gross'::public.round_format
        then projection.golf_points::numeric::app.plus_minus_value
      else null::app.plus_minus_value
    end as ranking_value
  from public.rounds as round_record
  join public.round_rule_snapshots as snapshot
    on snapshot.round_id = round_record.id
   and snapshot.group_id = round_record.group_id
  join public.round_participants as participant
    on participant.round_id = round_record.id
   and participant.group_id = round_record.group_id
  left join public.participant_score_projections as projection
    on projection.participant_id = participant.id
   and projection.round_id = participant.round_id
   and projection.group_id = participant.group_id
  where round_record.id = p_round_id
    and round_record.group_id = p_group_id
    and participant.rsvp_status = 'playing'::public.round_rsvp_status
), ranked as (
  select
    ranking_inputs.*,
    pg_catalog.rank() over (
      order by ranking_inputs.ranking_value desc nulls last
    ) as calculated_rank
  from ranking_inputs
)
select
  ranked.round_id,
  ranked.group_id,
  ranked.participant_id,
  ranked.participant_kind,
  ranked.membership_id,
  ranked.sponsor_membership_id,
  ranked.rsvp_status,
  ranked.golf_points,
  ranked.plus_minus,
  ranked.ranking_value,
  case
    when ranked.ranking_value is null then null::bigint
    else ranked.calculated_rank
  end as competition_rank
from ranked
order by ranked.calculated_rank nulls last, ranked.participant_id;
$$;

comment on function app.round_competition_ranking(app.entity_id, app.entity_id) is
  'Returns Playing members and guests ranked by the published round format. Equal non-null values share competition ranks (1, 1, 3); missing ranking input remains unranked.';

revoke all on function app.round_competition_ranking(app.entity_id, app.entity_id)
from public, anon, authenticated, service_role;
grant usage on schema app to service_role;
grant execute on function app.round_competition_ranking(app.entity_id, app.entity_id)
to service_role;
