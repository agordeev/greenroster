-- Phase 03: atomic publication, member participants, and the publication e-mail outbox.
--
-- Drafts stay private.  Publication is the business write boundary: it
-- resolves the tenant from the verified coordinator or administrator,
-- snapshots all mutable inputs, creates No response member participants,
-- queues e-mail, writes audit, and advances the round state in one
-- transaction.  The final claim RPC is a separate service-only delivery
-- lease boundary and never mutates round business state.

create type public.round_rsvp_status as enum (
  'no_response',
  'playing',
  'not_playing'
);

create table public.round_rule_snapshots (
  round_id app.entity_id primary key references public.rounds (id) on delete restrict,
  group_id app.entity_id not null references public.groups (id) on delete restrict,
  format public.round_format not null,
  quota_method public.quota_method,
  moving_average_history_length smallint,
  quota_precision smallint,
  quota_rounding_rule public.quota_rounding_rule,
  adjustment_bands jsonb not null default '[]'::jsonb,
  settings_version bigint not null default 0,
  created_at app.utc_instant not null default pg_catalog.now(),
  constraint round_rule_snapshots_id_group_unique unique (round_id, group_id),
  constraint round_rule_snapshots_round_group_fk
    foreign key (round_id, group_id)
    references public.rounds (id, group_id)
    on delete restrict,
  constraint round_rule_snapshots_settings_consistent check (
    (settings_version = 0 and quota_method is null and moving_average_history_length is null
      and quota_precision is null and quota_rounding_rule is null and adjustment_bands = '[]'::jsonb)
    or (settings_version > 0 and quota_method is not null and quota_precision between 0 and 2
      and quota_rounding_rule is not null
      and pg_catalog.jsonb_typeof(adjustment_bands) = 'array'
      and ((quota_method = 'moving_average' and moving_average_history_length between 4 and 20)
        or (quota_method <> 'moving_average' and moving_average_history_length is null)))
  )
);

comment on table public.round_rule_snapshots is
  'Immutable values used by one published round; later group-settings edits cannot change history.';

create function app.reject_round_rule_snapshot_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'round_rule_snapshot_immutable' using errcode = 'P0001';
end;
$$;

revoke all on function app.reject_round_rule_snapshot_mutation() from public, anon, authenticated;

create trigger round_rule_snapshots_append_only
before update or delete on public.round_rule_snapshots
for each row execute function app.reject_round_rule_snapshot_mutation();

create table public.round_participants (
  id app.entity_id primary key default extensions.gen_random_uuid(),
  round_id app.entity_id not null,
  group_id app.entity_id not null,
  membership_id app.entity_id not null,
  rsvp_status public.round_rsvp_status not null default 'no_response',
  quota_snapshot app.quota_value,
  quota_snapshot_source jsonb,
  handicap_snapshot app.handicap_value,
  handicap_snapshot_source public.member_handicap_source,
  handicap_snapshot_as_of date,
  tee_snapshot text,
  created_at app.utc_instant not null default pg_catalog.now(),
  updated_at app.utc_instant not null default pg_catalog.now(),
  constraint round_participants_id_group_unique unique (id, group_id),
  constraint round_participants_round_membership_unique unique (round_id, membership_id),
  constraint round_participants_round_group_fk
    foreign key (round_id, group_id)
    references public.rounds (id, group_id)
    on delete restrict,
  constraint round_participants_membership_group_fk
    foreign key (membership_id, group_id)
    references public.memberships (id, group_id)
    on delete restrict,
  constraint round_participants_quota_source_object check (
    quota_snapshot_source is null or pg_catalog.jsonb_typeof(quota_snapshot_source) = 'object'
  ),
  constraint round_participants_handicap_source_consistent check (
    (handicap_snapshot is null and handicap_snapshot_source is null and handicap_snapshot_as_of is null)
    or (handicap_snapshot is not null and handicap_snapshot_source is not null and handicap_snapshot_as_of is not null)
  ),
  constraint round_participants_tee_valid check (
    tee_snapshot is null or tee_snapshot in ('pro', 'back', 'middle', 'front')
  )
);

comment on table public.round_participants is
  'Member-only participant rows created at publication. Quota, handicap, and tee values are immutable snapshots.';

create index round_participants_group_round_idx
  on public.round_participants (group_id, round_id, rsvp_status);

create trigger round_participants_immutable_id
before update of id on public.round_participants
for each row execute function app.reject_id_change('id');

create trigger round_participants_immutable_group
before update of group_id on public.round_participants
for each row execute function app.reject_id_change('group_id');

create function app.reject_round_participant_snapshot_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'round_participant_snapshot_immutable' using errcode = 'P0001';
end;
$$;

revoke all on function app.reject_round_participant_snapshot_mutation() from public, anon, authenticated;

create trigger round_participants_snapshot_immutable
before update of round_id, group_id, membership_id, quota_snapshot,
  quota_snapshot_source, handicap_snapshot, handicap_snapshot_source,
  handicap_snapshot_as_of, tee_snapshot on public.round_participants
for each row execute function app.reject_round_participant_snapshot_mutation();

create trigger round_participants_set_updated_at
before update on public.round_participants
for each row execute function app.set_updated_at();

alter table public.round_rule_snapshots enable row level security;
alter table public.round_rule_snapshots force row level security;
alter table public.round_participants enable row level security;
alter table public.round_participants force row level security;

revoke all on table public.round_rule_snapshots, public.round_participants
from public, anon, authenticated, service_role;

