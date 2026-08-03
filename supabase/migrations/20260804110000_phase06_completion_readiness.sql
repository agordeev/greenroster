-- Phase 06: server-authoritative completion readiness.
--
-- This boundary only reports checks the server can prove from persisted state.
-- Native mobile pending operations are deliberately not inferred here; the
-- completion workflow remains blocked until a server-visible sync marker or an
-- approved completion-time handshake exists.

create function app.valid_snapshot_adjustment_bands(p_bands jsonb)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  item jsonb;
  position integer := 0;
  lower_bound numeric;
  upper_bound numeric;
  adjustment numeric;
  lower_inclusive boolean;
  upper_inclusive boolean;
  prior_upper_bound numeric;
  prior_upper_inclusive boolean;
begin
  if p_bands is null or pg_catalog.jsonb_typeof(p_bands) <> 'array' then
    return false;
  end if;

  for item in
    select value
    from pg_catalog.jsonb_array_elements(p_bands) as element(value)
  loop
    position := position + 1;
    if pg_catalog.jsonb_typeof(item) <> 'object'
      or not (item ?& array[
        'lower_bound', 'lower_inclusive', 'upper_bound', 'upper_inclusive', 'adjustment'
      ])
    then
      return false;
    end if;

    begin
      lower_bound := (item ->> 'lower_bound')::numeric;
      lower_inclusive := (item ->> 'lower_inclusive')::boolean;
      upper_bound := (item ->> 'upper_bound')::numeric;
      upper_inclusive := (item ->> 'upper_inclusive')::boolean;
      adjustment := (item ->> 'adjustment')::numeric;
    exception when others then
      return false;
    end;

    if lower_bound is null
      or upper_bound is null
      or adjustment is null
      or lower_inclusive is null
      or upper_inclusive is null
      or lower_bound = 'NaN'::numeric
      or upper_bound = 'NaN'::numeric
      or adjustment = 'NaN'::numeric
      or lower_bound <> pg_catalog.round(lower_bound, 2)
      or upper_bound <> pg_catalog.round(upper_bound, 2)
      or adjustment <> pg_catalog.round(adjustment, 2)
      or lower_bound not between -100 and 100
      or upper_bound not between -100 and 100
      or adjustment not between -20 and 20
      or lower_bound > upper_bound
      or (lower_bound = upper_bound and not (lower_inclusive and upper_inclusive))
    then
      return false;
    end if;

    if position = 1 then
      if lower_bound <> -100 or not lower_inclusive then
        return false;
      end if;
    elsif lower_bound <> prior_upper_bound
      or lower_inclusive = prior_upper_inclusive
    then
      return false;
    end if;

    prior_upper_bound := upper_bound;
    prior_upper_inclusive := upper_inclusive;
  end loop;

  return position > 0
    and prior_upper_bound = 100
    and prior_upper_inclusive;
end;
$$;

comment on function app.valid_snapshot_adjustment_bands(jsonb) is
  'Validates a snapshotted Method C quota partition without trusting client-owned JSON.';

revoke all on function app.valid_snapshot_adjustment_bands(jsonb)
from public, anon, authenticated, service_role;

