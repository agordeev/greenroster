-- Hole-level scorecard and personal golf-statistics contract.
--
-- The legacy product records hole strokes, putts, fairways, greens, sand
-- saves, and a note.  It does not define par/course data, point conversion,
-- team payouts, skins, Require Entry, or tie handling; those rules remain out
-- of this slice.  These rows therefore remain a personal round record and do
-- not change the existing points leaderboard.

create table public.participant_hole_scores (
  id app.entity_id primary key default extensions.gen_random_uuid(),
  group_id app.entity_id not null,
  round_id app.entity_id not null,
  participant_id app.entity_id not null,
  hole_number smallint not null,
  version bigint not null default 0,
  strokes smallint,
  putts smallint,
  fairway_hit boolean,
  green_in_regulation boolean,
  sand_save boolean,
  hole_comment text,
  updated_at app.utc_instant not null default pg_catalog.now(),
  constraint participant_hole_scores_id_group_unique unique (id, group_id),
  constraint participant_hole_scores_participant_group_fk
    foreign key (participant_id, group_id)
    references public.round_participants (id, group_id)
    on delete cascade,
  constraint participant_hole_scores_participant_round_group_fk
    foreign key (participant_id, round_id, group_id)
    references public.round_participants (id, round_id, group_id)
    on delete cascade,
  constraint participant_hole_scores_round_group_fk
    foreign key (round_id, group_id)
    references public.rounds (id, group_id)
    on delete cascade,
  constraint participant_hole_scores_hole_valid check (hole_number between 1 and 18),
  constraint participant_hole_scores_version_valid check (version >= 0),
  constraint participant_hole_scores_strokes_valid check (
    strokes is null or (strokes between 0 and 30)
  ),
  constraint participant_hole_scores_putts_valid check (
    putts is null or (putts between 0 and 20)
  ),
  constraint participant_hole_scores_comment_valid check (
    hole_comment is null
    or (
      pg_catalog.btrim(hole_comment) = hole_comment
      and pg_catalog.length(hole_comment) between 1 and 500
    )
  ),
  constraint participant_hole_scores_participant_hole_unique
    unique (participant_id, hole_number)
);

comment on table public.participant_hole_scores is
  'Current hole-level personal scorecard values. Strokes and putts are whole numbers; tracking flags are nullable until entered; no course or point conversion is implied.';
comment on column public.participant_hole_scores.strokes is
  'Gross strokes for this hole, 0 through 30. Null means you have not entered strokes.';
comment on column public.participant_hole_scores.putts is
  'Putts for this hole, 0 through 20. Null means you have not entered putts.';
comment on column public.participant_hole_scores.fairway_hit is
  'Whether you hit the fairway on this hole; null means you have not entered the stat.';
comment on column public.participant_hole_scores.green_in_regulation is
  'Whether you reached the green in regulation; null means you have not entered the stat.';
comment on column public.participant_hole_scores.sand_save is
  'Whether you saved par or better after a bunker shot; null means you have not entered the stat.';
comment on column public.participant_hole_scores.hole_comment is
  'Optional private note for this hole, up to 500 characters.';

create index participant_hole_scores_group_round_idx
  on public.participant_hole_scores (group_id, round_id, participant_id, hole_number);

create trigger participant_hole_scores_immutable_id
before update of id on public.participant_hole_scores
for each row execute function app.reject_id_change('id');
create trigger participant_hole_scores_immutable_group
before update of group_id on public.participant_hole_scores
for each row execute function app.reject_id_change('group_id');
create trigger participant_hole_scores_immutable_round
before update of round_id on public.participant_hole_scores
for each row execute function app.reject_id_change('round_id');
create trigger participant_hole_scores_immutable_participant
before update of participant_id on public.participant_hole_scores
for each row execute function app.reject_id_change('participant_id');
create trigger participant_hole_scores_immutable_hole
before update of hole_number on public.participant_hole_scores
for each row execute function app.reject_id_change('hole_number');
create trigger participant_hole_scores_set_updated_at
before update on public.participant_hole_scores
for each row execute function app.set_updated_at();

