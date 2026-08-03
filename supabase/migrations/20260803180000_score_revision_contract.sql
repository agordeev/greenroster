-- Phase 05: immutable score revisions and the authoritative current score
-- projection.  This slice deliberately stops before completion, ranking
-- materialization, realtime fan-out, and notification work.

create type public.round_participant_kind as enum ('member', 'guest');

create function app.valid_enabled_score_fields(p_fields jsonb)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  field_entry record;
begin
  if pg_catalog.jsonb_typeof(p_fields) <> 'object'
    or not (p_fields ? 'golf_points')
    or (p_fields -> 'golf_points') <> 'true'::jsonb
  then
    return false;
  end if;
  for field_entry in select * from pg_catalog.jsonb_each(p_fields) loop
    if field_entry.key not in ('golf_points', 'gross_score', 'net_score')
      or pg_catalog.jsonb_typeof(field_entry.value) <> 'boolean'
    then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

revoke all on function app.valid_enabled_score_fields(jsonb)
from public, anon, authenticated, service_role;

alter table public.rounds
  add column enable_gross_score boolean not null default false,
  add column enable_net_score boolean not null default false;

alter table public.rounds
  add constraint rounds_score_field_capabilities_valid check (
    format <> 'individual_gross'::public.round_format
    or not enable_net_score
  );

create function app.reject_round_score_capability_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.state <> 'draft' or new.state <> 'draft' then
    raise exception 'round_score_capabilities_locked' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function app.reject_round_score_capability_mutation()
from public, anon, authenticated, service_role;

create trigger rounds_score_capabilities_draft_only
before update of enable_gross_score, enable_net_score on public.rounds
for each row execute function app.reject_round_score_capability_mutation();

comment on column public.rounds.enable_gross_score is
  'Draft-only capability toggle for the optional gross final total; copied into the immutable rule snapshot at publication.';
comment on column public.rounds.enable_net_score is
  'Draft-only capability toggle for the optional net final total; unavailable for Individual Gross and copied into the immutable rule snapshot at publication.';

alter table public.round_rule_snapshots
  add column enabled_final_total_fields jsonb not null default
    '{"golf_points": true, "gross_score": false, "net_score": false}'::jsonb;

alter table public.round_rule_snapshots
  add constraint round_rule_snapshots_enabled_fields_valid check (
    app.valid_enabled_score_fields(enabled_final_total_fields)
  );

alter table public.round_rule_snapshots
  add constraint round_rule_snapshots_format_fields_valid check (
    format <> 'individual_gross'::public.round_format
    or coalesce((enabled_final_total_fields ->> 'net_score')::boolean, false) = false
  );

create function app.snapshot_score_field_capabilities()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  round_record public.rounds%rowtype;
begin
  select round_row.*
  into round_record
  from public.rounds as round_row
  where round_row.id = new.round_id
    and round_row.group_id = new.group_id;
  if not found then
    raise exception 'round_not_found' using errcode = 'P0002';
  end if;
  new.enabled_final_total_fields := pg_catalog.jsonb_build_object(
    'golf_points', true,
    'gross_score', round_record.enable_gross_score,
    'net_score', round_record.enable_net_score
  );
  return new;
end;
$$;

revoke all on function app.snapshot_score_field_capabilities()
from public, anon, authenticated, service_role;

create trigger round_rule_snapshots_set_score_capabilities
before insert on public.round_rule_snapshots
for each row execute function app.snapshot_score_field_capabilities();

comment on column public.round_rule_snapshots.enabled_final_total_fields is
  'Immutable published-round field capability map. Golf points are always enabled; gross/net toggles are supplied by the draft contract when that boundary is added.';

alter table public.round_participants
  alter column membership_id drop not null;

alter table public.round_participants
  add column participant_kind public.round_participant_kind not null default 'member',
  add column sponsor_membership_id app.entity_id,
  add column guest_first_name text,
  add column guest_last_name text;