-- The review token is deliberately derived by the database from every mutable
-- value that publication consumes.  It is returned to the trusted server, not
-- persisted as a client-authored value.  The round version is the cheap review
-- version; the fingerprint covers the roster, quota projection/settings,
-- handicap, identity readiness, and the explicit exclusions.
create function app.round_publication_review_state(
  p_round_id uuid,
  p_group_id uuid,
  p_excluded_membership_ids uuid[] default '{}'
)
returns table (
  review_version bigint,
  review_fingerprint text
)
language sql
stable
security definer
set search_path = ''
as $$
with excluded as (
  select distinct value as membership_id
  from pg_catalog.unnest(coalesce(p_excluded_membership_ids, '{}'::uuid[])) as value
), quota_settings as (
  select
    settings.group_id,
    settings.method,
    settings.moving_average_history_length,
    settings.precision,
    settings.rounding_rule,
    settings.version,
    coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'position', band.position,
            'lower_bound', band.lower_bound,
            'lower_inclusive', band.lower_inclusive,
            'upper_bound', band.upper_bound,
            'upper_inclusive', band.upper_inclusive,
            'adjustment', band.adjustment
          ) order by band.position
        )
        from public.quota_adjustment_bands as band
        where band.group_id = settings.group_id
      ),
      '[]'::jsonb
    ) as adjustment_bands
  from public.group_quota_settings as settings
  where settings.group_id = p_group_id
), latest_handicap as (
  select distinct on (record.membership_id)
    record.membership_id,
    record.id,
    record.handicap,
    record.source,
    record.as_of
  from public.membership_handicap_records as record
  where record.group_id = p_group_id
  order by record.membership_id, record.as_of desc, record.created_at desc, record.id desc
), member_rows as (
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'membership_id', membership.id,
        'user_id', membership.user_id,
        'status', membership.status,
        'role', membership.role,
        'dues_paid', membership.dues_paid,
        'initial_quota', membership.initial_quota,
        'uses_initial_quota', membership.uses_initial_quota,
        'initial_quota_provenance', membership.initial_quota_provenance,
        'membership_updated_at', membership.updated_at,
        'profile_id', profile.id,
        'profile_version', profile.version,
        'first_name', profile.first_name,
        'last_name', profile.last_name,
        'tee_location', profile.tee_location,
        'profile_updated_at', profile.updated_at,
        'identity_email', identity.email,
        'identity_email_confirmed_at', identity.email_confirmed_at,
        'identity_deleted_at', identity.deleted_at,
        'identity_is_anonymous', identity.is_anonymous,
        'identity_banned_until', identity.banned_until,
        'identity_currently_banned', (
          identity.banned_until is not null
          and identity.banned_until > pg_catalog.statement_timestamp()
        ),
        'user_profile_disabled_at', user_profile.disabled_at,
        'projection_version', projection.projection_version,
        'projection_settings_version', projection.settings_version,
        'projection_ready', projection.projection_ready,
        'projected_quota', projection.projected_quota,
        'projection_source', projection.projection_source,
        'projection_effective_at', projection.effective_at,
        'handicap_id', latest_handicap.id,
        'handicap', latest_handicap.handicap,
        'handicap_source', latest_handicap.source,
        'handicap_as_of', latest_handicap.as_of,
        'excluded', excluded.membership_id is not null
      ) order by membership.id
    ),
    '[]'::jsonb
  ) as rows
  from public.memberships as membership
  left join public.membership_golfer_profiles as profile
    on profile.membership_id = membership.id and profile.group_id = membership.group_id
  left join public.user_profiles as user_profile
    on user_profile.user_id = membership.user_id
  left join auth.users as identity on identity.id = membership.user_id
  left join public.membership_quota_projections as projection
    on projection.membership_id = membership.id and projection.group_id = membership.group_id
  left join latest_handicap on latest_handicap.membership_id = membership.id
  left join excluded on excluded.membership_id = membership.id
  where membership.group_id = p_group_id
    and membership.status = 'active'
)
select
  round_record.version,
  app.member_request_fingerprint(
    pg_catalog.jsonb_build_object(
      'round', pg_catalog.jsonb_build_object(
        'id', round_record.id,
        'group_id', round_record.group_id,
        'description', round_record.description,
        'scheduled_at', round_record.scheduled_at,
        'group_time_zone', round_record.group_time_zone,
        'venue', round_record.venue,
        'round_url', round_record.round_url,
        'notes', round_record.notes,
        'notes_visible_to_players', round_record.notes_visible_to_players,
        'rsvp_deadline_at', round_record.rsvp_deadline_at,
        'format', round_record.format,
        'state', round_record.state,
        'version', round_record.version
      ),
      'quota_settings', coalesce(
        (
          select pg_catalog.jsonb_build_object(
            'method', settings.method,
            'moving_average_history_length', settings.moving_average_history_length,
            'precision', settings.precision,
            'rounding_rule', settings.rounding_rule,
            'version', settings.version,
            'adjustment_bands', settings.adjustment_bands
          )
          from quota_settings as settings
        ),
        '{}'::jsonb
      ),
      'excluded_membership_ids', coalesce(
        (
          select pg_catalog.jsonb_agg(excluded.membership_id order by excluded.membership_id)
          from excluded
        ),
        '[]'::jsonb
      ),
      'members', member_rows.rows
    ),
    'round-publication-review:' || round_record.id::text
  )
