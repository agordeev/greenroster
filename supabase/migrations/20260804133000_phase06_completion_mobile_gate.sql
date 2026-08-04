-- Phase 06: make completion readiness and preview consume the mobile handshake.
--
-- The first readiness/preview migrations intentionally stopped short of this
-- boundary because the receipt helper did not exist yet. Rename those stable
-- server-only implementations and wrap them after the receipt migration so a
-- clean migration replay never depends on a future function.

alter function app.round_completion_readiness(app.entity_id, app.entity_id)
rename to round_completion_readiness_server;

revoke all on function app.round_completion_readiness_server(app.entity_id, app.entity_id)
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
  readiness_record record;
  sync_record record;
  server_blocker_count integer := 0;
  mobile_blocker_count integer := 0;
  server_ready_details jsonb;
begin
  for readiness_record in
    select *
    from app.round_completion_readiness_server(p_round_id, p_group_id)
  loop
    if readiness_record.readiness_status = 'blocked' then
      server_blocker_count := server_blocker_count + 1;
      return query select
        readiness_record.round_id,
        readiness_record.group_id,
        readiness_record.readiness_status,
        readiness_record.blocker_code,
        readiness_record.warning_code,
        readiness_record.participant_id,
        readiness_record.participant_kind,
        readiness_record.details;
    elsif readiness_record.readiness_status = 'server_ready' then
      server_ready_details := readiness_record.details;
    else
      return query select
        readiness_record.round_id,
        readiness_record.group_id,
        readiness_record.readiness_status,
        readiness_record.blocker_code,
        readiness_record.warning_code,
        readiness_record.participant_id,
        readiness_record.participant_kind,
        readiness_record.details;
    end if;
  end loop;

  for sync_record in
    select *
    from app.round_mobile_sync_readiness(p_round_id, p_group_id)
  loop
    if sync_record.sync_status = 'mobile_receipt_missing' then
      mobile_blocker_count := mobile_blocker_count + 1;
      return query select
        p_round_id,
        p_group_id,
        'blocked'::text,
        'mobile_sync_receipt_missing'::text,
        null::text,
        sync_record.participant_id,
        sync_record.participant_kind,
        pg_catalog.jsonb_build_object(
          'sync_status', sync_record.sync_status,
          'score_source', sync_record.score_source,
          'score_revision_id', sync_record.score_revision_id,
          'receipt_revision_id', sync_record.receipt_revision_id,
          'receipt_version', sync_record.receipt_version
        );
    end if;
  end loop;

  if server_blocker_count = 0 and mobile_blocker_count = 0 then
    return query select
      p_round_id,
      p_group_id,
      'server_ready'::text,
      null::text,
      null::text,
      null::app.entity_id,
      null::public.round_participant_kind,
      coalesce(server_ready_details, '{}'::jsonb)
        || pg_catalog.jsonb_build_object(
          'server_checks', 'complete',
          'mobile_sync_check', 'complete',
          'completion_handshake_required', true
        );
  end if;
end;
$$;

comment on function app.round_completion_readiness(app.entity_id, app.entity_id) is
  'Returns server-proven completion blockers, including an explicit missing receipt for every current mobile score in one tenant-keyed Live round.';

revoke all on function app.round_completion_readiness(app.entity_id, app.entity_id)
from public, anon, authenticated, service_role;
grant usage on schema app to service_role;
grant execute on function app.round_completion_readiness(app.entity_id, app.entity_id)
to service_role;

alter function public.preview_live_round_completion(app.entity_id, app.entity_id)
rename to preview_live_round_completion_server;

revoke all on function public.preview_live_round_completion_server(app.entity_id, app.entity_id)
from public, anon, authenticated, service_role;

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
  payload jsonb;
  mobile_blocker_count bigint;
begin
  payload := public.preview_live_round_completion_server(p_round_id, p_group_id);

  select count(*)
  into mobile_blocker_count
  from app.round_mobile_sync_readiness(p_round_id, p_group_id) as sync
  where sync.sync_status = 'mobile_receipt_missing';

  return payload || pg_catalog.jsonb_build_object(
    'mobile_sync_check', case
      when mobile_blocker_count = 0 then 'complete'
      else 'blocked'
    end,
    'completion_handshake_required', true,
    'completion_allowed', false
  );
end;
$$;

comment on function public.preview_live_round_completion(app.entity_id, app.entity_id) is
  'Returns a deterministic read-only completion preview whose server checks include current mobile synchronization receipts; official completion remains a separate transaction.';

revoke all on function public.preview_live_round_completion(app.entity_id, app.entity_id)
from public, anon, authenticated, service_role;
grant execute on function public.preview_live_round_completion(app.entity_id, app.entity_id)
to service_role;