comment on column public.round_participants.participant_kind is
  'Member or round-scoped guest marker. Guest creation and sponsor lifecycle RPCs remain a later participant boundary; score writes only honor rows that already satisfy this shape.';

alter table public.round_participants
  add constraint round_participants_sponsor_group_fk
    foreign key (sponsor_membership_id, group_id)
    references public.memberships (id, group_id)
    on delete restrict,
  add constraint round_participants_guest_shape_valid check (
    (
      participant_kind = 'member'
      and membership_id is not null
      and sponsor_membership_id is null
      and guest_first_name is null
      and guest_last_name is null
    )
    or (
      participant_kind = 'guest'
      and membership_id is null
      and sponsor_membership_id is not null
      and guest_first_name is not null
      and pg_catalog.btrim(guest_first_name) = guest_first_name
      and pg_catalog.length(guest_first_name) between 1 and 100
      and guest_first_name !~ '[[:space:]]{2,}'
      and guest_last_name is not null
      and pg_catalog.btrim(guest_last_name) = guest_last_name
      and pg_catalog.length(guest_last_name) between 1 and 100
      and guest_last_name !~ '[[:space:]]{2,}'
    )
  );

alter table public.round_participants
  add constraint round_participants_id_round_group_unique
  unique (id, round_id, group_id);

create index round_participants_group_round_kind_idx
  on public.round_participants (group_id, round_id, participant_kind);

create trigger round_participants_immutable_kind
before update of participant_kind on public.round_participants
for each row execute function app.reject_id_change('participant_kind');

create trigger round_participants_immutable_sponsor
before update of sponsor_membership_id on public.round_participants
for each row execute function app.reject_id_change('sponsor_membership_id');

create table public.participant_score_projections (
  participant_id app.entity_id primary key,
  group_id app.entity_id not null,
  round_id app.entity_id not null,
  gross_score app.golf_score_value,
  net_score app.golf_score_value,
  golf_points app.golf_points_value,
  manual_merit app.manual_merit_value,
  plus_minus app.plus_minus_value,
  ranking_value app.plus_minus_value,
  version bigint not null default 1,
  last_revision_id app.entity_id,
  created_at app.utc_instant not null default pg_catalog.now(),
  updated_at app.utc_instant not null default pg_catalog.now(),
  constraint participant_score_projections_id_group_unique unique (participant_id, group_id),
  constraint participant_score_projections_participant_group_fk
    foreign key (participant_id, group_id)
    references public.round_participants (id, group_id)
    on delete restrict,
  constraint participant_score_projections_participant_round_group_fk
    foreign key (participant_id, round_id, group_id)
    references public.round_participants (id, round_id, group_id)
    on delete restrict,
  constraint participant_score_projections_round_group_fk
    foreign key (round_id, group_id)
    references public.rounds (id, group_id)
    on delete restrict,
  constraint participant_score_projections_version_positive check (version > 0),
  constraint participant_score_projections_ranking_consistent check (
    (ranking_value is null and golf_points is null)
    or ranking_value is not null
  )
);

create index participant_score_projections_group_round_ranking_idx
  on public.participant_score_projections (group_id, round_id, ranking_value desc nulls last);

create trigger participant_score_projections_immutable_id
before update of participant_id on public.participant_score_projections
for each row execute function app.reject_id_change('participant_id');

create trigger participant_score_projections_immutable_group
before update of group_id on public.participant_score_projections
for each row execute function app.reject_id_change('group_id');

create trigger participant_score_projections_immutable_round
before update of round_id on public.participant_score_projections
for each row execute function app.reject_id_change('round_id');

create trigger participant_score_projections_set_updated_at
before update on public.participant_score_projections
for each row execute function app.set_updated_at();

