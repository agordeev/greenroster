-- Public/kiosk scoreboard access is a narrow, read-only projection over the
-- authoritative live score projection. Raw access tokens are never persisted.

create type public.scoreboard_access_state as enum ('active', 'revoked');

create table public.scoreboard_access_grants (
  id app.entity_id primary key,
  group_id app.entity_id not null,
  round_id app.entity_id not null,
  token_digest_sha256 text not null,
  token_key_version integer not null default 1,
  state public.scoreboard_access_state not null default 'active',
  expires_at app.utc_instant not null,
  created_by_user_id app.entity_id not null references auth.users (id) on delete restrict,
  created_at app.utc_instant not null default pg_catalog.now(),
  revoked_by_user_id app.entity_id references auth.users (id) on delete restrict,
  revoked_at app.utc_instant,
  revoke_reason text,
  correlation_id uuid not null,
  operation_id uuid not null,
  request_fingerprint text not null,
  constraint scoreboard_access_grants_id_group_unique unique (id, group_id),
  constraint scoreboard_access_grants_round_group_fk
    foreign key (round_id, group_id)
    references public.rounds (id, group_id)
    on delete restrict,
  constraint scoreboard_access_grants_token_digest_unique unique (token_digest_sha256),
  constraint scoreboard_access_grants_token_digest_valid
    check (token_digest_sha256 ~ '^[0-9a-f]{64}$'),
  constraint scoreboard_access_grants_token_key_version_positive
    check (token_key_version > 0),
  constraint scoreboard_access_grants_revoke_consistent check (
    (state = 'active' and revoked_by_user_id is null and revoked_at is null and revoke_reason is null)
    or (
      state = 'revoked'
      and revoked_by_user_id is not null
      and revoked_at is not null
      and revoke_reason is not null
      and pg_catalog.btrim(revoke_reason) = revoke_reason
      and pg_catalog.length(revoke_reason) between 1 and 500
    )
  ),
  constraint scoreboard_access_grants_fingerprint_valid
    check (request_fingerprint ~ '^[0-9a-f]{64}$')
);

comment on table public.scoreboard_access_grants is
  'Revocable, expiring, unguessable read-only grant for one live round scoreboard. Raw tokens are returned only by the trusted server and never stored.';
comment on column public.scoreboard_access_grants.token_digest_sha256 is
  'Lower-case SHA-256 hex digest of the raw base64url token presented by the scoreboard URL.';

create index scoreboard_access_grants_group_state_idx
  on public.scoreboard_access_grants (group_id, state, expires_at desc);
create index scoreboard_access_grants_round_state_idx
  on public.scoreboard_access_grants (round_id, state, expires_at desc);
create unique index scoreboard_access_grants_creator_operation_idx
  on public.scoreboard_access_grants (created_by_user_id, operation_id);

create trigger scoreboard_access_grants_immutable_id
before update of id on public.scoreboard_access_grants
for each row execute function app.reject_id_change('id');
create trigger scoreboard_access_grants_immutable_group
before update of group_id on public.scoreboard_access_grants
for each row execute function app.reject_id_change('group_id');
create trigger scoreboard_access_grants_immutable_round
before update of round_id on public.scoreboard_access_grants
for each row execute function app.reject_id_change('round_id');
create trigger scoreboard_access_grants_immutable_token
before update of token_digest_sha256 on public.scoreboard_access_grants
for each row execute function app.reject_id_change('token_digest_sha256');
create trigger scoreboard_access_grants_immutable_token_key_version
before update of token_key_version on public.scoreboard_access_grants
for each row execute function app.reject_id_change('token_key_version');
create trigger scoreboard_access_grants_immutable_creator
before update of created_by_user_id on public.scoreboard_access_grants
for each row execute function app.reject_id_change('created_by_user_id');
create trigger scoreboard_access_grants_immutable_operation
before update of operation_id on public.scoreboard_access_grants
for each row execute function app.reject_id_change('operation_id');

alter table public.scoreboard_access_grants enable row level security;
alter table public.scoreboard_access_grants force row level security;
revoke all on table public.scoreboard_access_grants from public, anon, authenticated, service_role;

