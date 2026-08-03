-- Phase 03: the server-authoritative Draft-round contract.
--
-- A draft is tenant-owned configuration.  Application roles have no direct
-- table access; the trusted server calls the RPCs below with the verified
-- actor identity.  Publication, participants, snapshots, and notifications
-- are deliberately added in later migrations so this slice cannot expose an
-- incomplete round to members.

create type public.round_state as enum (
  'draft',
  'published',
  'live',
  'completed',
  'cancelled'
);

create type public.round_format as enum (
  'individual_net',
  'individual_gross'
);

create table public.rounds (
  id app.entity_id primary key default extensions.gen_random_uuid(),
  group_id app.entity_id not null references public.groups (id) on delete restrict,
  description text,
  scheduled_at app.utc_instant,
  group_time_zone app.iana_time_zone not null,
  venue text,
  round_url text,
  notes text,
  notes_visible_to_players boolean not null default true,
  rsvp_deadline_at app.utc_instant,
  format public.round_format,
  state public.round_state not null default 'draft',
  version bigint not null default 1,
  published_at app.utc_instant,
  cancelled_at app.utc_instant,
  created_by app.entity_id not null references auth.users (id) on delete restrict,
  created_at app.utc_instant not null default pg_catalog.now(),
  updated_at app.utc_instant not null default pg_catalog.now(),
  constraint rounds_id_group_unique unique (id, group_id),
  constraint rounds_description_not_blank check (
    description is null or pg_catalog.btrim(description) <> ''
  ),
  constraint rounds_notes_length check (notes is null or pg_catalog.length(notes) <= 500),
  constraint rounds_url_https check (
    round_url is null or round_url ~ '^https://[^/?#[:space:]]+([/?#][^[:space:]]*)?$'
  ),
  constraint rounds_rsvp_deadline_before_start check (
    rsvp_deadline_at is null
    or (scheduled_at is not null and rsvp_deadline_at < scheduled_at)
  ),
  constraint rounds_version_positive check (version > 0),
  constraint rounds_draft_has_no_publication check (
    state <> 'draft' or published_at is null
  ),
  constraint rounds_cancelled_has_timestamp check (
    (state = 'cancelled') = (cancelled_at is not null)
  )
);

comment on table public.rounds is
  'Tenant-owned round configuration. Drafts remain private until a later atomic publication transaction creates snapshots.';
comment on column public.rounds.group_time_zone is
  'The IANA group zone used to interpret local draft input and later display the round; clients cannot override it.';
comment on column public.rounds.scheduled_at is
  'The absolute UTC start instant derived on the server from the group zone.';

create index rounds_group_state_schedule_idx
  on public.rounds (group_id, state, scheduled_at desc);
create index rounds_group_updated_at_idx
  on public.rounds (group_id, updated_at desc);

create trigger rounds_immutable_id
before update of id on public.rounds
for each row execute function app.reject_id_change('id');

create trigger rounds_immutable_group
before update of group_id on public.rounds
for each row execute function app.reject_id_change('group_id');

create trigger rounds_set_updated_at
before update on public.rounds
for each row execute function app.set_updated_at();

alter table public.rounds enable row level security;
alter table public.rounds force row level security;

revoke all on table public.rounds from public, anon, authenticated, service_role;

-- Convert the browser's local datetime-local value using the authoritative
-- group zone.  A strict minute-resolution input keeps the boundary explicit;
-- PostgreSQL remains responsible for calendar and DST parsing.
create function app.round_local_to_utc(
  p_local text,
  p_time_zone text,
  p_error_code text
)
returns app.utc_instant
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  normalized_local text;
  local_timestamp timestamp without time zone;
begin
  normalized_local := pg_catalog.btrim(p_local);
  if normalized_local is null
    or normalized_local = ''
    or normalized_local !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$'
  then
    raise exception '%', coalesce(p_error_code, 'round_local_time_invalid')
      using errcode = '22023';
  end if;

  begin
    local_timestamp := pg_catalog.replace(normalized_local, 'T', ' ')::timestamp without time zone;
  exception when others then
    raise exception '%', coalesce(p_error_code, 'round_local_time_invalid')
      using errcode = '22023';
  end;

  return local_timestamp at time zone p_time_zone;