create function app.seed_participant_hole_scores()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.participant_hole_scores (
    group_id, round_id, participant_id, hole_number
  )
  select new.group_id, new.round_id, new.id, hole_number
  from pg_catalog.generate_series(1, 18) as holes(hole_number)
  on conflict (participant_id, hole_number) do nothing;
  return new;
end;
$$;

revoke all on function app.seed_participant_hole_scores()
from public, anon, authenticated, service_role;

create trigger round_participants_seed_hole_scores
after insert on public.round_participants
for each row execute function app.seed_participant_hole_scores();

insert into public.participant_hole_scores (
  group_id, round_id, participant_id, hole_number
)
select participant.group_id, participant.round_id, participant.id, holes.hole_number
from public.round_participants as participant
cross join lateral pg_catalog.generate_series(1, 18) as holes(hole_number)
on conflict (participant_id, hole_number) do nothing;

create table public.participant_hole_score_revisions (
  id app.entity_id primary key default extensions.gen_random_uuid(),
  group_id app.entity_id not null,
  round_id app.entity_id not null,
  participant_id app.entity_id not null,
  hole_number smallint not null,
  revision_number bigint not null,
  base_version bigint not null,
  device_operation_id uuid not null,
  actor_user_id app.entity_id not null references auth.users (id) on delete restrict,
  source text not null,
  client_changed_at app.utc_instant not null,
  correlation_id uuid not null,
  operation_id uuid not null,
  changed_fields jsonb not null,
  strokes smallint,
  putts smallint,
  fairway_hit boolean,
  green_in_regulation boolean,
  sand_save boolean,
  hole_comment text,
  request_fingerprint text not null,
  reason text,
  created_at app.utc_instant not null default pg_catalog.now(),
  constraint participant_hole_revisions_id_group_unique unique (id, group_id),
  constraint participant_hole_revisions_hole_fk
    foreign key (participant_id, hole_number)
    references public.participant_hole_scores (participant_id, hole_number)
    on delete cascade,
  constraint participant_hole_revisions_participant_group_fk
    foreign key (participant_id, group_id)
    references public.round_participants (id, group_id)
    on delete cascade,
  constraint participant_hole_revisions_round_group_fk
    foreign key (round_id, group_id)
    references public.rounds (id, group_id)
    on delete cascade,
  constraint participant_hole_revisions_hole_valid check (hole_number between 1 and 18),
  constraint participant_hole_revisions_revision_valid check (
    revision_number > 0 and base_version >= 0 and base_version = revision_number - 1
  ),
  constraint participant_hole_revisions_source_valid check (source in ('mobile', 'portal')),
  constraint participant_hole_revisions_changed_fields_valid check (
    pg_catalog.jsonb_typeof(changed_fields) = 'object'
  ),
  constraint participant_hole_revisions_fingerprint_valid check (
    request_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  constraint participant_hole_revisions_reason_valid check (
    reason is null or (pg_catalog.btrim(reason) = reason and pg_catalog.length(reason) between 1 and 500)
  ),
  constraint participant_hole_revisions_strokes_valid check (strokes is null or strokes between 0 and 30),
  constraint participant_hole_revisions_putts_valid check (putts is null or putts between 0 and 20),
  constraint participant_hole_revisions_comment_valid check (
    hole_comment is null
    or (pg_catalog.btrim(hole_comment) = hole_comment and pg_catalog.length(hole_comment) between 1 and 500)
  )
);

create unique index participant_hole_revisions_revision_idx
  on public.participant_hole_score_revisions (participant_id, hole_number, revision_number);
create unique index participant_hole_revisions_device_operation_idx
  on public.participant_hole_score_revisions (participant_id, hole_number, device_operation_id);
create unique index participant_hole_revisions_actor_operation_idx
  on public.participant_hole_score_revisions (actor_user_id, operation_id);

create trigger participant_hole_revisions_immutable_id
before update of id on public.participant_hole_score_revisions
for each row execute function app.reject_id_change('id');

create function app.reject_participant_hole_revision_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'participant_hole_revisions_append_only' using errcode = 'P0001';
end;
$$;

revoke all on function app.reject_participant_hole_revision_mutation()
from public, anon, authenticated, service_role;

create trigger participant_hole_revisions_append_only
before update or delete on public.participant_hole_score_revisions
for each row execute function app.reject_participant_hole_revision_mutation();

alter table public.participant_hole_scores enable row level security;
alter table public.participant_hole_scores force row level security;
alter table public.participant_hole_score_revisions enable row level security;
alter table public.participant_hole_score_revisions force row level security;
revoke all on table public.participant_hole_scores, public.participant_hole_score_revisions
from public, anon, authenticated, service_role;

create function public.set_round_participant_hole_score(
  p_actor_user_id uuid,
  p_participant_id uuid,
  p_hole_number smallint,
  p_changed_fields jsonb,
  p_expected_version bigint,
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
  hole_number smallint,
  version bigint,
  revision_id app.entity_id,
  strokes smallint,
  putts smallint,
  fairway_hit boolean,
  green_in_regulation boolean,
  sand_save boolean,
  hole_comment text,
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
  locked_participant public.round_participants%rowtype;
  locked_round public.rounds%rowtype;
  current_record public.participant_hole_scores%rowtype;
  saved_revision public.participant_hole_score_revisions%rowtype;
  request_payload jsonb;
  request_fingerprint text;
  normalized_source text;
  normalized_reason text;
  field_key text;
  current_strokes smallint;
  current_putts smallint;
  current_fairway boolean;
  current_gir boolean;
  current_sand boolean;
  current_comment text;
  next_strokes smallint;
  next_putts smallint;
  next_fairway boolean;
  next_gir boolean;
  next_sand boolean;
  next_comment text;
  correction_requires_reason boolean := false;
  prior_revision public.participant_hole_score_revisions%rowtype;
begin
  if p_actor_user_id is null or p_participant_id is null or p_changed_fields is null then
    raise exception 'hole_score_context_required' using errcode = '22004';
  end if;
  if p_hole_number is null or p_hole_number not between 1 and 18 then
    raise exception 'hole_number_invalid' using errcode = '22023';
  end if;
  if p_expected_version is null or p_expected_version < 0 then
    raise exception 'hole_score_version_invalid' using errcode = '22023';
  end if;
  if p_device_operation_id is null or p_client_changed_at is null
     or p_correlation_id is null or p_operation_id is null then
    raise exception 'operation_context_required' using errcode = '22004';
  end if;
  if pg_catalog.jsonb_typeof(p_changed_fields) <> 'object'
     or p_changed_fields = '{}'::jsonb then
    raise exception 'hole_score_fields_required' using errcode = '22023';
  end if;
  normalized_source := nullif(pg_catalog.btrim(p_source), '');
  if normalized_source is null or normalized_source not in ('mobile', 'portal') then
    raise exception 'hole_score_source_invalid' using errcode = '22023';
  end if;
  normalized_reason := nullif(pg_catalog.btrim(p_reason), '');
  if normalized_reason is not null and pg_catalog.length(normalized_reason) > 500 then
    raise exception 'hole_score_reason_invalid' using errcode = '22023';
  end if;
  for field_key in select pg_catalog.jsonb_object_keys(p_changed_fields) loop
    if field_key not in ('strokes', 'putts', 'fairway_hit', 'green_in_regulation', 'sand_save', 'hole_comment') then
      raise exception 'hole_score_field_invalid' using errcode = '22023';
    end if;
  end loop;

  select actor.group_id, actor.membership_id, actor.actor_role
  into actor_group_id, actor_membership_id, actor_role
  from app.resolve_score_actor(p_actor_user_id) as actor
  limit 1;
  if actor_group_id is null then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  select participant.* into locked_participant
  from public.round_participants as participant
  where participant.id = p_participant_id and participant.group_id = actor_group_id
  for update;
  if not found then
    raise exception 'participant_not_found' using errcode = 'P0002';
  end if;
  select round_record.* into locked_round
  from public.rounds as round_record
  where round_record.id = locked_participant.round_id
    and round_record.group_id = actor_group_id
  for update;
  if not found then
    raise exception 'round_not_found' using errcode = 'P0002';
  end if;

  request_payload := pg_catalog.jsonb_build_object(
    'participant_id', p_participant_id,
    'hole_number', p_hole_number,
    'changed_fields', p_changed_fields,
    'expected_version', p_expected_version,
    'source', normalized_source,
    'reason', normalized_reason,
    'client_changed_at', p_client_changed_at
  );
  request_fingerprint := app.member_request_fingerprint(
    request_payload,
    p_actor_user_id::text || ':' || p_device_operation_id::text
  );
  select revision.* into prior_revision
  from public.participant_hole_score_revisions as revision
  where revision.participant_id = p_participant_id
    and revision.hole_number = p_hole_number
    and revision.device_operation_id = p_device_operation_id;
  if found then
    if prior_revision.operation_id <> p_operation_id then
      raise exception 'operation_id_reused' using errcode = '23505';
    end if;
    return query select prior_revision.participant_id::app.entity_id, prior_revision.round_id::app.entity_id,
      prior_revision.group_id::app.entity_id, prior_revision.hole_number,
      prior_revision.revision_number, prior_revision.id, prior_revision.strokes,
      prior_revision.putts, prior_revision.fairway_hit, prior_revision.green_in_regulation,
      prior_revision.sand_save, prior_revision.hole_comment, prior_revision.created_at;
    return;
  end if;

  if locked_round.state <> 'live' then
    raise exception 'round_scoring_locked' using errcode = 'P0001';
  end if;
  if locked_participant.rsvp_status <> 'playing' then
    raise exception 'participant_scoring_ineligible' using errcode = 'P0001';
  end if;
  if actor_role = 'member' and not (
    (locked_participant.participant_kind = 'member' and locked_participant.membership_id = actor_membership_id)
    or (locked_participant.participant_kind = 'guest' and locked_participant.sponsor_membership_id = actor_membership_id)
  ) then
    raise exception 'score_actor_not_authorized' using errcode = 'P0003';
  end if;
  if normalized_source = 'portal' and actor_role = 'member' then
    raise exception 'score_actor_not_authorized' using errcode = 'P0003';
  end if;

  select scorecard.* into current_record
  from public.participant_hole_scores as scorecard
  where scorecard.participant_id = p_participant_id
    and scorecard.hole_number = p_hole_number
    and scorecard.group_id = actor_group_id
  for update;
  if not found then
    raise exception 'hole_score_not_found' using errcode = 'P0002';
  end if;
  if current_record.version <> p_expected_version then
    raise exception 'hole_score_version_changed' using errcode = '40001',
      detail = pg_catalog.jsonb_build_object(
        'participant_id', current_record.participant_id,
        'hole_number', current_record.hole_number,
        'version', current_record.version,
        'strokes', current_record.strokes,
        'putts', current_record.putts,
        'fairway_hit', current_record.fairway_hit,
        'green_in_regulation', current_record.green_in_regulation,
        'sand_save', current_record.sand_save,
        'hole_comment', current_record.hole_comment,
        'changed_at', current_record.updated_at
      )::text;
  end if;

  current_strokes := current_record.strokes;
  current_putts := current_record.putts;
  current_fairway := current_record.fairway_hit;
  current_gir := current_record.green_in_regulation;
  current_sand := current_record.sand_save;
  current_comment := current_record.hole_comment;
  next_strokes := current_strokes;
  next_putts := current_putts;
  next_fairway := current_fairway;
  next_gir := current_gir;
  next_sand := current_sand;
  next_comment := current_comment;

  if p_changed_fields ? 'strokes' then
    if p_changed_fields -> 'strokes' = 'null'::jsonb then next_strokes := null;
    elsif pg_catalog.jsonb_typeof(p_changed_fields -> 'strokes') <> 'number'
      or (p_changed_fields ->> 'strokes')::numeric <> trunc((p_changed_fields ->> 'strokes')::numeric)
      or (p_changed_fields ->> 'strokes')::numeric not between 0 and 30
    then raise exception 'hole_score_field_invalid' using errcode = '22023';
    else next_strokes := (p_changed_fields ->> 'strokes')::smallint; end if;
  end if;
  if p_changed_fields ? 'putts' then
    if p_changed_fields -> 'putts' = 'null'::jsonb then next_putts := null;
    elsif pg_catalog.jsonb_typeof(p_changed_fields -> 'putts') <> 'number'
      or (p_changed_fields ->> 'putts')::numeric <> trunc((p_changed_fields ->> 'putts')::numeric)
      or (p_changed_fields ->> 'putts')::numeric not between 0 and 20
    then raise exception 'hole_score_field_invalid' using errcode = '22023';
    else next_putts := (p_changed_fields ->> 'putts')::smallint; end if;
  end if;
  foreach field_key in array array['fairway_hit', 'green_in_regulation', 'sand_save'] loop
    if p_changed_fields ? field_key then
      if p_changed_fields -> field_key = 'null'::jsonb then
        if field_key = 'fairway_hit' then next_fairway := null;
        elsif field_key = 'green_in_regulation' then next_gir := null;
        else next_sand := null; end if;
      elsif pg_catalog.jsonb_typeof(p_changed_fields -> field_key) <> 'boolean' then
        raise exception 'hole_score_field_invalid' using errcode = '22023';
      elsif field_key = 'fairway_hit' then next_fairway := (p_changed_fields ->> field_key)::boolean;
      elsif field_key = 'green_in_regulation' then next_gir := (p_changed_fields ->> field_key)::boolean;
      else next_sand := (p_changed_fields ->> field_key)::boolean;
      end if;
    end if;
  end loop;
  if p_changed_fields ? 'hole_comment' then
    if p_changed_fields -> 'hole_comment' = 'null'::jsonb then next_comment := null;
    elsif pg_catalog.jsonb_typeof(p_changed_fields -> 'hole_comment') <> 'string' then
      raise exception 'hole_score_field_invalid' using errcode = '22023';
    else
      next_comment := nullif(pg_catalog.btrim(p_changed_fields ->> 'hole_comment'), '');
      if next_comment is not null and pg_catalog.length(next_comment) > 500 then
        raise exception 'hole_score_field_invalid' using errcode = '22023';
      end if;
    end if;
  end if;

  correction_requires_reason :=
    (p_changed_fields ? 'strokes' and current_strokes is not null and next_strokes is distinct from current_strokes)
    or (p_changed_fields ? 'putts' and current_putts is not null and next_putts is distinct from current_putts)
    or (p_changed_fields ? 'fairway_hit' and current_fairway is not null and next_fairway is distinct from current_fairway)
    or (p_changed_fields ? 'green_in_regulation' and current_gir is not null and next_gir is distinct from current_gir)
    or (p_changed_fields ? 'sand_save' and current_sand is not null and next_sand is distinct from current_sand)
    or (p_changed_fields ? 'hole_comment' and current_comment is not null and next_comment is distinct from current_comment);
  if correction_requires_reason and normalized_reason is null then
    raise exception 'hole_score_correction_reason_required' using errcode = '22023';
  end if;

  insert into public.participant_hole_score_revisions (
    group_id, round_id, participant_id, hole_number, revision_number, base_version,
    device_operation_id, actor_user_id, source, client_changed_at, correlation_id,
    operation_id, changed_fields, strokes, putts, fairway_hit, green_in_regulation,
    sand_save, hole_comment, request_fingerprint, reason
  ) values (
    actor_group_id, locked_round.id, p_participant_id, p_hole_number,
    current_record.version + 1, current_record.version, p_device_operation_id,
    p_actor_user_id, normalized_source, p_client_changed_at, p_correlation_id,
    p_operation_id, p_changed_fields, next_strokes, next_putts, next_fairway,
    next_gir, next_sand, next_comment, request_fingerprint, normalized_reason
  ) returning * into saved_revision;

  update public.participant_hole_scores as scorecard
  set version = saved_revision.revision_number,
      strokes = saved_revision.strokes,
      putts = saved_revision.putts,
      fairway_hit = saved_revision.fairway_hit,
      green_in_regulation = saved_revision.green_in_regulation,
      sand_save = saved_revision.sand_save,
      hole_comment = saved_revision.hole_comment
  where scorecard.id = current_record.id;

  insert into public.audit_events (
    group_id, actor_user_id, action, target_type, target_id, target_version,
    before_state, after_state, source, correlation_id, operation_id, reason
  ) values (
    actor_group_id, p_actor_user_id, 'round.hole_score_updated',
    'participant_hole_score', p_participant_id, saved_revision.revision_number,
    pg_catalog.jsonb_build_object('hole_number', p_hole_number, 'version', current_record.version,
      'strokes', current_strokes, 'putts', current_putts, 'fairway_hit', current_fairway,
      'green_in_regulation', current_gir, 'sand_save', current_sand, 'hole_comment', current_comment),
    pg_catalog.jsonb_build_object('participant_id', p_participant_id, 'hole_number', p_hole_number,
      'version', saved_revision.revision_number, 'strokes', next_strokes, 'putts', next_putts,
      'fairway_hit', next_fairway, 'green_in_regulation', next_gir, 'sand_save', next_sand,
      'hole_comment', next_comment, 'request_fingerprint', request_fingerprint),
    normalized_source, p_correlation_id, p_operation_id, normalized_reason
  );

  return query select p_participant_id::app.entity_id, locked_round.id::app.entity_id, actor_group_id::app.entity_id, p_hole_number,
    saved_revision.revision_number, saved_revision.id, next_strokes, next_putts,
    next_fairway, next_gir, next_sand, next_comment, saved_revision.created_at;
end;
$$;

comment on function public.set_round_participant_hole_score(uuid,uuid,smallint,jsonb,bigint,uuid,text,text,app.utc_instant,uuid,uuid) is
  'Accepts one server-authorized Live participant hole-stat revision. It records strokes, putts, fairway, green, sand-save, and comments without calculating points or changing rankings.';

revoke all on function public.set_round_participant_hole_score(uuid,uuid,smallint,jsonb,bigint,uuid,text,text,app.utc_instant,uuid,uuid)
from public, anon, authenticated;
grant execute on function public.set_round_participant_hole_score(uuid,uuid,smallint,jsonb,bigint,uuid,text,text,app.utc_instant,uuid,uuid)
to service_role;

-- SQL clients often infer an integer for an uncast hole literal. Keep the
-- canonical smallint contract while accepting that harmless call-site shape.
create function public.set_round_participant_hole_score(
  p_actor_user_id uuid,
  p_participant_id uuid,
  p_hole_number integer,
  p_changed_fields jsonb,
  p_expected_version bigint,
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
  hole_number smallint,
  version bigint,
  revision_id app.entity_id,
  strokes smallint,
  putts smallint,
  fairway_hit boolean,
  green_in_regulation boolean,
  sand_save boolean,
  hole_comment text,
  changed_at app.utc_instant
)
language sql
security definer
set search_path = ''
as $$
  select * from public.set_round_participant_hole_score(
    p_actor_user_id,
    p_participant_id,
    p_hole_number::smallint,
    p_changed_fields,
    p_expected_version,
    p_device_operation_id,
    p_source,
    p_reason,
    p_client_changed_at,
    p_correlation_id,
    p_operation_id
  );
$$;
revoke all on function public.set_round_participant_hole_score(uuid, uuid, integer, jsonb, bigint, uuid, text, text, app.utc_instant, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.set_round_participant_hole_score(uuid, uuid, integer, jsonb, bigint, uuid, text, text, app.utc_instant, uuid, uuid)
to service_role;

create function public.read_round_hole_scorecard(
  p_actor_user_id uuid,
  p_round_id uuid
)
returns table (
  round_id app.entity_id,
  group_id app.entity_id,
  participant_id app.entity_id,
  participant_kind public.round_participant_kind,
  membership_id app.entity_id,
  first_name text,
  last_name text,
  hole_number smallint,
  version bigint,
  strokes smallint,
  putts smallint,
  fairway_hit boolean,
  green_in_regulation boolean,
  sand_save boolean,
  hole_comment text,
  updated_at app.utc_instant,
  can_edit boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_group_id uuid;
  actor_membership_id uuid;
  actor_role public.membership_role;
  target_round public.rounds%rowtype;
begin
  select actor.group_id, actor.membership_id, actor.actor_role
  into actor_group_id, actor_membership_id, actor_role
  from app.resolve_score_actor(p_actor_user_id) as actor limit 1;
  if actor_group_id is null then raise exception 'actor_not_authorized' using errcode = 'P0003'; end if;
  select round_record.* into target_round from public.rounds as round_record
  where round_record.id = p_round_id and round_record.group_id = actor_group_id;
  if not found then raise exception 'round_not_found' using errcode = 'P0002'; end if;
  if target_round.state not in ('published', 'live', 'completed') then
    raise exception 'round_scorecard_unavailable' using errcode = 'P0001';
  end if;
  return query
  select scorecard.round_id, scorecard.group_id, scorecard.participant_id,
    participant.participant_kind, participant.membership_id,
    coalesce(participant.guest_first_name, golfer.first_name, profile.first_name),
    coalesce(participant.guest_last_name, golfer.last_name, profile.last_name),
    scorecard.hole_number, scorecard.version, scorecard.strokes, scorecard.putts,
    scorecard.fairway_hit, scorecard.green_in_regulation, scorecard.sand_save,
    scorecard.hole_comment, scorecard.updated_at,
    (target_round.state = 'live' and participant.rsvp_status = 'playing' and
      (actor_role in ('coordinator','administrator') or participant.membership_id = actor_membership_id
       or participant.sponsor_membership_id = actor_membership_id))
  from public.participant_hole_scores as scorecard
  join public.round_participants as participant
    on participant.id = scorecard.participant_id and participant.group_id = scorecard.group_id
  left join public.membership_golfer_profiles as golfer
    on golfer.membership_id = participant.membership_id and golfer.group_id = participant.group_id
  left join public.user_profiles as profile
    on profile.user_id = (select membership.user_id from public.memberships as membership
      where membership.id = participant.membership_id and membership.group_id = participant.group_id)
  where scorecard.round_id = target_round.id and scorecard.group_id = actor_group_id
    and (actor_role in ('coordinator','administrator')
      or participant.membership_id = actor_membership_id
      or participant.sponsor_membership_id = actor_membership_id)
  order by scorecard.participant_id, scorecard.hole_number;
end;
$$;

comment on function public.read_round_hole_scorecard(uuid,uuid) is
  'Returns authorized participant hole rows for the portal service. Members receive their own round rows; coordinators and administrators receive the group round rows.';
revoke all on function public.read_round_hole_scorecard(uuid,uuid)
from public, anon, authenticated;
grant execute on function public.read_round_hole_scorecard(uuid,uuid) to service_role;

create function public.read_mobile_round_hole_scorecard(p_round_id uuid)
returns table (
  round_id app.entity_id, group_id app.entity_id, participant_id app.entity_id,
  participant_kind public.round_participant_kind, membership_id app.entity_id,
  first_name text, last_name text, hole_number smallint, version bigint,
  strokes smallint, putts smallint, fairway_hit boolean,
  green_in_regulation boolean, sand_save boolean, hole_comment text,
  updated_at app.utc_instant, can_edit boolean
)
language sql stable security definer set search_path = ''
as $$ select * from public.read_round_hole_scorecard((select auth.uid()), p_round_id); $$;
revoke all on function public.read_mobile_round_hole_scorecard(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.read_mobile_round_hole_scorecard(uuid) to authenticated;

create function public.set_mobile_round_participant_hole_score(
  p_participant_id uuid, p_hole_number smallint, p_changed_fields jsonb,
  p_expected_version bigint, p_device_operation_id uuid, p_reason text,
  p_client_changed_at app.utc_instant, p_correlation_id uuid, p_operation_id uuid
)
returns table (
  participant_id app.entity_id, round_id app.entity_id, group_id app.entity_id,
  hole_number smallint, version bigint, revision_id app.entity_id,
  strokes smallint, putts smallint, fairway_hit boolean,
  green_in_regulation boolean, sand_save boolean, hole_comment text,
  changed_at app.utc_instant
)
language sql security definer set search_path = ''
as $$ select * from public.set_round_participant_hole_score(
  (select auth.uid()), p_participant_id, p_hole_number, p_changed_fields,
  p_expected_version, p_device_operation_id, 'mobile', p_reason,
  p_client_changed_at, p_correlation_id, p_operation_id
); $$;
revoke all on function public.set_mobile_round_participant_hole_score(
  uuid,smallint,jsonb,bigint,uuid,text,app.utc_instant,uuid,uuid
) from public, anon, authenticated, service_role;
grant execute on function public.set_mobile_round_participant_hole_score(
  uuid,smallint,jsonb,bigint,uuid,text,app.utc_instant,uuid,uuid
) to authenticated;

create function public.read_personal_golf_stats(p_actor_user_id uuid)
returns table (
  rounds_tracked bigint,
  holes_with_strokes bigint,
  strokes_total bigint,
  average_strokes numeric,
  holes_with_putts bigint,
  putts_total bigint,
  average_putts numeric,
  fairways_hit bigint,
  fairways_attempted bigint,
  greens_hit bigint,
  greens_attempted bigint,
  sand_saves bigint,
  sand_attempted bigint
)
language plpgsql stable security definer set search_path = ''
as $$
declare actor_group_id uuid; actor_membership_id uuid;
begin
  select actor.group_id, actor.membership_id
  into actor_group_id, actor_membership_id
  from app.resolve_score_actor(p_actor_user_id) as actor limit 1;
  if actor_group_id is null then raise exception 'actor_not_authorized' using errcode = 'P0003'; end if;
  return query
  select count(distinct scorecard.round_id), count(*) filter (where scorecard.strokes is not null),
    coalesce(sum(scorecard.strokes)::bigint, 0), round(avg(scorecard.strokes) filter (where scorecard.strokes is not null), 2),
    count(*) filter (where scorecard.putts is not null), coalesce(sum(scorecard.putts)::bigint, 0),
    round(avg(scorecard.putts) filter (where scorecard.putts is not null), 2),
    count(*) filter (where scorecard.fairway_hit is true), count(*) filter (where scorecard.fairway_hit is not null),
    count(*) filter (where scorecard.green_in_regulation is true), count(*) filter (where scorecard.green_in_regulation is not null),
    count(*) filter (where scorecard.sand_save is true), count(*) filter (where scorecard.sand_save is not null)
  from public.participant_hole_scores as scorecard
  join public.rounds as round_record on round_record.id = scorecard.round_id and round_record.group_id = scorecard.group_id
  join public.round_participants as participant on participant.id = scorecard.participant_id and participant.group_id = scorecard.group_id
  where scorecard.group_id = actor_group_id and participant.membership_id = actor_membership_id
    and round_record.state in ('live', 'completed');
end;
$$;
revoke all on function public.read_personal_golf_stats(uuid) from public, anon, authenticated;
grant execute on function public.read_personal_golf_stats(uuid) to service_role;

create function public.read_mobile_personal_golf_stats()
returns table (
  rounds_tracked bigint, holes_with_strokes bigint, strokes_total bigint,
  average_strokes numeric, holes_with_putts bigint, putts_total bigint,
  average_putts numeric, fairways_hit bigint, fairways_attempted bigint,
  greens_hit bigint, greens_attempted bigint, sand_saves bigint, sand_attempted bigint
)
language sql stable security definer set search_path = ''
as $$ select * from public.read_personal_golf_stats((select auth.uid())); $$;
revoke all on function public.read_mobile_personal_golf_stats() from public, anon, authenticated, service_role;
grant execute on function public.read_mobile_personal_golf_stats() to authenticated;
