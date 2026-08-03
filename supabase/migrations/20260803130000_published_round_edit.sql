-- Phase 03: safe Published round-detail edits.
--
-- This boundary deliberately edits only fields already represented by the
-- rounds table.  Format, roster/guest, and scoring edits need versioned rule
-- and participant history contracts that arrive in later slices.  Published
-- rule and participant snapshots remain append-only and are never rewritten.

create function app.round_details_edit_round_json(p_round public.rounds)
returns jsonb
language sql
immutable
security invoker
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'round_id', p_round.id,
    'group_id', p_round.group_id,
    'description', p_round.description,
    'scheduled_at', p_round.scheduled_at,
    'group_time_zone', p_round.group_time_zone,
    'venue', p_round.venue,
    'round_url', p_round.round_url,
    'notes', p_round.notes,
    'notes_visible_to_players', p_round.notes_visible_to_players,
    'rsvp_deadline_at', p_round.rsvp_deadline_at,
    'format', p_round.format,
    'state', p_round.state,
    'version', p_round.version
  );
$$;

revoke all on function app.round_details_edit_round_json(public.rounds)
from public, anon, authenticated, service_role;

create function app.round_details_edit_fingerprint(
  p_round_id uuid,
  p_round_version bigint,
  p_proposed jsonb
)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select app.member_request_fingerprint(
    p_proposed,
    p_round_id::text || ':' || p_round_version::text
  );
$$;

revoke all on function app.round_details_edit_fingerprint(uuid, bigint, jsonb)
from public, anon, authenticated, service_role;