end;
$$;

revoke all on function app.round_local_to_utc(text, text, text)
from public, anon, authenticated, service_role;

create function public.create_round_draft(
  p_actor_user_id uuid,
  p_description text,
  p_scheduled_local text,
  p_venue text,
  p_round_url text,
  p_notes text,
  p_notes_visible_to_players boolean,
  p_rsvp_deadline_local text,
  p_format public.round_format,
  p_correlation_id uuid,
  p_operation_id uuid
)
returns table (
  round_id app.entity_id,
  group_id app.entity_id,
  description text,
  scheduled_at app.utc_instant,
  group_time_zone app.iana_time_zone,
  venue text,
  round_url text,
  notes text,
  notes_visible_to_players boolean,
  rsvp_deadline_at app.utc_instant,
  format public.round_format,
  state public.round_state,
  version bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_group_id uuid;
  actor_membership public.memberships%rowtype;
  locked_group public.groups%rowtype;
  saved_round public.rounds%rowtype;
  prior_event public.audit_events%rowtype;
  normalized_description text;
  normalized_venue text;
  normalized_url text;
  normalized_notes text;
  scheduled_at_value timestamptz;
  rsvp_deadline_value timestamptz;
  request_payload jsonb;
  request_fingerprint text;
begin
  if p_actor_user_id is null then
    raise exception 'actor_identity_required' using errcode = '22004';
  end if;
  if p_correlation_id is null or p_operation_id is null then
    raise exception 'operation_context_required' using errcode = '22004';
  end if;

  normalized_description := nullif(pg_catalog.btrim(p_description), '');

  normalized_venue := nullif(pg_catalog.btrim(p_venue), '');
  normalized_url := nullif(pg_catalog.btrim(p_round_url), '');
  if normalized_url is not null
    and normalized_url !~ '^https://[^/?#[:space:]]+([/?#][^[:space:]]*)?$'
  then
    raise exception 'round_url_invalid' using errcode = '22023';
  end if;

  normalized_notes := nullif(pg_catalog.btrim(p_notes), '');
  if normalized_notes is not null and pg_catalog.length(normalized_notes) > 500 then
    raise exception 'round_notes_invalid' using errcode = '22023';
  end if;

  -- The tenant is always resolved from the actor.  No group id is accepted
  -- from the browser.
  select actor.group_id
  into actor_group_id
  from app.resolve_member_management_actor(p_actor_user_id) as actor
  limit 1;
  if actor_group_id is null then
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

  select membership.*
  into actor_membership
  from public.memberships as membership
  join public.user_profiles as profile on profile.user_id = membership.user_id
  join auth.users as identity on identity.id = membership.user_id
  where membership.user_id = p_actor_user_id
    and membership.group_id = locked_group.id
    and membership.status = 'active'
    and profile.disabled_at is null
    and identity.email_confirmed_at is not null
    and identity.deleted_at is null
    and not identity.is_anonymous
    and not (coalesce(identity.raw_app_meta_data, '{}'::jsonb) ? 'greenroster_password_recovery')
    and (identity.banned_until is null or identity.banned_until <= pg_catalog.statement_timestamp())
  for update of membership;
  if not found then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  request_payload := pg_catalog.jsonb_build_object(
    'description', normalized_description,
    'scheduled_local', pg_catalog.btrim(p_scheduled_local),
    'venue', normalized_venue,
    'round_url', normalized_url,
    'notes', normalized_notes,
    'notes_visible_to_players', coalesce(p_notes_visible_to_players, true),
    'rsvp_deadline_local', nullif(pg_catalog.btrim(p_rsvp_deadline_local), ''),
    'format', p_format::text
  );
  request_fingerprint := app.member_request_fingerprint(
    request_payload,
    p_actor_user_id::text || ':' || p_operation_id::text
  );

  select event.*
  into prior_event
  from public.audit_events as event
  where event.group_id = locked_group.id
    and event.actor_user_id = p_actor_user_id
    and event.action = 'round.draft_created'
    and event.operation_id = p_operation_id;
  if found then
    if prior_event.after_state ->> 'request_fingerprint' <> request_fingerprint then
      raise exception 'operation_id_reused' using errcode = '23505';
    end if;
    return query
    select
      (prior_event.after_state ->> 'round_id')::app.entity_id,
      (prior_event.after_state ->> 'group_id')::app.entity_id,
      prior_event.after_state ->> 'description',
      (prior_event.after_state ->> 'scheduled_at')::app.utc_instant,
      (prior_event.after_state ->> 'group_time_zone')::app.iana_time_zone,
      prior_event.after_state ->> 'venue',
      prior_event.after_state ->> 'round_url',
      prior_event.after_state ->> 'notes',
      (prior_event.after_state ->> 'notes_visible_to_players')::boolean,
      (prior_event.after_state ->> 'rsvp_deadline_at')::app.utc_instant,
      (prior_event.after_state ->> 'format')::public.round_format,
      (prior_event.after_state ->> 'state')::public.round_state,
      prior_event.target_version;
    return;
  end if;

  if actor_membership.role not in ('coordinator', 'administrator') then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  if nullif(pg_catalog.btrim(p_scheduled_local), '') is not null then
    scheduled_at_value := app.round_local_to_utc(
      p_scheduled_local,
      locked_group.time_zone::text,
      'round_scheduled_at_invalid'
    );
  end if;
  if nullif(pg_catalog.btrim(p_rsvp_deadline_local), '') is not null then
    if scheduled_at_value is null then
      raise exception 'round_rsvp_deadline_invalid' using errcode = '22023';
    end if;
    rsvp_deadline_value := app.round_local_to_utc(
      p_rsvp_deadline_local,
      locked_group.time_zone::text,
      'round_rsvp_deadline_invalid'
    );
    if rsvp_deadline_value >= scheduled_at_value then
      raise exception 'round_rsvp_deadline_invalid' using errcode = '22023';
    end if;
  end if;

  insert into public.rounds (
    group_id,
    description,
    scheduled_at,
    group_time_zone,
    venue,
    round_url,
    notes,
    notes_visible_to_players,
    rsvp_deadline_at,
    format,
    state,
    created_by
  )
  values (
    locked_group.id,
    normalized_description,
    scheduled_at_value,
    locked_group.time_zone,
    normalized_venue,
    normalized_url,
    normalized_notes,
    coalesce(p_notes_visible_to_players, true),
    rsvp_deadline_value,
    p_format,
    'draft',
    p_actor_user_id
  )
  returning * into saved_round;

  insert into public.audit_events (
    group_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    target_version,
    before_state,
    after_state,
    source,
    correlation_id,
    operation_id
  )
  values (
    saved_round.group_id,
    p_actor_user_id,
    'round.draft_created',
    'round',
    saved_round.id,
    saved_round.version,
    null,
    pg_catalog.jsonb_build_object(
      'round_id', saved_round.id,
      'group_id', saved_round.group_id,
      'description', saved_round.description,
      'scheduled_at', saved_round.scheduled_at,
      'group_time_zone', saved_round.group_time_zone::text,
      'venue', saved_round.venue,
      'round_url', saved_round.round_url,
      'notes', saved_round.notes,
      'notes_visible_to_players', saved_round.notes_visible_to_players,
      'rsvp_deadline_at', saved_round.rsvp_deadline_at,
      'format', saved_round.format,
      'state', saved_round.state,
      'request_fingerprint', request_fingerprint
    ),
    'portal',
    p_correlation_id,
    p_operation_id
  );

  return query
  select
    saved_round.id,
    saved_round.group_id,
    saved_round.description,
    saved_round.scheduled_at,
    saved_round.group_time_zone,
    saved_round.venue,
    saved_round.round_url,
    saved_round.notes,
    saved_round.notes_visible_to_players,
    saved_round.rsvp_deadline_at,
    saved_round.format,
    saved_round.state,
    saved_round.version;
end;
$$;

comment on function public.create_round_draft(uuid, text, text, text, text, text, boolean, text, public.round_format, uuid, uuid) is
  'Creates a private Draft round from local input interpreted in the actor-derived group time zone. Exact retries reconstruct the committed response.';

revoke all on function public.create_round_draft(uuid, text, text, text, text, text, boolean, text, public.round_format, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.create_round_draft(uuid, text, text, text, text, text, boolean, text, public.round_format, uuid, uuid)
to service_role;

create function public.update_round_draft(
  p_actor_user_id uuid,
  p_round_id uuid,
  p_description text,
  p_scheduled_local text,
  p_venue text,
  p_round_url text,
  p_notes text,
  p_notes_visible_to_players boolean,
  p_rsvp_deadline_local text,
  p_format public.round_format,
  p_expected_round_version bigint,
  p_correlation_id uuid,
  p_operation_id uuid
)
returns table (
  round_id app.entity_id,
  group_id app.entity_id,
  description text,
  scheduled_at app.utc_instant,
  group_time_zone app.iana_time_zone,
  venue text,
  round_url text,
  notes text,
  notes_visible_to_players boolean,
  rsvp_deadline_at app.utc_instant,
  format public.round_format,
  state public.round_state,
  version bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_group_id uuid;
  actor_membership public.memberships%rowtype;
  locked_group public.groups%rowtype;
  locked_round public.rounds%rowtype;
  saved_round public.rounds%rowtype;
  prior_event public.audit_events%rowtype;
  normalized_description text;
  normalized_venue text;
  normalized_url text;
  normalized_notes text;
  scheduled_at_value timestamptz;
  rsvp_deadline_value timestamptz;
  request_payload jsonb;
  request_fingerprint text;
  changed_fields jsonb := '[]'::jsonb;
begin
  if p_actor_user_id is null or p_round_id is null then
    raise exception 'round_input_invalid' using errcode = '22004';
  end if;
  if p_correlation_id is null or p_operation_id is null then
    raise exception 'operation_context_required' using errcode = '22004';
  end if;
  if p_expected_round_version is null or p_expected_round_version < 1 then
    raise exception 'round_input_invalid' using errcode = '22023';
  end if;

  normalized_description := nullif(pg_catalog.btrim(p_description), '');
  normalized_venue := nullif(pg_catalog.btrim(p_venue), '');
  normalized_url := nullif(pg_catalog.btrim(p_round_url), '');
  if normalized_url is not null
    and normalized_url !~ '^https://[^/?#[:space:]]+([/?#][^[:space:]]*)?$'
  then
    raise exception 'round_url_invalid' using errcode = '22023';
  end if;
  normalized_notes := nullif(pg_catalog.btrim(p_notes), '');
  if normalized_notes is not null and pg_catalog.length(normalized_notes) > 500 then
    raise exception 'round_notes_invalid' using errcode = '22023';
  end if;

  select actor.group_id
  into actor_group_id
  from app.resolve_member_management_actor(p_actor_user_id) as actor
  limit 1;
  if actor_group_id is null then
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

  select membership.*
  into actor_membership
  from public.memberships as membership
  join public.user_profiles as profile on profile.user_id = membership.user_id
  join auth.users as identity on identity.id = membership.user_id
  where membership.user_id = p_actor_user_id
    and membership.group_id = locked_group.id
    and membership.status = 'active'
    and profile.disabled_at is null
    and identity.email_confirmed_at is not null
    and identity.deleted_at is null
    and not identity.is_anonymous
    and not (coalesce(identity.raw_app_meta_data, '{}'::jsonb) ? 'greenroster_password_recovery')
    and (identity.banned_until is null or identity.banned_until <= pg_catalog.statement_timestamp())
  for update of membership;
  if not found then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  select round_record.*
  into locked_round
  from public.rounds as round_record
  where round_record.id = p_round_id
    and round_record.group_id = locked_group.id
  for update;
  if not found then
    raise exception 'round_not_found' using errcode = 'P0002';
  end if;

  request_payload := pg_catalog.jsonb_build_object(
    'round_id', p_round_id,
    'description', normalized_description,
    'scheduled_local', pg_catalog.btrim(p_scheduled_local),
    'venue', normalized_venue,
    'round_url', normalized_url,
    'notes', normalized_notes,
    'notes_visible_to_players', coalesce(p_notes_visible_to_players, true),
    'rsvp_deadline_local', nullif(pg_catalog.btrim(p_rsvp_deadline_local), ''),
    'format', p_format::text,
    'expected_round_version', p_expected_round_version
  );
  request_fingerprint := app.member_request_fingerprint(
    request_payload,
    p_actor_user_id::text || ':' || p_operation_id::text
  );

  select event.*
  into prior_event
  from public.audit_events as event
  where event.group_id = locked_group.id
    and event.actor_user_id = p_actor_user_id
    and event.action = 'round.draft_updated'
    and event.target_id = p_round_id
    and event.operation_id = p_operation_id;
  if found then
    if prior_event.after_state ->> 'request_fingerprint' <> request_fingerprint then
      raise exception 'operation_id_reused' using errcode = '23505';
    end if;
    return query
    select
      (prior_event.after_state ->> 'round_id')::app.entity_id,
      (prior_event.after_state ->> 'group_id')::app.entity_id,
      prior_event.after_state ->> 'description',
      (prior_event.after_state ->> 'scheduled_at')::app.utc_instant,
      (prior_event.after_state ->> 'group_time_zone')::app.iana_time_zone,
      prior_event.after_state ->> 'venue',
      prior_event.after_state ->> 'round_url',
      prior_event.after_state ->> 'notes',
      (prior_event.after_state ->> 'notes_visible_to_players')::boolean,
      (prior_event.after_state ->> 'rsvp_deadline_at')::app.utc_instant,
      (prior_event.after_state ->> 'format')::public.round_format,
      (prior_event.after_state ->> 'state')::public.round_state,
      prior_event.target_version;
    return;
  end if;

  if actor_membership.role not in ('coordinator', 'administrator') then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;
  if locked_round.state <> 'draft' then
    raise exception 'round_state_locked' using errcode = 'P0001';
  end if;
  if locked_round.version <> p_expected_round_version then
    raise exception 'round_version_changed' using errcode = '40001';
  end if;

  if nullif(pg_catalog.btrim(p_scheduled_local), '') is not null then
    scheduled_at_value := app.round_local_to_utc(
      p_scheduled_local,
      locked_round.group_time_zone::text,
      'round_scheduled_at_invalid'
    );
  end if;
  if nullif(pg_catalog.btrim(p_rsvp_deadline_local), '') is not null then
    if scheduled_at_value is null then
      raise exception 'round_rsvp_deadline_invalid' using errcode = '22023';
    end if;
    rsvp_deadline_value := app.round_local_to_utc(
      p_rsvp_deadline_local,
      locked_round.group_time_zone::text,
      'round_rsvp_deadline_invalid'
    );
    if rsvp_deadline_value >= scheduled_at_value then
      raise exception 'round_rsvp_deadline_invalid' using errcode = '22023';
    end if;
  end if;

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
  if locked_round.format is distinct from p_format then
    changed_fields := changed_fields || '["format"]'::jsonb;
  end if;

  update public.rounds
  set description = normalized_description,
      scheduled_at = scheduled_at_value,
      venue = normalized_venue,
      round_url = normalized_url,
      notes = normalized_notes,
      notes_visible_to_players = coalesce(p_notes_visible_to_players, true),
      rsvp_deadline_at = rsvp_deadline_value,
      format = p_format,
      version = public.rounds.version + 1
  where id = locked_round.id
  returning * into saved_round;

  insert into public.audit_events (
    group_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    target_version,
    before_state,
    after_state,
    source,
    correlation_id,
    operation_id
  )
  values (
    saved_round.group_id,
    p_actor_user_id,
    'round.draft_updated',
    'round',
    saved_round.id,
    saved_round.version,
    pg_catalog.jsonb_build_object(
      'round_version', locked_round.version,
      'changed_fields', changed_fields
    ),
    pg_catalog.jsonb_build_object(
      'round_id', saved_round.id,
      'group_id', saved_round.group_id,
      'description', saved_round.description,
      'scheduled_at', saved_round.scheduled_at,
      'group_time_zone', saved_round.group_time_zone::text,
      'venue', saved_round.venue,
      'round_url', saved_round.round_url,
      'notes', saved_round.notes,
      'notes_visible_to_players', saved_round.notes_visible_to_players,
      'rsvp_deadline_at', saved_round.rsvp_deadline_at,
      'format', saved_round.format,
      'state', saved_round.state,
      'changed_fields', changed_fields,
      'request_fingerprint', request_fingerprint
    ),
    'portal',
    p_correlation_id,
    p_operation_id
  );

  return query
  select
    saved_round.id,
    saved_round.group_id,
    saved_round.description,
    saved_round.scheduled_at,
    saved_round.group_time_zone,
    saved_round.venue,
    saved_round.round_url,
    saved_round.notes,
    saved_round.notes_visible_to_players,
    saved_round.rsvp_deadline_at,
    saved_round.format,
    saved_round.state,
    saved_round.version;
end;
$$;

comment on function public.update_round_draft(uuid, uuid, text, text, text, text, text, boolean, text, public.round_format, bigint, uuid, uuid) is
  'Updates a private Draft round with optimistic concurrency and exact operation replay. Published and later states are immutable in this slice.';

revoke all on function public.update_round_draft(uuid, uuid, text, text, text, text, text, boolean, text, public.round_format, bigint, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.update_round_draft(uuid, uuid, text, text, text, text, text, boolean, text, public.round_format, bigint, uuid, uuid)
to service_role;

create function public.list_rounds(
  p_actor_user_id uuid
)
returns table (
  round_id app.entity_id,
  group_id app.entity_id,
  group_name text,
  group_time_zone app.iana_time_zone,
  description text,
  scheduled_at app.utc_instant,
  venue text,
  round_url text,
  notes text,
  notes_visible_to_players boolean,
  rsvp_deadline_at app.utc_instant,
  format public.round_format,
  state public.round_state,
  version bigint,
  created_at app.utc_instant,
  updated_at app.utc_instant
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_group_id uuid;
begin
  if p_actor_user_id is null then
    raise exception 'actor_identity_required' using errcode = '22004';
  end if;
  select actor.group_id
  into actor_group_id
  from app.resolve_member_management_actor(p_actor_user_id) as actor
  limit 1;
  if actor_group_id is null then
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

  return query
  select
    round_record.id,
    round_record.group_id,
    group_record.name,
    round_record.group_time_zone,
    round_record.description,
    round_record.scheduled_at,
    round_record.venue,
    round_record.round_url,
    round_record.notes,
    round_record.notes_visible_to_players,
    round_record.rsvp_deadline_at,
    round_record.format,
    round_record.state,
    round_record.version,
    round_record.created_at,
    round_record.updated_at
  from public.rounds as round_record
  join public.groups as group_record on group_record.id = round_record.group_id
  where round_record.group_id = actor_group_id
  order by round_record.scheduled_at desc, round_record.id desc;
end;
$$;

comment on function public.list_rounds(uuid) is
  'Coordinator/administrator round projection. Draft rows are never exposed through a member-facing path.';

revoke all on function public.list_rounds(uuid)
from public, anon, authenticated;
grant execute on function public.list_rounds(uuid)
to service_role;