create function app.round_completion_readiness(
  p_round_id app.entity_id,
  p_group_id app.entity_id
)
returns table (
  round_id app.entity_id,
  group_id app.entity_id,
  readiness_status text,
  blocker_code text,
  warning_code text,
  participant_id app.entity_id,
  participant_kind public.round_participant_kind,
  details jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_round public.rounds%rowtype;
  snapshot_record public.round_rule_snapshots%rowtype;
  participant_record public.round_participants%rowtype;
  projection_record public.participant_score_projections%rowtype;
  revision_record public.score_revisions%rowtype;
  projection_exists boolean;
  revision_exists boolean;
  blocker_count integer := 0;
  expected_plus_minus app.plus_minus_value;
  expected_ranking_value app.plus_minus_value;
  band_item jsonb;
  band_match_count integer;
  band_adjustment numeric;
  band_lower numeric;
  band_upper numeric;
  band_lower_inclusive boolean;
  band_upper_inclusive boolean;
  next_quota numeric;
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

  if target_round.state <> 'live'::public.round_state then
    return query select
      p_round_id,
      p_group_id,
      'blocked'::text,
      'round_state_invalid'::text,
      null::text,
      null::app.entity_id,
      null::public.round_participant_kind,
      pg_catalog.jsonb_build_object('state', target_round.state);
    blocker_count := blocker_count + 1;
  end if;

  select snapshot.*
  into snapshot_record
  from public.round_rule_snapshots as snapshot
  where snapshot.round_id = p_round_id
    and snapshot.group_id = p_group_id;
  if not found then
    return query select
      p_round_id,
      p_group_id,
      'blocked'::text,
      'rule_snapshot_missing'::text,
      null::text,
      null::app.entity_id,
      null::public.round_participant_kind,
      '{}'::jsonb;
    return;
  end if;

  if target_round.format is null
    or snapshot_record.format is distinct from target_round.format
  then
    return query select
      p_round_id,
      p_group_id,
      'blocked'::text,
      'rule_snapshot_mismatch'::text,
      null::text,
      null::app.entity_id,
      null::public.round_participant_kind,
      pg_catalog.jsonb_build_object(
        'round_format', target_round.format,
        'snapshot_format', snapshot_record.format
      );
    blocker_count := blocker_count + 1;
  end if;

  if not app.valid_enabled_score_fields(snapshot_record.enabled_final_total_fields)
    or (
      snapshot_record.format = 'individual_gross'::public.round_format
      and coalesce((snapshot_record.enabled_final_total_fields ->> 'net_score')::boolean, false)
    )
  then
    return query select
      p_round_id,
      p_group_id,
      'blocked'::text,
      'rule_snapshot_invalid'::text,
      null::text,
      null::app.entity_id,
      null::public.round_participant_kind,
      pg_catalog.jsonb_build_object(
        'enabled_final_total_fields', snapshot_record.enabled_final_total_fields
      );
    blocker_count := blocker_count + 1;
  end if;

  if snapshot_record.settings_version = 0 then
    if snapshot_record.format = 'individual_net'::public.round_format
      or snapshot_record.quota_method is not null
      or snapshot_record.moving_average_history_length is not null
      or snapshot_record.quota_precision is not null
      or snapshot_record.quota_rounding_rule is not null
      or snapshot_record.adjustment_bands <> '[]'::jsonb
    then
      return query select
        p_round_id,
        p_group_id,
        'blocked'::text,
        'rule_configuration_invalid'::text,
        null::text,
        null::app.entity_id,
        null::public.round_participant_kind,
        pg_catalog.jsonb_build_object('settings_version', snapshot_record.settings_version);
      blocker_count := blocker_count + 1;
    end if;
  elsif snapshot_record.quota_method is null
    or snapshot_record.quota_precision is null
    or snapshot_record.quota_precision not between 0 and 2
    or snapshot_record.quota_rounding_rule is null
    or (
      snapshot_record.quota_method = 'moving_average'::public.quota_method
      and snapshot_record.moving_average_history_length not between 4 and 20
    )
    or (
      snapshot_record.quota_method <> 'moving_average'::public.quota_method
      and snapshot_record.moving_average_history_length is not null
    )
    or (
      snapshot_record.quota_method = 'previous_plus_minus'::public.quota_method
      and not app.valid_snapshot_adjustment_bands(snapshot_record.adjustment_bands)
    )
    or (
      snapshot_record.quota_method <> 'previous_plus_minus'::public.quota_method
      and snapshot_record.adjustment_bands <> '[]'::jsonb
    )
  then
    return query select
      p_round_id,
      p_group_id,
      'blocked'::text,
      'rule_configuration_invalid'::text,
      null::text,
      null::app.entity_id,
      null::public.round_participant_kind,
      pg_catalog.jsonb_build_object(
        'settings_version', snapshot_record.settings_version,
        'quota_method', snapshot_record.quota_method,
        'adjustment_bands', snapshot_record.adjustment_bands
      );
    blocker_count := blocker_count + 1;
  end if;

  for participant_record in
    select participant.*
    from public.round_participants as participant
    where participant.round_id = p_round_id
      and participant.group_id = p_group_id
      and participant.rsvp_status = 'playing'::public.round_rsvp_status
    order by participant.id
  loop
    select projection.*
    into projection_record
    from public.participant_score_projections as projection
    where projection.participant_id = participant_record.id
      and projection.round_id = p_round_id
      and projection.group_id = p_group_id;
    projection_exists := found;

    if not projection_exists or projection_record.golf_points is null then
      return query select
        p_round_id,
        p_group_id,
        'blocked'::text,
        'golf_points_missing'::text,
        null::text,
        participant_record.id,
        participant_record.participant_kind,
        pg_catalog.jsonb_build_object('required', true);
      blocker_count := blocker_count + 1;
    end if;

    if projection_exists then
      if projection_record.last_revision_id is null then
        return query select
          p_round_id,
          p_group_id,
          'blocked'::text,
          'score_revision_missing'::text,
          null::text,
          participant_record.id,
          participant_record.participant_kind,
          pg_catalog.jsonb_build_object('projection_version', projection_record.version);
        blocker_count := blocker_count + 1;
      else
        select revision.*
        into revision_record
        from public.score_revisions as revision
        where revision.id = projection_record.last_revision_id
          and revision.group_id = p_group_id
          and revision.round_id = p_round_id
          and revision.participant_id = participant_record.id;
        revision_exists := found;
        if not revision_exists then
          return query select
            p_round_id,
            p_group_id,
            'blocked'::text,
            'score_revision_missing'::text,
            null::text,
            participant_record.id,
            participant_record.participant_kind,
            pg_catalog.jsonb_build_object(
              'revision_id', projection_record.last_revision_id,
              'projection_version', projection_record.version
            );
          blocker_count := blocker_count + 1;
        elsif revision_record.revision_number <> projection_record.version
          or revision_record.gross_score is distinct from projection_record.gross_score
          or revision_record.net_score is distinct from projection_record.net_score
          or revision_record.golf_points is distinct from projection_record.golf_points
          or revision_record.manual_merit is distinct from projection_record.manual_merit
          or revision_record.plus_minus is distinct from projection_record.plus_minus
          or revision_record.ranking_value is distinct from projection_record.ranking_value
        then
          return query select
            p_round_id,
            p_group_id,
            'blocked'::text,
            'score_revision_mismatch'::text,
            null::text,
            participant_record.id,
            participant_record.participant_kind,
            pg_catalog.jsonb_build_object(
              'revision_id', revision_record.id,
              'revision_number', revision_record.revision_number,
              'projection_version', projection_record.version
            );
          blocker_count := blocker_count + 1;
        end if;
      end if;
    end if;

    if snapshot_record.format = 'individual_net'::public.round_format then
      if participant_record.quota_snapshot is null then
        return query select
          p_round_id,
          p_group_id,
          'blocked'::text,
          'net_quota_missing'::text,
          null::text,
          participant_record.id,
          participant_record.participant_kind,
          pg_catalog.jsonb_build_object('required', true);
        blocker_count := blocker_count + 1;
      elsif projection_exists and projection_record.golf_points is not null then
        expected_plus_minus := (
          projection_record.golf_points - participant_record.quota_snapshot
        )::app.plus_minus_value;
        expected_ranking_value := expected_plus_minus;
        if projection_record.plus_minus is distinct from expected_plus_minus then
          return query select
            p_round_id,
            p_group_id,
            'blocked'::text,
            'plus_minus_invalid'::text,
            null::text,
            participant_record.id,
            participant_record.participant_kind,
            pg_catalog.jsonb_build_object('expected', expected_plus_minus);
          blocker_count := blocker_count + 1;
        end if;
        if projection_record.ranking_value is distinct from expected_ranking_value then
          return query select
            p_round_id,
            p_group_id,
            'blocked'::text,
            'ranking_value_invalid'::text,
            null::text,
            participant_record.id,
            participant_record.participant_kind,
            pg_catalog.jsonb_build_object('expected', expected_ranking_value);
          blocker_count := blocker_count + 1;
        end if;
      end if;
    elsif projection_exists and projection_record.golf_points is not null then
      expected_ranking_value := projection_record.golf_points::numeric::app.plus_minus_value;
      if projection_record.ranking_value is distinct from expected_ranking_value then
        return query select
          p_round_id,
          p_group_id,
          'blocked'::text,
          'ranking_value_invalid'::text,
          null::text,
          participant_record.id,
          participant_record.participant_kind,
          pg_catalog.jsonb_build_object('expected', expected_ranking_value);
        blocker_count := blocker_count + 1;
      end if;
      if participant_record.quota_snapshot is null then
        if projection_record.plus_minus is not null then
          return query select
            p_round_id,
            p_group_id,
            'blocked'::text,
            'plus_minus_invalid'::text,
            null::text,
            participant_record.id,
            participant_record.participant_kind,
            pg_catalog.jsonb_build_object('expected', null);
          blocker_count := blocker_count + 1;
        end if;
      else
        expected_plus_minus := (
          projection_record.golf_points - participant_record.quota_snapshot
        )::app.plus_minus_value;
        if projection_record.plus_minus is distinct from expected_plus_minus then
          return query select
            p_round_id,
            p_group_id,
            'blocked'::text,
            'plus_minus_invalid'::text,
            null::text,
            participant_record.id,
            participant_record.participant_kind,
            pg_catalog.jsonb_build_object('expected', expected_plus_minus);
          blocker_count := blocker_count + 1;
        end if;
      end if;
    end if;

    if snapshot_record.quota_method = 'previous_plus_minus'::public.quota_method
      and participant_record.participant_kind = 'member'::public.round_participant_kind
      and snapshot_record.quota_precision between 0 and 2
      and app.valid_snapshot_adjustment_bands(snapshot_record.adjustment_bands)
    then
      if participant_record.quota_snapshot is null
        or not projection_exists
        or projection_record.golf_points is null
        or projection_record.plus_minus is null
      then
        return query select
          p_round_id,
          p_group_id,
          'blocked'::text,
          'quota_calculation_input_missing'::text,
          null::text,
          participant_record.id,
          participant_record.participant_kind,
          pg_catalog.jsonb_build_object('method', 'previous_plus_minus');
        blocker_count := blocker_count + 1;
      else
        band_match_count := 0;
        band_adjustment := null;
        for band_item in
          select value
          from pg_catalog.jsonb_array_elements(snapshot_record.adjustment_bands) as element(value)
        loop
          band_lower := (band_item ->> 'lower_bound')::numeric;
          band_upper := (band_item ->> 'upper_bound')::numeric;
          band_lower_inclusive := (band_item ->> 'lower_inclusive')::boolean;
          band_upper_inclusive := (band_item ->> 'upper_inclusive')::boolean;
          if (
            projection_record.plus_minus > band_lower
            or (projection_record.plus_minus = band_lower and band_lower_inclusive)
          ) and (
            projection_record.plus_minus < band_upper
            or (projection_record.plus_minus = band_upper and band_upper_inclusive)
          ) then
            band_match_count := band_match_count + 1;
            band_adjustment := (band_item ->> 'adjustment')::numeric;
          end if;
        end loop;

        if band_match_count <> 1 then
          return query select
            p_round_id,
            p_group_id,
            'blocked'::text,
            'quota_band_unresolved'::text,
            null::text,
            participant_record.id,
            participant_record.participant_kind,
            pg_catalog.jsonb_build_object(
              'method', 'previous_plus_minus',
              'match_count', band_match_count
            );
          blocker_count := blocker_count + 1;
        else
          next_quota := pg_catalog.round(
            participant_record.quota_snapshot + band_adjustment,
            snapshot_record.quota_precision
          );
          if next_quota < 0 or next_quota > 100 then
            return query select
              p_round_id,
              p_group_id,
              'blocked'::text,
              'quota_result_invalid'::text,
              null::text,
              participant_record.id,
              participant_record.participant_kind,
              pg_catalog.jsonb_build_object(
                'next_quota', next_quota,
                'method', 'previous_plus_minus'
              );
            blocker_count := blocker_count + 1;
          end if;
        end if;
      end if;
    end if;

    if (snapshot_record.enabled_final_total_fields ->> 'gross_score') = 'true'
      and (not projection_exists or projection_record.gross_score is null)
    then
      return query select
        p_round_id,
        p_group_id,
        'warning'::text,
        null::text,
        'optional_score_field_blank'::text,
        participant_record.id,
        participant_record.participant_kind,
        pg_catalog.jsonb_build_object('field', 'gross_score');
    end if;
    if (snapshot_record.enabled_final_total_fields ->> 'net_score') = 'true'
      and (not projection_exists or projection_record.net_score is null)
    then
      return query select
        p_round_id,
        p_group_id,
        'warning'::text,
        null::text,
        'optional_score_field_blank'::text,
        participant_record.id,
        participant_record.participant_kind,
        pg_catalog.jsonb_build_object('field', 'net_score');
    end if;
  end loop;

  if blocker_count = 0 then
    return query select
      p_round_id,
      p_group_id,
      'server_ready'::text,
      null::text,
      null::text,
      null::app.entity_id,
      null::public.round_participant_kind,
      pg_catalog.jsonb_build_object(
        'server_checks', 'complete',
        'mobile_sync_check', 'unavailable',
        'completion_handshake_required', true
      );
  end if;
end;
$$;

comment on function app.round_completion_readiness(app.entity_id, app.entity_id) is
  'Returns server-proven completion blockers for one explicitly keyed Live round; native mobile queue synchronization remains an external blocked contract.';

revoke all on function app.round_completion_readiness(app.entity_id, app.entity_id)
from public, anon, authenticated, service_role;
grant usage on schema app to service_role;
grant execute on function app.round_completion_readiness(app.entity_id, app.entity_id)
to service_role;
