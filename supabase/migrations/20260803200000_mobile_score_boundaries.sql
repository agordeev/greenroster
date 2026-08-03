-- Phase 05: authenticated mobile score boundaries.
--
-- The service RPCs remain the only implementation of score authorization and
-- mutation semantics. These client-facing delegates derive the actor from the
-- authenticated session and do not accept a caller-supplied actor or source.

create function public.read_mobile_live_round_scores(
  p_round_id uuid
)
returns table (
  round_id app.entity_id,
  group_id app.entity_id,
  format public.round_format,
  scheduled_at app.utc_instant,
  group_time_zone app.iana_time_zone,
  round_version bigint,
  participant_id app.entity_id,
  participant_kind public.round_participant_kind,
  membership_id app.entity_id,
  sponsor_membership_id app.entity_id,
  first_name text,
  last_name text,
  rsvp_status public.round_rsvp_status,
  participant_version bigint,
  quota_snapshot app.quota_value,
  handicap_snapshot app.handicap_value,
  tee_snapshot text,
  enabled_final_total_fields jsonb,
  score_version bigint,
  score_revision_id app.entity_id,
  gross_score app.golf_score_value,
  net_score app.golf_score_value,
  golf_points app.golf_points_value,
  manual_merit app.manual_merit_value,
  plus_minus app.plus_minus_value,
  ranking_value app.plus_minus_value,
  score_changed_at app.utc_instant,
  can_edit boolean,
  can_author_manual_merit boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select *
  from public.read_live_round_scores((select auth.uid()), p_round_id);
$$;

comment on function public.read_mobile_live_round_scores(uuid) is
  'Authenticated actor-derived mobile live score projection. Delegates to the service-only read while never accepting a client actor id.';

revoke all on function public.read_mobile_live_round_scores(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.read_mobile_live_round_scores(uuid)
to authenticated;

create function public.set_mobile_round_participant_score(
  p_participant_id uuid,
  p_changed_fields jsonb,
  p_expected_score_version bigint,
  p_device_operation_id uuid,
  p_reason text,
  p_client_changed_at app.utc_instant,
  p_correlation_id uuid,
  p_operation_id uuid
)
returns table (
  participant_id app.entity_id,
  round_id app.entity_id,
  group_id app.entity_id,
  version bigint,
  revision_id app.entity_id,
  gross_score app.golf_score_value,
  net_score app.golf_score_value,
  golf_points app.golf_points_value,
  manual_merit app.manual_merit_value,
  plus_minus app.plus_minus_value,
  ranking_value app.plus_minus_value,
  changed_at app.utc_instant
)
language sql
security definer
set search_path = ''
as $$
  select *
  from public.set_round_participant_score(
    (select auth.uid()),
    p_participant_id,
    p_changed_fields,
    p_expected_score_version,
    p_device_operation_id,
    'mobile',
    p_reason,
    p_client_changed_at,
    p_correlation_id,
    p_operation_id
  );
$$;

comment on function public.set_mobile_round_participant_score(
  uuid, jsonb, bigint, uuid, text, app.utc_instant, uuid, uuid
) is
  'Authenticated actor-derived mobile score revision. Source is always mobile and all authorization, stale-version, idempotency, audit, and projection logic remains in the service-only RPC.';

revoke all on function public.set_mobile_round_participant_score(
  uuid, jsonb, bigint, uuid, text, app.utc_instant, uuid, uuid
)
from public, anon, authenticated, service_role;
grant execute on function public.set_mobile_round_participant_score(
  uuid, jsonb, bigint, uuid, text, app.utc_instant, uuid, uuid
)
to authenticated;