create function public.preview_published_round_edit(
  p_actor_user_id uuid,
  p_round_id uuid,
  p_description text,
  p_scheduled_local text,
  p_venue text,
  p_round_url text,
  p_notes text,
  p_notes_visible_to_players boolean,
  p_rsvp_deadline_local text,
  p_expected_round_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_group_id uuid;
  actor_role public.membership_role;
  locked_round public.rounds%rowtype;
  normalized_description text;
  normalized_venue text;
  normalized_url text;
  normalized_notes text;
  scheduled_at_value timestamptz;
  rsvp_deadline_value timestamptz;
  proposed jsonb;
  changed_fields jsonb := '[]'::jsonb;
  material_categories jsonb := '[]'::jsonb;
  affected_participants jsonb := '[]'::jsonb;
  affected_participant_count bigint := 0;
  scoring_consequences jsonb;
  impact_fingerprint text;
begin
  if p_actor_user_id is null or p_round_id is null then
    raise exception 'round_input_invalid' using errcode = '22004';
  end if;
  if p_expected_round_version is null or p_expected_round_version < 1 then
    raise exception 'round_input_invalid' using errcode = '22023';
  end if;

  normalized_description := nullif(pg_catalog.btrim(p_description), '');
  normalized_venue := nullif(pg_catalog.btrim(p_venue), '');
  normalized_url := nullif(pg_catalog.btrim(p_round_url), '');
  normalized_notes := nullif(pg_catalog.btrim(p_notes), '');
  if normalized_description is null then
    raise exception 'round_description_required' using errcode = '22023';
  end if;
  if normalized_url is not null
    and normalized_url !~ '^https://[^/?#[:space:]]+([/?#][^[:space:]]*)?$'
  then
    raise exception 'round_url_invalid' using errcode = '22023';
  end if;
  if normalized_notes is not null and pg_catalog.length(normalized_notes) > 500 then
    raise exception 'round_notes_invalid' using errcode = '22023';
  end if;

  select membership.group_id, membership.role
  into actor_group_id, actor_role
  from public.memberships as membership
  join public.user_profiles as profile on profile.user_id = membership.user_id
  join auth.users as identity on identity.id = membership.user_id
  where membership.user_id = p_actor_user_id
    and membership.status = 'active'
    and membership.role in ('coordinator', 'administrator')
    and profile.disabled_at is null
    and identity.email_confirmed_at is not null
    and identity.deleted_at is null
    and not identity.is_anonymous
    and not (coalesce(identity.raw_app_meta_data, '{}'::jsonb) ? 'greenroster_password_recovery')
    and (identity.banned_until is null or identity.banned_until <= pg_catalog.statement_timestamp())
  limit 1;
  if actor_group_id is null or actor_role is null then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  if exists (
    select 1 from auth.users as identity
    where identity.id = p_actor_user_id
      and coalesce(identity.raw_app_meta_data, '{}'::jsonb) ? 'greenroster_password_recovery'
  ) then
    raise exception 'recovery_session_forbidden' using errcode = 'P0003';
  end if;

  select round_record.*
  into locked_round
  from public.rounds as round_record
  where round_record.id = p_round_id
    and round_record.group_id = actor_group_id
  for share;
  if not found then
    raise exception 'round_not_found' using errcode = 'P0002';
  end if;
  if locked_round.state <> 'published' then
    raise exception 'round_state_locked' using errcode = 'P0001';
  end if;
  if locked_round.version <> p_expected_round_version then
    raise exception 'round_version_changed' using errcode = '40001';
  end if;

  if nullif(pg_catalog.btrim(p_scheduled_local), '') is null then
    raise exception 'round_scheduled_at_invalid' using errcode = '22023';
  end if;
  scheduled_at_value := app.round_local_to_utc(
    p_scheduled_local,
    locked_round.group_time_zone::text,
    'round_scheduled_at_invalid'
  );
  if nullif(pg_catalog.btrim(p_rsvp_deadline_local), '') is not null then
    rsvp_deadline_value := app.round_local_to_utc(
      p_rsvp_deadline_local,
      locked_round.group_time_zone::text,
      'round_rsvp_deadline_invalid'
    );
    if rsvp_deadline_value >= scheduled_at_value then
      raise exception 'round_rsvp_deadline_invalid' using errcode = '22023';
    end if;
  end if;

  proposed := pg_catalog.jsonb_build_object(
    'round_id', locked_round.id,
    'group_id', locked_round.group_id,
    'description', normalized_description,
    'scheduled_at', scheduled_at_value,
    'group_time_zone', locked_round.group_time_zone,
    'venue', normalized_venue,
    'round_url', normalized_url,
    'notes', normalized_notes,
    'notes_visible_to_players', coalesce(p_notes_visible_to_players, true),
    'rsvp_deadline_at', rsvp_deadline_value,
    'format', locked_round.format,
    'state', locked_round.state,
    'version', locked_round.version
  );

  if locked_round.description is distinct from normalized_description then
    changed_fields := changed_fields || '["description"]'::jsonb;
  end if;
  if locked_round.scheduled_at is distinct from scheduled_at_value then
    changed_fields := changed_fields || '["scheduled_at"]'::jsonb;
  end if;
  if locked_round.venue is distinct from normalized_venue then
    changed_fields := changed_fields || '["venue"]'::jsonb;
  end if;
  if locked_round.round_url is distinct from normalized_url then
    changed_fields := changed_fields || '["round_url"]'::jsonb;
  end if;
  if locked_round.notes is distinct from normalized_notes then
    changed_fields := changed_fields || '["notes"]'::jsonb;
  end if;
  if locked_round.notes_visible_to_players is distinct from coalesce(p_notes_visible_to_players, true) then
    changed_fields := changed_fields || '["notes_visible_to_players"]'::jsonb;
  end if;
  if locked_round.rsvp_deadline_at is distinct from rsvp_deadline_value then
    changed_fields := changed_fields || '["rsvp_deadline_at"]'::jsonb;
  end if;

  if locked_round.scheduled_at is distinct from scheduled_at_value
    or locked_round.rsvp_deadline_at is distinct from rsvp_deadline_value
  then
    material_categories := material_categories || '["time"]'::jsonb;
    select coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'participant_id', participant.id,
          'membership_id', participant.membership_id,
          'first_name', coalesce(golfer.first_name, profile.first_name),
          'last_name', coalesce(golfer.last_name, profile.last_name),
          'rsvp_status', participant.rsvp_status
        )
        order by pg_catalog.lower(coalesce(golfer.last_name, profile.last_name, '')),
          pg_catalog.lower(coalesce(golfer.first_name, profile.first_name, '')),
          participant.membership_id
      ),
      '[]'::jsonb
    ), count(*)
    into affected_participants, affected_participant_count
    from public.round_participants as participant
    join public.memberships as membership
      on membership.id = participant.membership_id
     and membership.group_id = participant.group_id
    left join public.membership_golfer_profiles as golfer
      on golfer.membership_id = participant.membership_id
     and golfer.group_id = participant.group_id
    left join public.user_profiles as profile
      on profile.user_id = membership.user_id
    where participant.round_id = locked_round.id
      and participant.group_id = locked_round.group_id;
  end if;

  if jsonb_array_length(changed_fields) = 0 then
    scoring_consequences := '["No published round values would change."]'::jsonb;
  elsif jsonb_array_length(material_categories) > 0 then
    scoring_consequences := '["Participant-facing timing changes are shown above; immutable rule, quota, handicap, tee, roster, and scoring snapshots remain unchanged."]'::jsonb;
  else
    scoring_consequences := '["Descriptive round details change; immutable rule, quota, handicap, tee, roster, and scoring snapshots remain unchanged."]'::jsonb;
  end if;

  impact_fingerprint := app.round_details_edit_fingerprint(
    locked_round.id,
    locked_round.version,
    proposed
  );

  return pg_catalog.jsonb_build_object(
    'current', app.round_details_edit_round_json(locked_round),
    'proposed', proposed,
    'current_version', locked_round.version,
    'changed_fields', changed_fields,
    'material_categories', material_categories,
    'affected_participants', affected_participants,
    'affected_participant_count', affected_participant_count,
    'scoring_consequences', scoring_consequences,
    'impact_fingerprint', impact_fingerprint
  );