from public.rounds as round_record
cross join member_rows
where round_record.id = p_round_id
  and round_record.group_id = p_group_id;
$$;

revoke all on function app.round_publication_review_state(uuid, uuid, uuid[])
from public, anon, authenticated, service_role;

create function public.preview_round_publication(
  p_actor_user_id uuid,
  p_round_id uuid,
  p_excluded_membership_ids uuid[] default '{}'
)
returns table (
  round_id app.entity_id,
  group_id app.entity_id,
  format public.round_format,
  review_version bigint,
  review_fingerprint text,
  membership_id app.entity_id,
  first_name text,
  last_name text,
  email_ready boolean,
  eligibility_state text,
  ineligibility_reason text,
  included boolean,
  projection_ready boolean,
  projected_quota app.quota_value,
  quota_snapshot_source jsonb,
  handicap_snapshot app.handicap_value,
  handicap_snapshot_source public.member_handicap_source,
  handicap_snapshot_as_of date,
  tee_snapshot text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_group_id uuid;
  actor_role public.membership_role;
  draft_round public.rounds%rowtype;
  review_state record;
begin
  if p_actor_user_id is null or p_round_id is null then
    raise exception 'publication_context_required' using errcode = '22004';
  end if;

  select actor.group_id, actor.actor_role
  into actor_group_id, actor_role
  from app.resolve_member_management_actor(p_actor_user_id) as actor
  limit 1;
  if actor_group_id is null or actor_role not in ('coordinator', 'administrator') then
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
  into draft_round
  from public.rounds as round_record
  where round_record.id = p_round_id
    and round_record.group_id = actor_group_id;
  if not found then
    raise exception 'round_not_found' using errcode = 'P0002';
  end if;
  if draft_round.state <> 'draft' then
    raise exception 'round_state_locked' using errcode = 'P0001';
  end if;

  select state.review_version, state.review_fingerprint
  into review_state
  from app.round_publication_review_state(
    draft_round.id,
    draft_round.group_id,
    p_excluded_membership_ids
  ) as state;

  return query
  with excluded as (
    select distinct value as membership_id
    from pg_catalog.unnest(coalesce(p_excluded_membership_ids, '{}'::uuid[])) as value
  ), latest_handicap as (
    select distinct on (record.membership_id)
      record.membership_id,
      record.handicap,
      record.source,
      record.as_of
    from public.membership_handicap_records as record
    where record.group_id = actor_group_id
    order by record.membership_id, record.as_of desc, record.created_at desc, record.id desc
  ), quota_settings as (
    select settings.version
    from public.group_quota_settings as settings
    where settings.group_id = actor_group_id
  )
  select
    draft_round.id,
    draft_round.group_id,
    draft_round.format,
    review_state.review_version,
    review_state.review_fingerprint,
    membership.id,
    profile.first_name,
    profile.last_name,
    (
      identity.email is not null
      and identity.email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      and identity.email_confirmed_at is not null
      and identity.deleted_at is null
      and not identity.is_anonymous
      and (identity.banned_until is null or identity.banned_until <= pg_catalog.statement_timestamp())
      and user_profile.disabled_at is null
    ),
    case
      when excluded.membership_id is not null then 'excluded'
      when profile.membership_id is null then 'ineligible'
      when membership.user_id is null
        or identity.email is null
        or identity.email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        or identity.email_confirmed_at is null
        or identity.deleted_at is not null
        or identity.is_anonymous
        or (identity.banned_until is not null and identity.banned_until > pg_catalog.statement_timestamp())
        or user_profile.disabled_at is not null then 'ineligible'
      when draft_round.format is null then 'ineligible'
      when draft_round.format = 'individual_net'
        and not (
          coalesce(projection.projection_ready, false)
          and (select version from quota_settings) is not null
          and projection.settings_version = (select version from quota_settings)
        ) then 'ineligible'
      else 'eligible'
    end,
    case
      when excluded.membership_id is not null then 'explicitly_excluded'
      when profile.membership_id is null then 'profile_missing'
      when membership.user_id is null or identity.email is null
        or identity.email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        or identity.email_confirmed_at is null
        or identity.deleted_at is not null or identity.is_anonymous
        or (identity.banned_until is not null and identity.banned_until > pg_catalog.statement_timestamp())
        or user_profile.disabled_at is not null then 'identity_not_eligible'
      when draft_round.format is null then 'format_required'
      when draft_round.format = 'individual_net'
        and not (
          coalesce(projection.projection_ready, false)
          and (select version from quota_settings) is not null
          and projection.settings_version = (select version from quota_settings)
        ) then 'quota_not_ready'
      else null
    end,
    excluded.membership_id is null
      and profile.membership_id is not null
      and membership.user_id is not null
      and identity.email is not null
      and identity.email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      and identity.email_confirmed_at is not null
      and identity.deleted_at is null
      and not identity.is_anonymous
      and (identity.banned_until is null or identity.banned_until <= pg_catalog.statement_timestamp())
      and user_profile.disabled_at is null
      and draft_round.format is not null
      and (
        draft_round.format <> 'individual_net'
        or (
          coalesce(projection.projection_ready, false)
          and (select version from quota_settings) is not null
          and projection.settings_version = (select version from quota_settings)
        )
      ),
    (
      coalesce(projection.projection_ready, false)
      and (select version from quota_settings) is not null
      and projection.settings_version = (select version from quota_settings)
    ),
    case
      when coalesce(projection.projection_ready, false)
        and (select version from quota_settings) is not null
        and projection.settings_version = (select version from quota_settings)
      then projection.projected_quota::app.quota_value
      else null::app.quota_value
    end,
    case
      when coalesce(projection.projection_ready, false)
        and (select version from quota_settings) is not null
        and projection.settings_version = (select version from quota_settings)
      then projection.projection_source
    end,
    latest_handicap.handicap::app.handicap_value,
    latest_handicap.source,
    latest_handicap.as_of,
    profile.tee_location
  from public.memberships as membership
  left join public.membership_golfer_profiles as profile
    on profile.membership_id = membership.id
   and profile.group_id = membership.group_id
  left join public.user_profiles as user_profile
    on user_profile.user_id = membership.user_id
  left join auth.users as identity on identity.id = membership.user_id
  left join public.membership_quota_projections as projection
    on projection.membership_id = membership.id
   and projection.group_id = membership.group_id
  left join latest_handicap on latest_handicap.membership_id = membership.id
  left join excluded on excluded.membership_id = membership.id
  where membership.group_id = actor_group_id
    and membership.status = 'active'
  order by profile.last_name nulls last, profile.first_name nulls last, membership.id;
end;
$$;

comment on function public.preview_round_publication(uuid, uuid, uuid[]) is
  'Coordinator/admin-only publication review. Active members are classified without mutating the Draft.';

revoke all on function public.preview_round_publication(uuid, uuid, uuid[])
from public, anon, authenticated;
grant execute on function public.preview_round_publication(uuid, uuid, uuid[])
to service_role;

create function public.publish_round(
  p_actor_user_id uuid,
  p_round_id uuid,
  p_excluded_membership_ids uuid[] default '{}',
  p_expected_round_version bigint default null,
  p_review_fingerprint text default null,
  p_correlation_id uuid default null,
  p_operation_id uuid default null
)
returns table (
  round_id app.entity_id,
  group_id app.entity_id,
  state public.round_state,
  version bigint,
  published_at app.utc_instant,
  participant_count bigint,
  notification_count bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_group_id uuid;
  actor_role public.membership_role;
  locked_group public.groups%rowtype;
  locked_round public.rounds%rowtype;
  saved_round public.rounds%rowtype;
  settings public.group_quota_settings%rowtype;
  settings_bands jsonb := '[]'::jsonb;
  prior_event public.audit_events%rowtype;
  current_participant_count bigint;
  current_notification_count bigint;
  normalized_exclusions uuid[];
  request_payload jsonb;
  request_fingerprint text;
  published_at_value timestamptz;
  review_state record;
begin
  if p_actor_user_id is null or p_round_id is null then
    raise exception 'publication_context_required' using errcode = '22004';
  end if;
  if p_correlation_id is null or p_operation_id is null then
    raise exception 'operation_context_required' using errcode = '22004';
  end if;
  if p_expected_round_version is null or p_expected_round_version < 1
    or p_review_fingerprint is null
    or p_review_fingerprint !~ '^[0-9a-f]{64}$'
  then
    raise exception 'publication_review_required' using errcode = '22004';
  end if;

  select actor.group_id, actor.actor_role
  into actor_group_id, actor_role
  from app.resolve_member_management_actor(p_actor_user_id) as actor
  limit 1;
  if actor_group_id is null or actor_role not in ('coordinator', 'administrator') then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;
  if exists (
    select 1 from auth.users as identity
    where identity.id = p_actor_user_id
      and coalesce(identity.raw_app_meta_data, '{}'::jsonb) ? 'greenroster_password_recovery'
  ) then
    raise exception 'recovery_session_forbidden' using errcode = 'P0003';
  end if;

  select group_record.* into locked_group
  from public.groups as group_record
  where group_record.id = actor_group_id
  for update;
  if not found then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;
  select round_record.* into locked_round
  from public.rounds as round_record
  where round_record.id = p_round_id
    and round_record.group_id = locked_group.id
  for update;
  if not found then
    raise exception 'round_not_found' using errcode = 'P0002';
  end if;

  select coalesce(array_agg(value order by value), '{}'::uuid[])
  into normalized_exclusions
  from (
    select distinct value
    from pg_catalog.unnest(coalesce(p_excluded_membership_ids, '{}'::uuid[])) as value
  ) as exclusion_values;
  request_payload := pg_catalog.jsonb_build_object(
    'round_id', p_round_id,
    'excluded_membership_ids', to_jsonb(normalized_exclusions),
    'expected_round_version', p_expected_round_version,
    'review_fingerprint', p_review_fingerprint
  );
  request_fingerprint := app.member_request_fingerprint(
    request_payload,
    p_actor_user_id::text || ':' || p_operation_id::text
  );

  select event.* into prior_event
  from public.audit_events as event
    where event.group_id = locked_group.id
    and event.actor_user_id = p_actor_user_id
    and event.action = 'round.published'
    and event.operation_id = p_operation_id;
  if found then
    if prior_event.target_id is distinct from p_round_id
      or prior_event.after_state ->> 'request_fingerprint' <> request_fingerprint then
      raise exception 'operation_id_reused' using errcode = '23505';
    end if;
    return query select
      p_round_id::app.entity_id,
      locked_group.id::app.entity_id,
      (prior_event.after_state ->> 'state')::public.round_state,
      prior_event.target_version,
      (prior_event.after_state ->> 'published_at')::app.utc_instant,
      (prior_event.after_state ->> 'participant_count')::bigint,
      (prior_event.after_state ->> 'notification_count')::bigint;
    return;
  end if;

  if locked_round.state = 'published' then
    select count(*) into current_participant_count
    from public.round_participants as participant
    where participant.round_id = locked_round.id and participant.group_id = locked_round.group_id;
    select count(*) into current_notification_count
    from public.notification_deliveries as delivery
    join public.notification_outbox_jobs as outbox
      on outbox.id = delivery.outbox_job_id and outbox.group_id = delivery.group_id
    where outbox.aggregate_id = locked_round.id and outbox.group_id = locked_round.group_id
      and outbox.event_type = 'round.published' and delivery.channel = 'email';
    return query select
      locked_round.id,
      locked_round.group_id,
      locked_round.state,
      locked_round.version,
      locked_round.published_at,
      current_participant_count,
      current_notification_count;
    return;
  end if;
  if locked_round.state <> 'draft' then
    raise exception 'round_state_locked' using errcode = 'P0001';
  end if;
  if locked_round.version <> p_expected_round_version then
    raise exception 'publication_review_stale' using errcode = '40001';
  end if;
  if locked_round.description is null or locked_round.scheduled_at is null or locked_round.format is null then
    raise exception 'publication_incomplete' using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(normalized_exclusions) as excluded_membership_id
    where not exists (
      select 1 from public.memberships as membership
      where membership.id = excluded_membership_id
        and membership.group_id = locked_group.id
        and membership.status = 'active'
    )
  ) then
    raise exception 'publication_participant_invalid' using errcode = '22023';
  end if;

  select quota_settings.* into settings
  from public.group_quota_settings as quota_settings
  where quota_settings.group_id = locked_group.id
  for update;
  if locked_round.format = 'individual_net' and not found then
    raise exception 'publication_quota_settings_missing' using errcode = '22023';
  end if;
  if found then
    select coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'position', band.position,
          'lower_bound', band.lower_bound,
          'lower_inclusive', band.lower_inclusive,
          'upper_bound', band.upper_bound,
          'upper_inclusive', band.upper_inclusive,
          'adjustment', band.adjustment
        ) order by band.position
      ),
      '[]'::jsonb
    )
    into settings_bands
    from public.quota_adjustment_bands as band
    where band.group_id = locked_group.id;
  end if;

  -- Serialize all mutable review inputs before comparing the server token.
  -- The existing mutation RPCs use this group/membership boundary as well, so
  -- a projection, handicap, or profile update cannot overtake publication.
  perform membership.id
  from public.memberships as membership
  where membership.group_id = locked_group.id
  for update;
  perform profile.id
  from public.membership_golfer_profiles as profile
  where profile.group_id = locked_group.id
  for update;
  perform projection.membership_id
  from public.membership_quota_projections as projection
  where projection.group_id = locked_group.id
  for update;
  perform record.id
  from public.membership_handicap_records as record
  where record.group_id = locked_group.id
  for update;
  perform user_profile.user_id
  from public.user_profiles as user_profile
  join public.memberships as membership on membership.user_id = user_profile.user_id
  where membership.group_id = locked_group.id
  for update;
  perform identity.id
  from auth.users as identity
  join public.memberships as membership on membership.user_id = identity.id
  where membership.group_id = locked_group.id
  for update;

  select state.review_version, state.review_fingerprint
  into review_state
  from app.round_publication_review_state(
    locked_round.id,
    locked_round.group_id,
    normalized_exclusions
  ) as state;
  if review_state.review_version is distinct from p_expected_round_version
    or review_state.review_fingerprint is distinct from p_review_fingerprint
  then
    raise exception 'publication_review_stale' using errcode = '40001';
  end if;

  if exists (
    select 1
    from public.memberships as membership
    left join public.membership_golfer_profiles as profile
      on profile.membership_id = membership.id and profile.group_id = membership.group_id
    left join public.user_profiles as user_profile
      on user_profile.user_id = membership.user_id
    left join auth.users as identity on identity.id = membership.user_id
    left join public.membership_quota_projections as projection
      on projection.membership_id = membership.id and projection.group_id = membership.group_id
    where membership.group_id = locked_group.id
      and membership.status = 'active'
      and not (membership.id = any(normalized_exclusions))
      and (
        profile.membership_id is null
        or membership.user_id is null
        or identity.email is null
        or identity.email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        or identity.email_confirmed_at is null
        or identity.deleted_at is not null
        or identity.is_anonymous
        or (identity.banned_until is not null and identity.banned_until > pg_catalog.statement_timestamp())
        or user_profile.disabled_at is not null
        or (
          locked_round.format = 'individual_net'
          and not (
            coalesce(projection.projection_ready, false)
            and projection.settings_version = coalesce(settings.version, 0)
          )
        )
      )
  ) then
    if locked_round.format = 'individual_net'
      and exists (
        select 1
        from public.memberships as membership
        left join public.membership_quota_projections as projection
          on projection.membership_id = membership.id and projection.group_id = membership.group_id
        where membership.group_id = locked_group.id
          and membership.status = 'active'
          and not (membership.id = any(normalized_exclusions))
          and not (
            coalesce(projection.projection_ready, false)
            and projection.settings_version = coalesce(settings.version, 0)
          )
      ) then
      raise exception 'publication_quota_not_ready' using errcode = '22023';
    end if;
    raise exception 'publication_participant_ineligible' using errcode = '22023';
  end if;

  insert into public.round_rule_snapshots (
    round_id, group_id, format, quota_method, moving_average_history_length,
    quota_precision, quota_rounding_rule, adjustment_bands, settings_version
  )
  values (
    locked_round.id, locked_round.group_id, locked_round.format,
    settings.method, settings.moving_average_history_length, settings.precision,
    settings.rounding_rule, settings_bands, coalesce(settings.version, 0)
  );

  insert into public.round_participants (
    round_id, group_id, membership_id, rsvp_status, quota_snapshot,
    quota_snapshot_source, handicap_snapshot, handicap_snapshot_source,
    handicap_snapshot_as_of, tee_snapshot
  )
  select
    locked_round.id,
    locked_round.group_id,
    membership.id,
    'no_response',
    case
      when projection.projection_ready
        and projection.settings_version = coalesce(settings.version, 0)
      then projection.projected_quota::app.quota_value
      else null::app.quota_value
    end,
    case
      when projection.projection_ready
        and projection.settings_version = coalesce(settings.version, 0)
      then projection.projection_source
    end,
    latest_handicap.handicap::app.handicap_value,
    latest_handicap.source,
    latest_handicap.as_of,
    profile.tee_location
  from public.memberships as membership
  join public.membership_golfer_profiles as profile
    on profile.membership_id = membership.id and profile.group_id = membership.group_id
  join public.user_profiles as user_profile
    on user_profile.user_id = membership.user_id
  join auth.users as identity on identity.id = membership.user_id
  left join public.membership_quota_projections as projection
    on projection.membership_id = membership.id and projection.group_id = membership.group_id
  left join lateral (
    select record.handicap, record.source, record.as_of
    from public.membership_handicap_records as record
    where record.membership_id = membership.id and record.group_id = membership.group_id
    order by record.as_of desc, record.created_at desc, record.id desc
    limit 1
  ) as latest_handicap on true
  where membership.group_id = locked_group.id
    and membership.status = 'active'
    and not (membership.id = any(normalized_exclusions));

  select count(*) into current_participant_count
  from public.round_participants as participant
  where participant.round_id = locked_round.id and participant.group_id = locked_round.group_id;

  published_at_value := pg_catalog.clock_timestamp();
  update public.rounds as round_record
  set state = 'published',
      published_at = published_at_value,
      version = round_record.version + 1
  where round_record.id = locked_round.id
  returning * into saved_round;

  insert into public.notification_outbox_jobs (
    group_id, event_type, aggregate_type, aggregate_id, aggregate_version,
    idempotency_key
  )
  select
    saved_round.group_id,
    'round.published',
    'round',
    saved_round.id,
    saved_round.version,
    'round.published:' || saved_round.id::text || ':' || participant.membership_id::text
  from public.round_participants as participant
  join public.memberships as membership
    on membership.id = participant.membership_id and membership.group_id = participant.group_id
  join auth.users as identity on identity.id = membership.user_id
  where participant.round_id = saved_round.id
    and participant.group_id = saved_round.group_id;

  insert into public.notification_deliveries (
    group_id, outbox_job_id, recipient_membership_id, recipient_address,
    recipient_address_normalized, channel
  )
  select
    outbox.group_id,
    outbox.id,
    participant.membership_id,
    identity.email::text,
    pg_catalog.lower(pg_catalog.btrim(identity.email)),
    'email'
  from public.notification_outbox_jobs as outbox
  join public.round_participants as participant
    on participant.round_id = outbox.aggregate_id and participant.group_id = outbox.group_id
   and outbox.idempotency_key = 'round.published:' || participant.round_id::text || ':' || participant.membership_id::text
  join public.memberships as membership
    on membership.id = participant.membership_id and membership.group_id = participant.group_id
  join auth.users as identity on identity.id = membership.user_id
  where outbox.aggregate_id = saved_round.id and outbox.group_id = saved_round.group_id
    and outbox.event_type = 'round.published';

  select count(*) into current_notification_count
  from public.notification_deliveries as delivery
  join public.notification_outbox_jobs as outbox
    on outbox.id = delivery.outbox_job_id and outbox.group_id = delivery.group_id
  where outbox.aggregate_id = saved_round.id and outbox.group_id = saved_round.group_id
    and outbox.event_type = 'round.published' and delivery.channel = 'email';

  insert into public.audit_events (
    group_id, actor_user_id, action, target_type, target_id, target_version,
    before_state, after_state, source, correlation_id, operation_id
  )
  values (
    saved_round.group_id, p_actor_user_id, 'round.published', 'round', saved_round.id,
    saved_round.version,
    pg_catalog.jsonb_build_object('state', locked_round.state, 'version', locked_round.version),
    pg_catalog.jsonb_build_object(
      'round_id', saved_round.id,
      'group_id', saved_round.group_id,
      'state', saved_round.state,
      'version', saved_round.version,
      'published_at', saved_round.published_at,
      'participant_count', current_participant_count,
      'notification_count', current_notification_count,
      'request_fingerprint', request_fingerprint
    ),
    'portal', p_correlation_id, p_operation_id
  );

  return query select
    saved_round.id,
    saved_round.group_id,
    saved_round.state,
    saved_round.version,
    saved_round.published_at,
    current_participant_count,
    current_notification_count;