create table public.score_revisions (
  id app.entity_id primary key default extensions.gen_random_uuid(),
  group_id app.entity_id not null,
  round_id app.entity_id not null,
  participant_id app.entity_id not null,
  revision_number bigint not null,
  base_version bigint not null,
  device_operation_id uuid not null,
  actor_user_id app.entity_id not null references auth.users (id) on delete restrict,
  source text not null,
  client_changed_at app.utc_instant not null,
  correlation_id uuid not null,
  operation_id uuid not null,
  changed_fields jsonb not null,
  gross_score app.golf_score_value,
  net_score app.golf_score_value,
  golf_points app.golf_points_value,
  manual_merit app.manual_merit_value,
  plus_minus app.plus_minus_value,
  ranking_value app.plus_minus_value,
  request_fingerprint text not null,
  reason text,
  created_at app.utc_instant not null default pg_catalog.now(),
  constraint score_revisions_id_group_unique unique (id, group_id),
  constraint score_revisions_participant_group_fk
    foreign key (participant_id, group_id)
    references public.round_participants (id, group_id)
    on delete restrict,
  constraint score_revisions_participant_round_group_fk
    foreign key (participant_id, round_id, group_id)
    references public.round_participants (id, round_id, group_id)
    on delete restrict,
  constraint score_revisions_round_group_fk
    foreign key (round_id, group_id)
    references public.rounds (id, group_id)
    on delete restrict,
  constraint score_revisions_revision_positive check (revision_number > 0),
  constraint score_revisions_base_version_valid check (base_version >= 0 and base_version = revision_number - 1),
  constraint score_revisions_source_valid check (source in ('mobile', 'portal')),
  constraint score_revisions_reason_valid check (reason is null or (pg_catalog.btrim(reason) = reason and pg_catalog.length(reason) between 1 and 500)),
  constraint score_revisions_changed_fields_object check (
    pg_catalog.jsonb_typeof(changed_fields) = 'object'
  ),
  constraint score_revisions_fingerprint_valid check (request_fingerprint ~ '^[0-9a-f]{64}$')
);

create unique index score_revisions_participant_revision_idx
  on public.score_revisions (participant_id, revision_number);

create unique index score_revisions_participant_device_operation_idx
  on public.score_revisions (participant_id, device_operation_id);

create unique index score_revisions_actor_operation_idx
  on public.score_revisions (actor_user_id, operation_id);

create index score_revisions_group_round_participant_idx
  on public.score_revisions (group_id, round_id, participant_id, revision_number desc);

create trigger score_revisions_immutable_id
before update of id on public.score_revisions
for each row execute function app.reject_id_change('id');

create function app.reject_score_revision_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'score_revisions_append_only' using errcode = 'P0001';
end;
$$;

revoke all on function app.reject_score_revision_mutation() from public, anon, authenticated, service_role;

create trigger score_revisions_append_only
before update or delete on public.score_revisions
for each row execute function app.reject_score_revision_mutation();

alter table public.participant_score_projections enable row level security;
alter table public.participant_score_projections force row level security;
alter table public.score_revisions enable row level security;
alter table public.score_revisions force row level security;

revoke all on table
  public.participant_score_projections,
  public.score_revisions
from public, anon, authenticated, service_role;

create function app.resolve_score_actor(p_actor_user_id uuid)
returns table (
  group_id app.entity_id,
  membership_id app.entity_id,
  actor_role public.membership_role
)
language sql
stable
security definer
set search_path = ''
as $$
  select membership.group_id, membership.id, membership.role
  from public.memberships as membership
  join public.user_profiles as profile on profile.user_id = membership.user_id
  join auth.users as identity on identity.id = membership.user_id
  where membership.user_id = p_actor_user_id
    and membership.status = 'active'
    and profile.disabled_at is null
    and identity.email_confirmed_at is not null
    and identity.deleted_at is null
    and not identity.is_anonymous
    and not (coalesce(identity.raw_app_meta_data, '{}'::jsonb) ? 'greenroster_password_recovery')
    and (identity.banned_until is null or identity.banned_until <= pg_catalog.statement_timestamp());
$$;

revoke all on function app.resolve_score_actor(uuid)
from public, anon, authenticated, service_role;