create function public.create_scoreboard_access(
  p_actor_user_id uuid,
  p_access_id uuid,
  p_round_id uuid,
  p_token_digest text,
  p_token_key_version integer,
  p_expires_at timestamptz,
  p_correlation_id uuid,
  p_operation_id uuid
)
returns table (
  access_id uuid,
  group_id uuid,
  round_id uuid,
  state public.scoreboard_access_state,
  expires_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_group_id uuid;
  actor_role public.membership_role;
  target_round public.rounds%rowtype;
  existing_grant public.scoreboard_access_grants%rowtype;
  normalized_digest text;
  request_fingerprint text;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_actor_user_id is null
    or p_access_id is null
    or p_round_id is null
    or p_correlation_id is null
    or p_operation_id is null
  then
    raise exception 'operation_context_required' using errcode = '22004';
  end if;

  normalized_digest := pg_catalog.lower(pg_catalog.btrim(p_token_digest));
  if normalized_digest is null or normalized_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'scoreboard_token_digest_invalid' using errcode = '22023';
  end if;
  if p_token_key_version is null or p_token_key_version <= 0 then
    raise exception 'scoreboard_token_key_version_invalid' using errcode = '22023';
  end if;
  if p_expires_at is null or p_expires_at <= v_now then
    raise exception 'scoreboard_expiry_invalid' using errcode = '22023';
  end if;

  select actor.group_id, actor.actor_role
  into actor_group_id, actor_role
  from app.resolve_member_management_actor(p_actor_user_id) as actor
  limit 1;
  if actor_group_id is null or actor_role not in ('coordinator', 'administrator') then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;
  if exists (
    select 1
    from auth.users as identity
    where identity.id = p_actor_user_id
      and coalesce(identity.raw_app_meta_data, '{}'::jsonb)
        ? 'greenroster_password_recovery'
  ) then
    raise exception 'recovery_session_forbidden' using errcode = 'P0003';
  end if;

  request_fingerprint := app.member_request_fingerprint(
    pg_catalog.jsonb_build_object(
      'access_id', p_access_id,
      'round_id', p_round_id,
      'token_digest', normalized_digest,
      'token_key_version', p_token_key_version,
      'expires_at', p_expires_at
    ),
    'scoreboard.access.create'
  );

  select grant_record.*
  into existing_grant
  from public.scoreboard_access_grants as grant_record
  where grant_record.created_by_user_id = p_actor_user_id
    and grant_record.operation_id = p_operation_id
  for update;
  if found then
    if existing_grant.request_fingerprint <> request_fingerprint then
      raise exception 'operation_reused' using errcode = '40001';
    end if;
    return query select
      existing_grant.id,
      existing_grant.group_id,
      existing_grant.round_id,
      existing_grant.state,
      existing_grant.expires_at,
      existing_grant.created_at;
    return;
  end if;

  select round_record.*
  into target_round
  from public.rounds as round_record
  where round_record.id = p_round_id
    and round_record.group_id = actor_group_id
  for update;
  if not found or target_round.state <> 'live' then
    raise exception 'scoreboard_round_unavailable' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.scoreboard_access_grants as grant_record
    where grant_record.id = p_access_id
  ) then
    raise exception 'scoreboard_access_id_in_use' using errcode = '23505';
  end if;

  insert into public.scoreboard_access_grants (
    id,
    group_id,
    round_id,
    token_digest_sha256,
    token_key_version,
    state,
    expires_at,
    created_by_user_id,
    correlation_id,
    operation_id,
    request_fingerprint
  ) values (
    p_access_id,
    actor_group_id,
    target_round.id,
    normalized_digest,
    p_token_key_version,
    'active',
    p_expires_at,
    p_actor_user_id,
    p_correlation_id,
    p_operation_id,
    request_fingerprint
  ) returning * into existing_grant;

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
  ) values (
    actor_group_id,
    p_actor_user_id,
    'scoreboard_access.created',
    'scoreboard_access',
    existing_grant.id,
    1,
    null,
    pg_catalog.jsonb_build_object(
      'state', existing_grant.state,
      'round_id', existing_grant.round_id,
      'expires_at', existing_grant.expires_at
    ),
    'portal',
    p_correlation_id,
    p_operation_id
  );

  return query select
    existing_grant.id,
    existing_grant.group_id,
    existing_grant.round_id,
    existing_grant.state,
    existing_grant.expires_at,
    existing_grant.created_at;
end;
$$;

comment on function public.create_scoreboard_access(uuid, uuid, uuid, text, integer, timestamptz, uuid, uuid) is
  'Service-only coordinator/administrator issuance of one expiring scoreboard grant. The caller stores only a token digest; the raw token is never written by this function.';