end;
$$;

comment on function public.publish_round(uuid, uuid, uuid[], bigint, text, uuid, uuid) is
  'Atomically validates a server-generated publication review, snapshots a Draft round, creates member No response participants, and queues one e-mail job/delivery per eligible member.';

revoke all on function public.publish_round(uuid, uuid, uuid[], bigint, text, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.publish_round(uuid, uuid, uuid[], bigint, text, uuid, uuid)
to service_role;

create function public.claim_round_published_email(
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
  format public.round_format,
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

  with stale_deliveries as (
    update public.notification_deliveries as delivery
    set state = 'retryable',
        failure_reason = 'claim_expired',
        claim_token = null,
        claimed_at = null,
        next_attempt_at = v_now
    from public.notification_outbox_jobs as outbox
    where delivery.outbox_job_id = outbox.id
      and delivery.group_id = outbox.group_id
      and delivery.channel = 'email'
      and delivery.state = 'sending'
      and delivery.claimed_at <= p_stale_before
      and outbox.event_type = 'round.published'
      and outbox.aggregate_type = 'round'
      and outbox.state = 'processing'
    returning delivery.outbox_job_id, delivery.group_id
  )
  update public.notification_outbox_jobs as outbox
  set state = 'retryable',
      safe_error = 'claim_expired',
      claimed_at = null,
      finished_at = null,
      next_attempt_at = v_now
  from stale_deliveries as stale
  where outbox.id = stale.outbox_job_id
    and outbox.group_id = stale.group_id;

  -- Re-resolve the current active identity and suppression state.  Publication
  -- keeps the address used for its audit/outbox history, while the worker uses
  -- the current verified account address and never sends to a suppressed one.
  with invalid as (
    select
      delivery.id,
      delivery.group_id,
      delivery.outbox_job_id,
      case
        when membership.status <> 'active' then 'member_inactive'
        when identity.email is not null
          and pg_catalog.length(pg_catalog.btrim(identity.email)) between 3 and 320
          and pg_catalog.btrim(identity.email) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
          and exists (
            select 1
            from public.email_suppressions as suppression
            where suppression.normalized_address = pg_catalog.lower(pg_catalog.btrim(identity.email))
          ) then 'email_suppressed'
        else 'member_identity_unavailable'
      end as safe_reason
    from public.notification_deliveries as delivery
    join public.notification_outbox_jobs as outbox
      on outbox.id = delivery.outbox_job_id
     and outbox.group_id = delivery.group_id
    join public.rounds as round_record
      on round_record.id = outbox.aggregate_id
     and round_record.group_id = outbox.group_id
    join public.round_participants as participant
      on participant.round_id = round_record.id
     and participant.group_id = round_record.group_id
     and participant.membership_id = delivery.recipient_membership_id
    join public.memberships as membership
      on membership.id = participant.membership_id
     and membership.group_id = participant.group_id
    left join auth.users as identity on identity.id = membership.user_id
    left join public.user_profiles as user_profile on user_profile.user_id = membership.user_id
    where delivery.channel = 'email'
      and delivery.state in ('queued', 'retryable')
      and outbox.event_type = 'round.published'
      and outbox.aggregate_type = 'round'
      and outbox.state in ('queued', 'retryable')
      and (
        membership.status <> 'active'
        or membership.user_id is null
        or user_profile.user_id is null
        or user_profile.disabled_at is not null
        or identity.id is null
        or identity.email_confirmed_at is null
        or identity.deleted_at is not null
        or identity.is_anonymous
        or (identity.banned_until is not null and identity.banned_until > v_now)
        or identity.email is null
        or pg_catalog.length(pg_catalog.btrim(identity.email)) not between 3 and 320
        or pg_catalog.btrim(identity.email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        or exists (
          select 1
          from public.email_suppressions as suppression
          where suppression.normalized_address = pg_catalog.lower(pg_catalog.btrim(identity.email))
        )
      )
    order by delivery.next_attempt_at, delivery.created_at, delivery.id
    for update of delivery, outbox skip locked
  ), cancelled_deliveries as (
    update public.notification_deliveries as delivery
    set state = 'cancelled',
        failure_reason = invalid.safe_reason,
        claim_token = null,
        claimed_at = null,
        next_attempt_at = v_now
    from invalid
    where delivery.id = invalid.id
      and delivery.group_id = invalid.group_id
    returning delivery.outbox_job_id, delivery.group_id, delivery.failure_reason
  )
  update public.notification_outbox_jobs as outbox
  set state = 'cancelled',
      safe_error = cancelled.failure_reason,
      claimed_at = null,
      finished_at = v_now,
      next_attempt_at = v_now
  from cancelled_deliveries as cancelled
  where outbox.id = cancelled.outbox_job_id
    and outbox.group_id = cancelled.group_id;

  select
    delivery.id as delivery_id,
    outbox.id as outbox_job_id,
    round_record.id as round_id,
    delivery.group_id,
    group_record.name as group_name,
    round_record.group_time_zone::text as group_time_zone,
    round_record.description as round_description,
    round_record.scheduled_at,
    round_record.format,
    pg_catalog.btrim(identity.email) as recipient_address,
    delivery.attempts + 1 as attempt_number
  into selected_delivery
  from public.notification_deliveries as delivery
  join public.notification_outbox_jobs as outbox
    on outbox.id = delivery.outbox_job_id
   and outbox.group_id = delivery.group_id
  join public.rounds as round_record
    on round_record.id = outbox.aggregate_id
   and round_record.group_id = outbox.group_id
  join public.round_participants as participant
    on participant.round_id = round_record.id
   and participant.group_id = round_record.group_id
   and participant.membership_id = delivery.recipient_membership_id
  join public.memberships as membership
    on membership.id = participant.membership_id
   and membership.group_id = participant.group_id
  join public.user_profiles as user_profile
    on user_profile.user_id = membership.user_id
   and user_profile.disabled_at is null
  join auth.users as identity on identity.id = membership.user_id
  join public.groups as group_record on group_record.id = delivery.group_id
  where delivery.channel = 'email'
    and delivery.state in ('queued', 'retryable')
    and delivery.next_attempt_at <= v_now
    and outbox.event_type = 'round.published'
    and outbox.aggregate_type = 'round'
    and outbox.state in ('queued', 'retryable')
    and outbox.next_attempt_at <= v_now
    and membership.status = 'active'
    and identity.email_confirmed_at is not null
    and identity.deleted_at is null
    and not identity.is_anonymous
    and (identity.banned_until is null or identity.banned_until <= v_now)
    and identity.email is not null
    and pg_catalog.length(pg_catalog.btrim(identity.email)) between 3 and 320
    and pg_catalog.btrim(identity.email) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    and not exists (
      select 1
      from public.email_suppressions as suppression
      where suppression.normalized_address = pg_catalog.lower(pg_catalog.btrim(identity.email))
    )
  order by delivery.next_attempt_at, delivery.created_at, delivery.id
  for update of delivery, outbox skip locked
  limit 1;

  if not found then
    return;
  end if;

  update public.notification_deliveries as delivery
  set state = 'sending',
      claim_token = p_claim_token,
      claimed_at = v_now,
      attempts = selected_delivery.attempt_number,
      failure_reason = null,
      recipient_address = selected_delivery.recipient_address,
      recipient_address_normalized = pg_catalog.lower(selected_delivery.recipient_address)
  where delivery.id = selected_delivery.delivery_id
    and delivery.group_id = selected_delivery.group_id;

  update public.notification_outbox_jobs as outbox
  set state = 'processing',
      claimed_at = v_now,
      attempts = selected_delivery.attempt_number,
      safe_error = null
  where outbox.id = selected_delivery.outbox_job_id
    and outbox.group_id = selected_delivery.group_id;

  return query
  select
    selected_delivery.delivery_id::app.entity_id,
    selected_delivery.outbox_job_id::app.entity_id,
    selected_delivery.round_id::app.entity_id,
    selected_delivery.group_id::app.entity_id,
    selected_delivery.group_name::text,
    selected_delivery.group_time_zone::text,
    selected_delivery.round_description::text,
    selected_delivery.scheduled_at::app.utc_instant,
    selected_delivery.format::public.round_format,
    selected_delivery.recipient_address::text,
    selected_delivery.attempt_number::integer;
end;
$$;

comment on function public.claim_round_published_email(uuid, timestamptz) is
  'Service-only atomic claim for one round-published e-mail. It recovers stale leases, re-resolves active verified identity state, and excludes suppressed addresses.';

revoke all on function public.claim_round_published_email(uuid, timestamptz)
from public, anon, authenticated, service_role;
grant execute on function public.claim_round_published_email(uuid, timestamptz)
to service_role;

create function public.read_round_participants(
  p_actor_user_id uuid,
  p_round_id uuid
)
returns table (
  round_id app.entity_id,
  participant_id app.entity_id,
  group_id app.entity_id,
  membership_id app.entity_id,
  first_name text,
  last_name text,
  rsvp_status public.round_rsvp_status,
  quota_snapshot app.quota_value,
  quota_snapshot_source jsonb,
  handicap_snapshot app.handicap_value,
  handicap_snapshot_source public.member_handicap_source,
  handicap_snapshot_as_of date,
  tee_snapshot text
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
  if p_actor_user_id is null or p_round_id is null then
    raise exception 'publication_context_required' using errcode = '22004';
  end if;
  select membership.group_id, membership.id, membership.role
  into actor_group_id, actor_membership_id, actor_role
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
    and (identity.banned_until is null or identity.banned_until <= pg_catalog.statement_timestamp())
  limit 1;
  if actor_group_id is null then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;
  select round_record.* into target_round
  from public.rounds as round_record
  where round_record.id = p_round_id and round_record.group_id = actor_group_id;
  if not found or target_round.state = 'draft' then
    raise exception 'round_not_found' using errcode = 'P0002';
  end if;

  return query
  select
    participant.round_id,
    participant.id,
    participant.group_id,
    participant.membership_id,
    profile.first_name,
    profile.last_name,
    participant.rsvp_status,
    participant.quota_snapshot,
    participant.quota_snapshot_source,
    participant.handicap_snapshot,
    participant.handicap_snapshot_source,
    participant.handicap_snapshot_as_of,
    participant.tee_snapshot
  from public.round_participants as participant
  join public.membership_golfer_profiles as profile
    on profile.membership_id = participant.membership_id and profile.group_id = participant.group_id
  where participant.round_id = target_round.id
    and participant.group_id = target_round.group_id
    and (
      actor_role in ('coordinator', 'administrator')
      or participant.membership_id = actor_membership_id
    )
  order by profile.last_name, profile.first_name, participant.membership_id;
end;
$$;

comment on function public.read_round_participants(uuid, uuid) is
  'Authenticated member read boundary. Members see only their own participant; coordinators/admins see their tenant roster.';

revoke all on function public.read_round_participants(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.read_round_participants(uuid, uuid)
to service_role;