create function app.score_field_number(
  p_fields jsonb,
  p_field text,
  p_min numeric,
  p_max numeric,
  p_scale smallint,
  p_whole boolean
)
returns numeric
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  value_json jsonb;
  value_numeric numeric;
begin
  if not (p_fields ? p_field) then
    return null;
  end if;
  value_json := p_fields -> p_field;
  if value_json = 'null'::jsonb then
    return null;
  end if;
  if pg_catalog.jsonb_typeof(value_json) <> 'number' then
    raise exception 'score_field_invalid' using errcode = '22023';
  end if;
  value_numeric := (value_json #>> '{}')::numeric;
  if value_numeric <> value_numeric
    or value_numeric < p_min
    or value_numeric > p_max
    or value_numeric <> round(value_numeric, p_scale)
    or (p_whole and value_numeric <> trunc(value_numeric))
  then
    raise exception 'score_field_invalid' using errcode = '22023';
  end if;
  return value_numeric;
end;
$$;

revoke all on function app.score_field_number(jsonb, text, numeric, numeric, smallint, boolean)
from public, anon, authenticated, service_role;

create function public.set_round_participant_score(
  p_actor_user_id uuid,
  p_participant_id uuid,
  p_changed_fields jsonb,
  p_expected_score_version bigint,
  p_device_operation_id uuid,
  p_source text,
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
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_group_id uuid;
  actor_membership_id uuid;
  actor_role public.membership_role;
  locked_group public.groups%rowtype;
  locked_membership public.memberships%rowtype;
  locked_round public.rounds%rowtype;
  locked_participant public.round_participants%rowtype;
  snapshot_record public.round_rule_snapshots%rowtype;
  current_record public.participant_score_projections%rowtype;
  saved_projection public.participant_score_projections%rowtype;
  saved_revision public.score_revisions%rowtype;
  prior_revision public.score_revisions%rowtype;
  prior_event public.audit_events%rowtype;
  request_payload jsonb;
  request_fingerprint text;
  before_state jsonb;
  after_state jsonb;
  normalized_source text;
  normalized_reason text;
  actor_user_id uuid := p_actor_user_id;
  now_at timestamptz := pg_catalog.clock_timestamp();
  current_version bigint := 0;
  next_version bigint;
  current_gross app.golf_score_value;
  current_net app.golf_score_value;
  current_points app.golf_points_value;
  current_manual app.manual_merit_value;
  next_gross app.golf_score_value;
  next_net app.golf_score_value;
  next_points app.golf_points_value;
  next_manual app.manual_merit_value;
  next_plus_minus app.plus_minus_value;
  next_ranking_value app.plus_minus_value;
  stale_state jsonb;
  correction_requires_reason boolean := false;
  field_key text;
  current_projection_exists boolean := false;
begin
  if actor_user_id is null or p_participant_id is null or p_changed_fields is null then
    raise exception 'score_context_required' using errcode = '22004';
  end if;
  if p_expected_score_version is null or p_expected_score_version < 0 then
    raise exception 'score_version_invalid' using errcode = '22023';
  end if;
  if p_device_operation_id is null or p_client_changed_at is null or p_correlation_id is null or p_operation_id is null then
    raise exception 'operation_context_required' using errcode = '22004';
  end if;
  if pg_catalog.jsonb_typeof(p_changed_fields) <> 'object'
    or p_changed_fields = '{}'::jsonb
  then
    raise exception 'score_fields_required' using errcode = '22023';
  end if;
  normalized_source := nullif(pg_catalog.btrim(p_source), '');
  if normalized_source is null or normalized_source not in ('mobile', 'portal') then
    raise exception 'score_source_invalid' using errcode = '22023';
  end if;
  normalized_reason := nullif(pg_catalog.btrim(p_reason), '');
  if normalized_reason is not null and pg_catalog.length(normalized_reason) > 500 then
    raise exception 'score_reason_invalid' using errcode = '22023';
  end if;

  for field_key in select pg_catalog.jsonb_object_keys(p_changed_fields) loop
    if field_key not in ('gross_score', 'net_score', 'golf_points', 'manual_merit') then
      raise exception 'score_field_invalid' using errcode = '22023';
    end if;
  end loop;

  select actor.group_id, actor.membership_id, actor.actor_role
  into actor_group_id, actor_membership_id, actor_role
  from app.resolve_score_actor(actor_user_id) as actor
  limit 1;
  if actor_group_id is null then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  select group_record.* into locked_group
  from public.groups as group_record
  where group_record.id = actor_group_id
  for update;
  if not found then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  select membership.*
  into locked_membership
  from public.memberships as membership
  join public.user_profiles as profile on profile.user_id = membership.user_id
  join auth.users as identity on identity.id = membership.user_id
  where membership.id = actor_membership_id
    and membership.group_id = locked_group.id
    and membership.user_id = actor_user_id
    and membership.status = 'active'
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
  actor_role := locked_membership.role;

  select participant.*
  into locked_participant
  from public.round_participants as participant
  where participant.id = p_participant_id
    and participant.group_id = locked_group.id
  for update;
  if not found then
    raise exception 'participant_not_found' using errcode = 'P0002';
  end if;

  select round_record.*
  into locked_round
  from public.rounds as round_record
  where round_record.id = locked_participant.round_id
    and round_record.group_id = locked_group.id
  for update;
  if not found then
    raise exception 'round_not_found' using errcode = 'P0002';
  end if;

  select snapshot.*
  into snapshot_record
  from public.round_rule_snapshots as snapshot
  where snapshot.round_id = locked_round.id
    and snapshot.group_id = locked_round.group_id;
  if not found then
    raise exception 'round_rule_snapshot_missing' using errcode = 'P0002';
  end if;

  request_payload := pg_catalog.jsonb_build_object(
    'participant_id', p_participant_id,
    'changed_fields', p_changed_fields,
    'expected_score_version', p_expected_score_version,
    'source', normalized_source,
    'reason', normalized_reason,
    'client_changed_at', p_client_changed_at
  );
  request_fingerprint := app.member_request_fingerprint(
    request_payload,
    actor_user_id::text || ':' || p_device_operation_id::text
  );

  select revision.*
  into prior_revision
  from public.score_revisions as revision
  where revision.participant_id = locked_participant.id
    and revision.device_operation_id = p_device_operation_id;
  if found then
    if prior_revision.request_fingerprint <> request_fingerprint then
      raise exception 'operation_id_reused' using errcode = '23505';
    end if;
    return query
    select prior_revision.participant_id,
           prior_revision.round_id,
           prior_revision.group_id,
           prior_revision.revision_number,
           prior_revision.id,
           prior_revision.gross_score,
           prior_revision.net_score,
           prior_revision.golf_points,
           prior_revision.manual_merit,
           prior_revision.plus_minus,
           prior_revision.ranking_value,
           prior_revision.created_at;
    return;
  end if;

  if locked_round.state <> 'live' then
    raise exception 'round_scoring_locked' using errcode = 'P0001';
  end if;
  if locked_participant.rsvp_status <> 'playing' then
    raise exception 'participant_scoring_ineligible' using errcode = 'P0001';
  end if;
  if actor_role = 'member' and not (
    (locked_participant.participant_kind = 'member'
      and locked_participant.membership_id = actor_membership_id)
    or (locked_participant.participant_kind = 'guest'
      and locked_participant.sponsor_membership_id = actor_membership_id)
  ) then
    raise exception 'score_actor_not_authorized' using errcode = 'P0003';
  end if;
  if actor_role = 'member' and p_changed_fields ? 'manual_merit' then
    raise exception 'score_field_not_authorized' using errcode = 'P0003';
  end if;
  if p_changed_fields ? 'gross_score'
    and not coalesce((snapshot_record.enabled_final_total_fields ->> 'gross_score')::boolean, false)
  then
    raise exception 'score_field_disabled' using errcode = '22023';
  end if;
  if p_changed_fields ? 'net_score'
    and not coalesce((snapshot_record.enabled_final_total_fields ->> 'net_score')::boolean, false)
  then
    raise exception 'score_field_disabled' using errcode = '22023';
  end if;

  select projection.*
  into current_record
  from public.participant_score_projections as projection
  where projection.participant_id = locked_participant.id
    and projection.group_id = locked_group.id
  for update;
  if found then
    current_projection_exists := true;
    current_version := current_record.version;
    current_gross := current_record.gross_score;
    current_net := current_record.net_score;
    current_points := current_record.golf_points;
    current_manual := current_record.manual_merit;
  end if;
  if current_version <> p_expected_score_version then
    stale_state := pg_catalog.jsonb_build_object(
      'participant_id', locked_participant.id,
      'version', current_version,
      'revision_id', case when current_projection_exists then current_record.last_revision_id else null end,
      'gross_score', current_gross,
      'net_score', current_net,
      'golf_points', current_points,
      'manual_merit', current_manual,
      'plus_minus', case when current_projection_exists then current_record.plus_minus else null end,
      'ranking_value', case when current_projection_exists then current_record.ranking_value else null end,
      'changed_at', case when current_projection_exists then current_record.updated_at else null end
    );
    raise exception 'score_version_changed'
      using errcode = '40001', detail = stale_state::text;
  end if;

  next_gross := current_gross;
  next_net := current_net;
  next_points := current_points;
  next_manual := current_manual;
  if p_changed_fields ? 'gross_score' then
    next_gross := app.score_field_number(p_changed_fields, 'gross_score', 0::numeric, 300::numeric, 0::smallint, true)::app.golf_score_value;
  end if;
  if p_changed_fields ? 'net_score' then
    next_net := app.score_field_number(p_changed_fields, 'net_score', 0::numeric, 300::numeric, 0::smallint, true)::app.golf_score_value;
  end if;
  if p_changed_fields ? 'golf_points' then
    next_points := app.score_field_number(p_changed_fields, 'golf_points', 0::numeric, 100::numeric, 2::smallint, false)::app.golf_points_value;
  end if;
  if p_changed_fields ? 'manual_merit' then
    next_manual := app.score_field_number(p_changed_fields, 'manual_merit', -1000::numeric, 1000::numeric, 2::smallint, false)::app.manual_merit_value;
  end if;

  if p_changed_fields ? 'gross_score'
    and current_gross is not null
    and next_gross is distinct from current_gross
  then
    correction_requires_reason := true;
  end if;
  if p_changed_fields ? 'net_score'
    and current_net is not null
    and next_net is distinct from current_net
  then
    correction_requires_reason := true;
  end if;
  if p_changed_fields ? 'golf_points'
    and current_points is not null
    and next_points is distinct from current_points
  then
    correction_requires_reason := true;
  end if;
  if p_changed_fields ? 'manual_merit'
    and current_manual is not null
    and next_manual is distinct from current_manual
  then
    correction_requires_reason := true;
  end if;

  if normalized_source = 'portal' and actor_role = 'member' then
    raise exception 'score_actor_not_authorized' using errcode = 'P0003';
  end if;
  if correction_requires_reason and normalized_reason is null then
    raise exception 'score_correction_reason_required' using errcode = '22023';
  end if;

  if locked_round.format = 'individual_net'
    and locked_participant.quota_snapshot is null
  then
    raise exception 'score_quota_missing' using errcode = '22023';
  end if;
  if next_points is null or locked_participant.quota_snapshot is null then
    next_plus_minus := null;
  else
    next_plus_minus := (next_points - locked_participant.quota_snapshot)::app.plus_minus_value;
  end if;
  if next_points is null then
    next_ranking_value := null;
  elsif locked_round.format = 'individual_net' then
    next_ranking_value := next_plus_minus;
  else
    next_ranking_value := next_points::app.plus_minus_value;
  end if;

  next_version := current_version + 1;
  insert into public.score_revisions (
    group_id, round_id, participant_id, revision_number, base_version,
    device_operation_id, actor_user_id, source, client_changed_at,
    correlation_id, operation_id, changed_fields, gross_score, net_score,
    golf_points, manual_merit, plus_minus, ranking_value,
    request_fingerprint, reason
  )
  values (
    locked_group.id, locked_round.id, locked_participant.id, next_version,
    current_version, p_device_operation_id, actor_user_id, normalized_source,
    p_client_changed_at, p_correlation_id, p_operation_id, p_changed_fields,
    next_gross, next_net, next_points, next_manual, next_plus_minus,
    next_ranking_value, request_fingerprint, normalized_reason
  )
  returning * into saved_revision;

  if current_projection_exists then
    update public.participant_score_projections as projection
    set gross_score = saved_revision.gross_score,
        net_score = saved_revision.net_score,
        golf_points = saved_revision.golf_points,
        manual_merit = saved_revision.manual_merit,
        plus_minus = saved_revision.plus_minus,
        ranking_value = saved_revision.ranking_value,
        version = saved_revision.revision_number,
        last_revision_id = saved_revision.id
    where projection.participant_id = locked_participant.id
      and projection.group_id = locked_group.id
    returning * into saved_projection;
  else
    insert into public.participant_score_projections (
      participant_id, group_id, round_id, gross_score, net_score, golf_points,
      manual_merit, plus_minus, ranking_value, version, last_revision_id
    )
    values (
      locked_participant.id, locked_group.id, locked_round.id,
      saved_revision.gross_score, saved_revision.net_score, saved_revision.golf_points,
      saved_revision.manual_merit, saved_revision.plus_minus, saved_revision.ranking_value,
      saved_revision.revision_number, saved_revision.id
    )
    returning * into saved_projection;
  end if;

  before_state := pg_catalog.jsonb_build_object(
    'participant_id', locked_participant.id,
    'version', current_version,
    'gross_score', current_gross,
    'net_score', current_net,
    'golf_points', current_points,
    'manual_merit', current_manual
  );
  after_state := pg_catalog.jsonb_build_object(
    'participant_id', saved_projection.participant_id,
    'round_id', saved_projection.round_id,
    'version', saved_projection.version,
    'revision_id', saved_revision.id,
    'gross_score', saved_projection.gross_score,
    'net_score', saved_projection.net_score,
    'golf_points', saved_projection.golf_points,
    'manual_merit', saved_projection.manual_merit,
    'plus_minus', saved_projection.plus_minus,
    'ranking_value', saved_projection.ranking_value,
    'request_fingerprint', request_fingerprint
  );

  insert into public.audit_events (
    group_id, actor_user_id, action, target_type, target_id, target_version,
    before_state, after_state, source, correlation_id, operation_id, reason
  )
  values (
    saved_projection.group_id, actor_user_id, 'round.score_updated',
    'round_participant', saved_projection.participant_id, saved_projection.version,
    before_state, after_state, normalized_source, p_correlation_id, p_operation_id,
    normalized_reason
  );

  return query
  select saved_projection.participant_id,
         saved_projection.round_id,
         saved_projection.group_id,
         saved_projection.version,
         saved_revision.id,
         saved_projection.gross_score,
         saved_projection.net_score,
         saved_projection.golf_points,
         saved_projection.manual_merit,
         saved_projection.plus_minus,
         saved_projection.ranking_value,
         saved_revision.created_at;
end;
$$;

comment on function public.set_round_participant_score(uuid, uuid, jsonb, bigint, uuid, text, text, app.utc_instant, uuid, uuid) is
  'Accepts one server-authorized score revision for a Live Playing participant, preserving immutable history and updating the current projection atomically.';

revoke all on function public.set_round_participant_score(uuid, uuid, jsonb, bigint, uuid, text, text, app.utc_instant, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.set_round_participant_score(uuid, uuid, jsonb, bigint, uuid, text, text, app.utc_instant, uuid, uuid)
to service_role;

create function public.set_round_draft_score_fields(
  p_actor_user_id uuid,
  p_round_id uuid,
  p_enable_gross_score boolean,
  p_enable_net_score boolean,
  p_expected_round_version bigint,
  p_correlation_id uuid,
  p_operation_id uuid
)
returns table (
  round_id app.entity_id,
  group_id app.entity_id,
  format public.round_format,
  enable_gross_score boolean,
  enable_net_score boolean,
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
  request_payload jsonb;
  request_fingerprint text;
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
  if p_enable_gross_score is null or p_enable_net_score is null then
    raise exception 'score_field_capabilities_required' using errcode = '22004';
  end if;

  select actor.group_id
  into actor_group_id
  from app.resolve_member_management_actor(p_actor_user_id) as actor
  limit 1;
  if actor_group_id is null then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  select group_row.*
  into locked_group
  from public.groups as group_row
  where group_row.id = actor_group_id
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
  if not found or actor_membership.role not in ('coordinator', 'administrator') then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  select round_row.*
  into locked_round
  from public.rounds as round_row
  where round_row.id = p_round_id
    and round_row.group_id = locked_group.id
  for update;
  if not found then
    raise exception 'round_not_found' using errcode = 'P0002';
  end if;
  if locked_round.state <> 'draft' then
    raise exception 'round_state_locked' using errcode = 'P0001';
  end if;
  if locked_round.format is null then
    raise exception 'round_format_required' using errcode = '22023';
  end if;
  if locked_round.format = 'individual_gross' and p_enable_net_score then
    raise exception 'score_field_capability_invalid' using errcode = '22023';
  end if;

  request_payload := pg_catalog.jsonb_build_object(
    'round_id', p_round_id,
    'enable_gross_score', p_enable_gross_score,
    'enable_net_score', p_enable_net_score,
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
    and event.action = 'round.draft_score_fields_updated'
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
      (prior_event.after_state ->> 'format')::public.round_format,
      (prior_event.after_state ->> 'enable_gross_score')::boolean,
      (prior_event.after_state ->> 'enable_net_score')::boolean,
      prior_event.target_version;
    return;
  end if;

  if locked_round.version <> p_expected_round_version then
    raise exception 'round_version_changed' using errcode = '40001';
  end if;

  update public.rounds as round_row
  set enable_gross_score = p_enable_gross_score,
      enable_net_score = p_enable_net_score,
      version = round_row.version + 1
  where round_row.id = locked_round.id
  returning * into saved_round;

  insert into public.audit_events (
    group_id, actor_user_id, action, target_type, target_id, target_version,
    before_state, after_state, source, correlation_id, operation_id
  )
  values (
    saved_round.group_id, p_actor_user_id, 'round.draft_score_fields_updated',
    'round', saved_round.id, saved_round.version,
    pg_catalog.jsonb_build_object(
      'version', locked_round.version,
      'enable_gross_score', locked_round.enable_gross_score,
      'enable_net_score', locked_round.enable_net_score
    ),
    pg_catalog.jsonb_build_object(
      'round_id', saved_round.id,
      'group_id', saved_round.group_id,
      'format', saved_round.format,
      'enable_gross_score', saved_round.enable_gross_score,
      'enable_net_score', saved_round.enable_net_score,
      'request_fingerprint', request_fingerprint
    ),
    'portal', p_correlation_id, p_operation_id
  );

  return query
  select saved_round.id, saved_round.group_id, saved_round.format,
         saved_round.enable_gross_score, saved_round.enable_net_score,
         saved_round.version;
end;
$$;

comment on function public.set_round_draft_score_fields(uuid, uuid, boolean, boolean, bigint, uuid, uuid) is
  'Updates optional Draft final-total capabilities with coordinator/administrator authority; publication copies the values into the immutable rule snapshot.';

revoke all on function public.set_round_draft_score_fields(uuid, uuid, boolean, boolean, bigint, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.set_round_draft_score_fields(uuid, uuid, boolean, boolean, bigint, uuid, uuid)
to service_role;