revoke all on function public.create_scoreboard_access(uuid, uuid, uuid, text, integer, timestamptz, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.create_scoreboard_access(uuid, uuid, uuid, text, integer, timestamptz, uuid, uuid)
to service_role;

create function public.revoke_scoreboard_access(
  p_actor_user_id uuid,
  p_access_id uuid,
  p_reason text,
  p_correlation_id uuid,
  p_operation_id uuid
)
returns table (
  access_id uuid,
  group_id uuid,
  round_id uuid,
  state public.scoreboard_access_state,
  expires_at timestamptz,
  revoked_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_group_id uuid;
  actor_role public.membership_role;
  target_grant public.scoreboard_access_grants%rowtype;
  prior_event public.audit_events%rowtype;
  normalized_reason text;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_actor_user_id is null
    or p_access_id is null
    or p_correlation_id is null
    or p_operation_id is null
  then
    raise exception 'operation_context_required' using errcode = '22004';
  end if;

  normalized_reason := nullif(pg_catalog.btrim(p_reason), '');
  if normalized_reason is null or pg_catalog.length(normalized_reason) > 500 then
    raise exception 'scoreboard_revoke_reason_invalid' using errcode = '22023';
  end if;

  select actor.group_id, actor.actor_role
  into actor_group_id, actor_role
  from app.resolve_member_management_actor(p_actor_user_id) as actor
  limit 1;
  if actor_group_id is null or actor_role not in ('coordinator', 'administrator') then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;
  if exists (
    select 1
    from auth.users as identity
    where identity.id = p_actor_user_id
      and coalesce(identity.raw_app_meta_data, '{}'::jsonb)
        ? 'greenroster_password_recovery'
  ) then
    raise exception 'recovery_session_forbidden' using errcode = 'P0003';
  end if;

  select grant_record.*
  into target_grant
  from public.scoreboard_access_grants as grant_record
  where grant_record.id = p_access_id
    and grant_record.group_id = actor_group_id
  for update;
  if not found then
    raise exception 'scoreboard_access_not_found' using errcode = 'P0002';
  end if;

  select event.*
  into prior_event
  from public.audit_events as event
  where event.actor_user_id = p_actor_user_id
    and event.action = 'scoreboard_access.revoked'
    and event.operation_id = p_operation_id
  limit 1;
  if found then
    if prior_event.target_id is distinct from p_access_id then
      raise exception 'operation_reused' using errcode = '40001';
    end if;
    return query select
      target_grant.id,
      target_grant.group_id,
      target_grant.round_id,
      target_grant.state,
      target_grant.expires_at,
      target_grant.revoked_at;
    return;
  end if;

  if target_grant.state = 'active' then
    update public.scoreboard_access_grants
    set state = 'revoked',
        revoked_by_user_id = p_actor_user_id,
        revoked_at = v_now,
        revoke_reason = normalized_reason
    where id = target_grant.id;
    select grant_record.*
    into target_grant
    from public.scoreboard_access_grants as grant_record
    where grant_record.id = p_access_id;
  end if;

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
    operation_id,
    reason
  ) values (
    actor_group_id,
    p_actor_user_id,
    'scoreboard_access.revoked',
    'scoreboard_access',
    target_grant.id,
    1,
    pg_catalog.jsonb_build_object('state', 'active'),
    pg_catalog.jsonb_build_object(
      'state', target_grant.state,
      'round_id', target_grant.round_id,
      'revoked_at', target_grant.revoked_at
    ),
    'portal',
    p_correlation_id,
    p_operation_id,
    normalized_reason
  );

  return query select
    target_grant.id,
    target_grant.group_id,
    target_grant.round_id,
    target_grant.state,
    target_grant.expires_at,
    target_grant.revoked_at;
end;
$$;

comment on function public.revoke_scoreboard_access(uuid, uuid, text, uuid, uuid) is
  'Service-only coordinator/administrator revocation. Public reads stop as soon as this transaction commits.';
revoke all on function public.revoke_scoreboard_access(uuid, uuid, text, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.revoke_scoreboard_access(uuid, uuid, text, uuid, uuid)
to service_role;

create function public.read_public_scoreboard(p_token text)
returns table (
  round_id uuid,
  group_name text,
  round_description text,
  round_state text,
  round_format text,
  scheduled_at timestamptz,
  group_time_zone text,
  round_version bigint,
  last_server_update_at timestamptz,
  participant_id uuid,
  participant_kind text,
  player_name text,
  score_version bigint,
  score_changed_at timestamptz,
  gross_score numeric,
  net_score numeric,
  golf_points numeric,
  plus_minus numeric,
  ranking_value numeric,
  competition_rank bigint
)
language sql
stable
security definer
set search_path = ''
as $$
with authorized_grant as (
  select
    grant_record.round_id,
    grant_record.group_id
  from public.scoreboard_access_grants as grant_record
  where p_token is not null
    and p_token ~ '^[A-Za-z0-9_-]{43,128}$'
    and grant_record.token_digest_sha256 = pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(p_token, 'UTF8'), 'sha256'),
      'hex'
    )
    and grant_record.state = 'active'
    and grant_record.expires_at > pg_catalog.statement_timestamp()
),
round_context as (
  select
    round_record.id as round_id,
    group_record.name as group_name,
    round_record.group_id,
    round_record.description as round_description,
    round_record.state::text as round_state,
    round_record.format::text as round_format,
    round_record.scheduled_at,
    round_record.group_time_zone::text as group_time_zone,
    round_record.version as round_version
  from authorized_grant
  join public.rounds as round_record
    on round_record.id = authorized_grant.round_id
   and round_record.group_id = authorized_grant.group_id
  join public.groups as group_record
    on group_record.id = round_record.group_id
  where round_record.state = 'live'
),
players as (
  select
    context.round_id,
    context.group_name,
    context.round_description,
    context.round_state,
    context.round_format,
    context.scheduled_at,
    context.group_time_zone,
    context.round_version,
    participant.id as participant_id,
    participant.participant_kind::text as participant_kind,
    coalesce(
      participant.guest_first_name,
      golfer.first_name,
      profile.first_name,
      'Player'
    ) || case
      when coalesce(participant.guest_last_name, golfer.last_name, profile.last_name) is null
        then ''
      else ' ' || coalesce(participant.guest_last_name, golfer.last_name, profile.last_name)
    end as player_name,
    coalesce(projection.version, 0::bigint) as score_version,
    projection.updated_at as score_changed_at,
    projection.gross_score::numeric as gross_score,
    projection.net_score::numeric as net_score,
    projection.golf_points::numeric as golf_points,
    projection.plus_minus::numeric as plus_minus,
    projection.ranking_value::numeric as ranking_value,
    case
      when projection.ranking_value is null then null::bigint
      else rank() over (
        partition by context.round_id
        order by projection.ranking_value desc nulls last
      )
    end as competition_rank
  from round_context as context
  left join public.round_participants as participant
    on participant.round_id = context.round_id
   and participant.group_id = context.group_id
   and participant.rsvp_status = 'playing'
  left join public.membership_golfer_profiles as golfer
    on golfer.membership_id = participant.membership_id
   and golfer.group_id = participant.group_id
  left join public.user_profiles as profile
    on profile.user_id = (
      select membership.user_id
      from public.memberships as membership
      where membership.id = participant.membership_id
        and membership.group_id = participant.group_id
    )
  left join public.participant_score_projections as projection
    on projection.participant_id = participant.id
   and projection.group_id = participant.group_id
   and projection.round_id = participant.round_id
),
updates as (
  select
    players.*,
    max(players.score_changed_at) over (partition by players.round_id) as last_server_update_at
  from players
)
select
  updates.round_id,
  updates.group_name,
  updates.round_description,
  updates.round_state,
  updates.round_format,
  updates.scheduled_at,
  updates.group_time_zone,
  updates.round_version,
  updates.last_server_update_at,
  updates.participant_id,
  updates.participant_kind,
  updates.player_name,
  updates.score_version,
  updates.score_changed_at,
  updates.gross_score,
  updates.net_score,
  updates.golf_points,
  updates.plus_minus,
  updates.ranking_value,
  updates.competition_rank
from updates
order by
  updates.competition_rank nulls last,
  pg_catalog.lower(updates.player_name),
  updates.participant_id;
$$;

comment on function public.read_public_scoreboard(text) is
  'Anonymous token-authenticated read. Returns only group/round identity and public player score fields from a live authoritative projection; contacts, roles, membership IDs, quotas, and administration fields are excluded.';
revoke all on function public.read_public_scoreboard(text)
from public, anon, authenticated, service_role;
grant execute on function public.read_public_scoreboard(text)
to anon, authenticated, service_role;