end;
$$;

comment on function public.preview_published_round_edit(uuid, uuid, text, text, text, text, text, boolean, text, bigint) is
  'Server-authoritative preview for existing Published round-detail fields; format, roster, guest, and scoring edits are intentionally outside this contract.';

revoke all on function public.preview_published_round_edit(uuid, uuid, text, text, text, text, text, boolean, text, bigint)
from public, anon, authenticated;
grant execute on function public.preview_published_round_edit(uuid, uuid, text, text, text, text, text, boolean, text, bigint)
to service_role;

create function public.update_published_round_edit(
  p_actor_user_id uuid,
  p_round_id uuid,
  p_description text,
  p_scheduled_local text,
  p_venue text,
  p_round_url text,
  p_notes text,
  p_notes_visible_to_players boolean,
  p_rsvp_deadline_local text,
  p_expected_round_version bigint,
  p_impact_fingerprint text,
  p_announce boolean,
  p_correlation_id uuid,
  p_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_group_id uuid;
  locked_round public.rounds%rowtype;
  saved_round public.rounds%rowtype;
  prior_event public.audit_events%rowtype;
  preview_payload jsonb;
  receipt_payload jsonb;
  request_fingerprint text;
  notification_count bigint := 0;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_actor_user_id is null or p_round_id is null or p_correlation_id is null or p_operation_id is null then
    raise exception 'operation_context_required' using errcode = '22004';
  end if;
  if p_impact_fingerprint is null or p_impact_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'round_edit_fingerprint_invalid' using errcode = '22023';
  end if;
  if p_announce is null then
    raise exception 'round_edit_announce_required' using errcode = '22004';
  end if;

  select membership.group_id
  into actor_group_id
  from public.memberships as membership
  join public.user_profiles as profile on profile.user_id = membership.user_id
  join auth.users as identity on identity.id = membership.user_id
  where membership.user_id = p_actor_user_id
    and membership.status = 'active'
    and membership.role in ('coordinator', 'administrator')
    and profile.disabled_at is null
    and identity.email_confirmed_at is not null
    and identity.deleted_at is null
    and not identity.is_anonymous
    and not (coalesce(identity.raw_app_meta_data, '{}'::jsonb) ? 'greenroster_password_recovery')
    and (identity.banned_until is null or identity.banned_until <= pg_catalog.statement_timestamp())
  limit 1;
  if actor_group_id is null then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;
  if exists (
    select 1 from auth.users as identity
    where identity.id = p_actor_user_id
      and coalesce(identity.raw_app_meta_data, '{}'::jsonb) ? 'greenroster_password_recovery'
  ) then
    raise exception 'recovery_session_forbidden' using errcode = 'P0003';
  end if;

  select round_record.*
  into locked_round
  from public.rounds as round_record
  where round_record.id = p_round_id
    and round_record.group_id = actor_group_id
  for update;
  if not found then
    raise exception 'round_not_found' using errcode = 'P0002';
  end if;

  select event.*
  into prior_event
  from public.audit_events as event
  where event.group_id = locked_round.group_id
    and event.actor_user_id = p_actor_user_id
    and event.action = 'round.details_changed'
    and event.target_id = locked_round.id
    and event.operation_id = p_operation_id;
  request_fingerprint := app.member_request_fingerprint(
    pg_catalog.jsonb_build_object(
      'round_id', p_round_id,
      'impact_fingerprint', p_impact_fingerprint,
      'announce', p_announce,
      'description', nullif(pg_catalog.btrim(p_description), ''),
      'scheduled_local', pg_catalog.btrim(p_scheduled_local),
      'venue', nullif(pg_catalog.btrim(p_venue), ''),
      'round_url', nullif(pg_catalog.btrim(p_round_url), ''),
      'notes', nullif(pg_catalog.btrim(p_notes), ''),
      'notes_visible_to_players', coalesce(p_notes_visible_to_players, true),
      'rsvp_deadline_local', nullif(pg_catalog.btrim(p_rsvp_deadline_local), ''),
      'expected_round_version', p_expected_round_version
    ),
    p_actor_user_id::text || ':' || p_operation_id::text
  );
  if found then
    if prior_event.after_state ->> 'request_fingerprint' <> request_fingerprint then
      raise exception 'operation_id_reused' using errcode = '23505';
    end if;
    return prior_event.after_state - 'request_fingerprint';
  end if;

  if locked_round.state <> 'published' then
    raise exception 'round_state_locked' using errcode = 'P0001';
  end if;
  if locked_round.version <> p_expected_round_version then
    raise exception 'round_version_changed' using errcode = '40001';
  end if;

  select public.preview_published_round_edit(
    p_actor_user_id,
    p_round_id,
    p_description,
    p_scheduled_local,
    p_venue,
    p_round_url,
    p_notes,
    p_notes_visible_to_players,
    p_rsvp_deadline_local,
    p_expected_round_version
  )
  into preview_payload;
  if preview_payload ->> 'impact_fingerprint' <> p_impact_fingerprint then
    raise exception 'published_round_edit_stale' using errcode = '40001';
  end if;
  if jsonb_array_length(preview_payload -> 'changed_fields') = 0 then
    raise exception 'round_edit_no_changes' using errcode = '22023';
  end if;

  update public.rounds as round_record
  set description = nullif(pg_catalog.btrim(p_description), ''),
      scheduled_at = app.round_local_to_utc(
        p_scheduled_local,
        locked_round.group_time_zone::text,
        'round_scheduled_at_invalid'
      ),
      venue = nullif(pg_catalog.btrim(p_venue), ''),
      round_url = nullif(pg_catalog.btrim(p_round_url), ''),
      notes = nullif(pg_catalog.btrim(p_notes), ''),
      notes_visible_to_players = coalesce(p_notes_visible_to_players, true),
      rsvp_deadline_at = case
        when nullif(pg_catalog.btrim(p_rsvp_deadline_local), '') is null then null
        else app.round_local_to_utc(
          p_rsvp_deadline_local,
          locked_round.group_time_zone::text,
          'round_rsvp_deadline_invalid'
        )
      end,
      version = round_record.version + 1
  where round_record.id = locked_round.id
    and round_record.group_id = locked_round.group_id
  returning * into saved_round;

  if p_announce then
    insert into public.notification_outbox_jobs (
      group_id, event_type, aggregate_type, aggregate_id, aggregate_version, idempotency_key
    )
    select
      saved_round.group_id,
      'round.details_changed',
      'round',
      saved_round.id,
      saved_round.version,
      'round.details_changed:' || saved_round.id::text || ':' || saved_round.version::text || ':' || participant.membership_id::text
    from public.round_participants as participant
    join public.memberships as membership
      on membership.id = participant.membership_id
     and membership.group_id = participant.group_id
    join public.user_profiles as profile on profile.user_id = membership.user_id
    join auth.users as identity on identity.id = membership.user_id
    where participant.round_id = saved_round.id
      and participant.group_id = saved_round.group_id
      and membership.status = 'active'
      and profile.disabled_at is null
      and identity.email_confirmed_at is not null
      and identity.deleted_at is null
      and not identity.is_anonymous
      and (identity.banned_until is null or identity.banned_until <= v_now)
      and identity.email is not null
      and pg_catalog.length(pg_catalog.btrim(identity.email)) between 3 and 320
      and pg_catalog.btrim(identity.email) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      and not exists (
        select 1 from public.email_suppressions as suppression
        where suppression.normalized_address = pg_catalog.lower(pg_catalog.btrim(identity.email))
      );

    insert into public.notification_deliveries (
      group_id, outbox_job_id, recipient_membership_id, recipient_address,
      recipient_address_normalized, channel
    )
    select
      jobs.group_id,
      jobs.id,
      participant.membership_id,
      pg_catalog.btrim(identity.email),
      pg_catalog.lower(pg_catalog.btrim(identity.email)),
      'email'
    from public.notification_outbox_jobs as jobs
    join public.round_participants as participant
      on participant.round_id = saved_round.id
     and participant.group_id = jobs.group_id
     and jobs.idempotency_key = 'round.details_changed:' || saved_round.id::text || ':' || saved_round.version::text || ':' || participant.membership_id::text
    join public.memberships as membership
      on membership.id = participant.membership_id
     and membership.group_id = participant.group_id
    join auth.users as identity on identity.id = membership.user_id
    where jobs.group_id = saved_round.group_id
      and jobs.event_type = 'round.details_changed'
      and jobs.aggregate_type = 'round'
      and jobs.aggregate_id = saved_round.id;

    select count(*)
    into notification_count
    from public.notification_deliveries as delivery
    join public.notification_outbox_jobs as jobs
      on jobs.id = delivery.outbox_job_id and jobs.group_id = delivery.group_id
    where jobs.group_id = saved_round.group_id
      and jobs.event_type = 'round.details_changed'
      and jobs.aggregate_id = saved_round.id
      and jobs.aggregate_version = saved_round.version
      and delivery.state = 'queued';
  end if;

  receipt_payload := pg_catalog.jsonb_build_object(
    'current', preview_payload -> 'current',
    'proposed', app.round_details_edit_round_json(saved_round),
    'current_version', saved_round.version,
    'changed_fields', preview_payload -> 'changed_fields',
    'material_categories', preview_payload -> 'material_categories',
    'affected_participants', preview_payload -> 'affected_participants',
    'affected_participant_count', preview_payload -> 'affected_participant_count',
    'scoring_consequences', preview_payload -> 'scoring_consequences',
    'impact_fingerprint', preview_payload -> 'impact_fingerprint',
    'announce', p_announce,
    'notification_count', notification_count
  );

  insert into public.audit_events (
    group_id, actor_user_id, action, target_type, target_id, target_version,
    before_state, after_state, source, correlation_id, operation_id
  )
  values (
    saved_round.group_id,
    p_actor_user_id,
    'round.details_changed',
    'round',
    saved_round.id,
    saved_round.version,
    preview_payload -> 'current',
    receipt_payload || pg_catalog.jsonb_build_object('request_fingerprint', request_fingerprint),
    'portal',
    p_correlation_id,
    p_operation_id
  );

  return receipt_payload;
end;
$$;

comment on function public.update_published_round_edit(uuid, uuid, text, text, text, text, text, boolean, text, bigint, text, boolean, uuid, uuid) is
  'Applies server-authorized Published round-detail fields with optimistic concurrency, immutable snapshot preservation, optional e-mail outbox, audit, and exact operation replay.';

revoke all on function public.update_published_round_edit(uuid, uuid, text, text, text, text, text, boolean, text, bigint, text, boolean, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.update_published_round_edit(uuid, uuid, text, text, text, text, text, boolean, text, bigint, text, boolean, uuid, uuid)
to service_role;

create function public.claim_round_details_changed_email(
  p_claim_token uuid,
  p_stale_before timestamptz
)
returns table (
  delivery_id app.entity_id,
  outbox_job_id app.entity_id,
  round_id app.entity_id,
  group_id app.entity_id,
  group_name text,
  group_time_zone text,
  round_description text,
  scheduled_at app.utc_instant,
  venue text,
  rsvp_deadline_at app.utc_instant,
  recipient_address text,
  attempt_number integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  selected_delivery record;
begin
  if p_claim_token is null then
    raise exception 'delivery_claim_token_required' using errcode = '22004';
  end if;
  if p_stale_before is null or p_stale_before > v_now then
    raise exception 'delivery_stale_boundary_invalid' using errcode = '22023';
  end if;

  with stale as (
    update public.notification_deliveries as delivery
    set state = 'retryable', claim_token = null, claimed_at = null,
        next_attempt_at = v_now, failure_reason = 'claim_expired'
    from public.notification_outbox_jobs as jobs
    where jobs.id = delivery.outbox_job_id
      and jobs.group_id = delivery.group_id
      and jobs.event_type = 'round.details_changed'
      and jobs.aggregate_type = 'round'
      and delivery.channel = 'email'
      and delivery.state = 'sending'
      and delivery.claimed_at <= p_stale_before
    returning delivery.outbox_job_id, delivery.group_id
  )
  update public.notification_outbox_jobs as jobs
  set state = 'retryable', claimed_at = null, finished_at = null,
      next_attempt_at = v_now, safe_error = 'claim_expired'
  from stale
  where jobs.id = stale.outbox_job_id and jobs.group_id = stale.group_id;

  update public.notification_deliveries as delivery
  set state = 'cancelled', failure_reason = case
        when round_record.state <> 'published' then 'round_state_locked'
        else 'member_identity_unavailable'
      end,
      next_attempt_at = v_now, claim_token = null, claimed_at = null
  from public.notification_outbox_jobs as jobs
  join public.round_participants as participant
    on participant.round_id = jobs.aggregate_id and participant.group_id = jobs.group_id
  join public.memberships as membership
    on membership.id = participant.membership_id and membership.group_id = participant.group_id
  join public.rounds as round_record
    on round_record.id = jobs.aggregate_id and round_record.group_id = jobs.group_id
  left join public.user_profiles as profile on profile.user_id = membership.user_id
  left join auth.users as identity on identity.id = membership.user_id
  where jobs.id = delivery.outbox_job_id
    and jobs.group_id = delivery.group_id
    and participant.membership_id = delivery.recipient_membership_id
    and jobs.event_type = 'round.details_changed'
    and delivery.channel = 'email'
    and delivery.state in ('queued', 'retryable')
    and (
      round_record.state <> 'published'
      or
      membership.status <> 'active'
      or profile.user_id is null
      or profile.disabled_at is not null
      or identity.id is null
      or identity.email_confirmed_at is null
      or identity.deleted_at is not null
      or identity.is_anonymous
      or identity.email is null
      or pg_catalog.length(pg_catalog.btrim(identity.email)) not between 3 and 320
      or pg_catalog.btrim(identity.email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      or exists (
        select 1 from public.email_suppressions as suppression
        where suppression.normalized_address = pg_catalog.lower(pg_catalog.btrim(identity.email))
      )
    );

  update public.notification_outbox_jobs as jobs
  set state = 'cancelled', safe_error = 'member_identity_unavailable',
      finished_at = v_now, next_attempt_at = v_now
  where jobs.event_type = 'round.details_changed'
    and jobs.aggregate_type = 'round'
    and jobs.state in ('queued', 'retryable')
    and not exists (
      select 1 from public.notification_deliveries as delivery
      where delivery.outbox_job_id = jobs.id
        and delivery.group_id = jobs.group_id
        and delivery.state in ('queued', 'retryable', 'sending')
    );

  select
    delivery.id as delivery_id,
    jobs.id as outbox_job_id,
    round_record.id as round_id,
    jobs.group_id,
    group_record.name as group_name,
    round_record.group_time_zone::text as group_time_zone,
    coalesce(round_record.description, 'Round') as round_description,
    round_record.scheduled_at,
    round_record.venue,
    round_record.rsvp_deadline_at,
    pg_catalog.btrim(identity.email) as recipient_address,
    delivery.attempts + 1 as attempt_number
  into selected_delivery
  from public.notification_deliveries as delivery
  join public.notification_outbox_jobs as jobs
    on jobs.id = delivery.outbox_job_id and jobs.group_id = delivery.group_id
  join public.rounds as round_record
    on round_record.id = jobs.aggregate_id and round_record.group_id = jobs.group_id
  join public.round_participants as participant
    on participant.round_id = round_record.id
   and participant.group_id = round_record.group_id
   and participant.membership_id = delivery.recipient_membership_id
  join public.memberships as membership
    on membership.id = participant.membership_id and membership.group_id = participant.group_id
  join public.user_profiles as profile
    on profile.user_id = membership.user_id and profile.disabled_at is null
  join auth.users as identity on identity.id = membership.user_id
  join public.groups as group_record on group_record.id = jobs.group_id
  where delivery.channel = 'email'
    and delivery.state in ('queued', 'retryable')
    and delivery.next_attempt_at <= v_now
    and jobs.event_type = 'round.details_changed'
    and jobs.aggregate_type = 'round'
    and jobs.state in ('queued', 'retryable')
    and jobs.next_attempt_at <= v_now
    and round_record.state = 'published'
    and membership.status = 'active'
    and identity.email_confirmed_at is not null
    and identity.deleted_at is null
    and not identity.is_anonymous
    and (identity.banned_until is null or identity.banned_until <= v_now)
    and identity.email is not null
    and pg_catalog.length(pg_catalog.btrim(identity.email)) between 3 and 320
    and pg_catalog.btrim(identity.email) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    and not exists (
      select 1 from public.email_suppressions as suppression
      where suppression.normalized_address = pg_catalog.lower(pg_catalog.btrim(identity.email))
    )
  order by delivery.next_attempt_at, delivery.created_at, delivery.id
  for update of delivery, jobs skip locked
  limit 1;

  if not found then
    return;
  end if;

  update public.notification_deliveries as delivery
  set state = 'sending', claim_token = p_claim_token, claimed_at = v_now,
      attempts = selected_delivery.attempt_number, failure_reason = null,
      recipient_address = selected_delivery.recipient_address,
      recipient_address_normalized = pg_catalog.lower(selected_delivery.recipient_address)
  where delivery.id = selected_delivery.delivery_id
    and delivery.group_id = selected_delivery.group_id;

  update public.notification_outbox_jobs as jobs
  set state = 'processing', claimed_at = v_now, attempts = jobs.attempts + 1
  where jobs.id = selected_delivery.outbox_job_id
    and jobs.group_id = selected_delivery.group_id;

  return query
  select
    selected_delivery.delivery_id,
    selected_delivery.outbox_job_id,
    selected_delivery.round_id,
    selected_delivery.group_id,
    selected_delivery.group_name,
    selected_delivery.group_time_zone,
    selected_delivery.round_description,
    selected_delivery.scheduled_at,
    selected_delivery.venue,
    selected_delivery.rsvp_deadline_at,
    selected_delivery.recipient_address,
    selected_delivery.attempt_number;
end;
$$;

comment on function public.claim_round_details_changed_email(uuid, timestamptz) is
  'Service-only claim boundary for optional Published round-detail e-mail deliveries.';

revoke all on function public.claim_round_details_changed_email(uuid, timestamptz)
from public, anon, authenticated, service_role;
grant execute on function public.claim_round_details_changed_email(uuid, timestamptz)
to service_role;
