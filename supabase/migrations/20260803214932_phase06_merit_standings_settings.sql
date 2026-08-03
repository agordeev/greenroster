-- Phase 06: prospective merit and standings policy alongside the quota policy.
--
-- This migration deliberately leaves the existing ten-argument quota RPC in
-- place for backwards compatibility.  The extended overload below is the
-- administrator-only boundary used by the web adapter.  Both paths keep one
-- current, versioned settings row per group and append an audit event.

alter table public.group_quota_settings
  add column participation_merit app.participation_merit_value not null default 0,
  add column standings_reset_date date;

create table public.placement_merit_rows (
  group_id app.entity_id not null references public.group_quota_settings (group_id) on delete cascade,
  rank smallint not null,
  merit_points app.placement_merit_value not null,
  constraint placement_merit_rows_pk primary key (group_id, rank),
  constraint placement_merit_rows_rank_positive check (rank > 0)
);

comment on table public.placement_merit_rows is
  'Optional ordered competition-rank to merit-points policy for one group. Empty means no placement merit.';

alter table public.placement_merit_rows enable row level security;
alter table public.placement_merit_rows force row level security;

create policy placement_merit_rows_tenant_read
on public.placement_merit_rows
for select
to authenticated
using (
  group_id = (select app.active_group_id())
  and (select app.active_membership_role()) in ('coordinator', 'administrator')
);

revoke all on table public.placement_merit_rows from public, anon, authenticated;
grant select on table public.placement_merit_rows to authenticated;

-- A JSON array is used in immutable publication snapshots.  This validator is
-- intentionally strict: ranks are positive, strictly ordered, and points use
-- the exact 0..500/2-decimal policy from Section 11.6.
create function app.validate_placement_merit_table(p_table jsonb)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  item jsonb;
  rank_value integer;
  previous_rank integer := 0;
  points_value numeric;
  rank_text text;
  points_text text;
begin
  if p_table is null or pg_catalog.jsonb_typeof(p_table) <> 'array' then
    return false;
  end if;

  for item in select value from pg_catalog.jsonb_array_elements(p_table) loop
    if pg_catalog.jsonb_typeof(item) <> 'object'
      or not (item ?& array['rank', 'points'])
    then
      return false;
    end if;

    rank_text := item ->> 'rank';
    points_text := item ->> 'points';
    if rank_text is null or rank_text !~ '^[1-9][0-9]*$'
      or points_text is null
      or points_text !~ '^[+]?([0-9]+)([.][0-9]{1,2})?$'
    then
      return false;
    end if;

    begin
      rank_value := rank_text::integer;
      points_value := points_text::numeric;
    exception when others then
      return false;
    end;

    if rank_value <= previous_rank
      or rank_value > 32767
      or points_value is null
      or points_value <> pg_catalog.round(points_value, 2)
      or points_value < 0
      or points_value > 500
    then
      return false;
    end if;
    previous_rank := rank_value;
  end loop;

  return true;
end;
$$;

revoke all on function app.validate_placement_merit_table(jsonb)
from public, anon, authenticated, service_role;

alter table public.round_rule_snapshots
  add column participation_merit app.participation_merit_value not null default 0,
  add column placement_merit jsonb not null default '[]'::jsonb,
  add column standings_reset_date date;

alter table public.round_rule_snapshots
  drop constraint round_rule_snapshots_settings_consistent;

alter table public.round_rule_snapshots
  add constraint round_rule_snapshots_settings_consistent check (
    (
      settings_version = 0
      and quota_method is null
      and moving_average_history_length is null
      and quota_precision is null
      and quota_rounding_rule is null
      and adjustment_bands = '[]'::jsonb
      and participation_merit = 0
      and placement_merit = '[]'::jsonb
      and standings_reset_date is null
    )
    or (
      settings_version > 0
      and quota_method is not null
      and quota_precision between 0 and 2
      and quota_rounding_rule is not null
      and pg_catalog.jsonb_typeof(adjustment_bands) = 'array'
      and ((quota_method = 'moving_average' and moving_average_history_length between 4 and 20)
        or (quota_method <> 'moving_average' and moving_average_history_length is null))
      and pg_catalog.jsonb_typeof(placement_merit) = 'array'
      and app.validate_placement_merit_table(placement_merit)
    )
  );

create function app.populate_round_rule_snapshot_merit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  settings_row public.group_quota_settings%rowtype;
begin
  select settings.*
  into settings_row
  from public.group_quota_settings as settings
  where settings.group_id = new.group_id;

  if found then
    new.participation_merit := settings_row.participation_merit;
    new.standings_reset_date := settings_row.standings_reset_date;
    select coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'rank', placement.rank,
          'points', placement.merit_points
        ) order by placement.rank
      ),
      '[]'::jsonb
    )
    into new.placement_merit
    from public.placement_merit_rows as placement
    where placement.group_id = new.group_id;
  else
    new.participation_merit := coalesce(new.participation_merit, 0);
    new.placement_merit := coalesce(new.placement_merit, '[]'::jsonb);
  end if;

  return new;
end;
$$;

revoke all on function app.populate_round_rule_snapshot_merit()
from public, anon, authenticated, service_role;

create trigger round_rule_snapshots_populate_merit
before insert on public.round_rule_snapshots
for each row execute function app.populate_round_rule_snapshot_merit();

-- The review token must include the prospective merit policy as well as quota
-- fields.  Existing publication code continues to provide quota columns only;
-- the snapshot trigger above fills these three fields atomically from the
-- locked current settings row.
create or replace function app.round_publication_review_state(
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
    settings.participation_merit,
    settings.standings_reset_date,
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
    ) as adjustment_bands,
    coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'rank', placement.rank,
            'points', placement.merit_points
          ) order by placement.rank
        )
        from public.placement_merit_rows as placement
        where placement.group_id = settings.group_id
      ),
      '[]'::jsonb
    ) as placement_merit
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
            'adjustment_bands', settings.adjustment_bands,
            'participation_merit', settings.participation_merit,
            'placement_merit', settings.placement_merit,
            'standings_reset_date', settings.standings_reset_date
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

-- The web adapter calls this overload.  Keep the existing ten-argument
-- configure_group_quota_rules function untouched so older clients/tests still
-- receive exactly the quota-only behavior.
create function public.configure_group_quota_rules(
  p_actor_user_id uuid,
  p_method public.quota_method,
  p_moving_average_history_length integer,
  p_precision integer,
  p_rounding_rule public.quota_rounding_rule,
  p_bands jsonb,
  p_expected_settings_version bigint,
  p_reason text,
  p_correlation_id uuid,
  p_operation_id uuid,
  p_participation_merit numeric,
  p_placement_merit jsonb,
  p_standings_reset_date date
)
returns table (
  configured_group_id app.entity_id,
  settings_version bigint,
  configured_method public.quota_method,
  configured_history_length smallint,
  configured_precision smallint,
  configured_rounding_rule public.quota_rounding_rule,
  configured_participation_merit app.participation_merit_value,
  configured_placement_merit jsonb,
  configured_standings_reset_date date
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_group_id uuid;
  actor_membership public.memberships%rowtype;
  locked_group public.groups%rowtype;
  prior_settings public.group_quota_settings%rowtype;
  saved_settings public.group_quota_settings%rowtype;
  prior_event public.audit_events%rowtype;
  normalized_reason text;
  band_count integer;
  invalid_band_count integer;
  invalid_boundary_count integer;
  before_state jsonb;
  placement_rows jsonb;
  normalized_bands jsonb;
  quota_policy_unchanged boolean := false;
begin
  if p_actor_user_id is null then
    raise exception 'actor_identity_required' using errcode = '22004';
  end if;
  if p_correlation_id is null or p_operation_id is null then
    raise exception 'operation_context_required' using errcode = '22004';
  end if;

  normalized_reason := pg_catalog.btrim(p_reason);
  if normalized_reason is null
    or normalized_reason = ''
    or pg_catalog.length(normalized_reason) > 500
  then
    raise exception 'quota_settings_reason_required' using errcode = '22023';
  end if;

  if p_method is null
    or p_precision is null
    or p_precision not between 0 and 2
    or p_rounding_rule is null
    or p_expected_settings_version is null
    or p_expected_settings_version < 0
    or p_bands is null
    or pg_catalog.jsonb_typeof(p_bands) <> 'array'
    or p_participation_merit is null
    or p_participation_merit = 'NaN'::numeric
    or p_participation_merit <> pg_catalog.round(p_participation_merit, 2)
    or p_participation_merit not between 0 and 100
    or not app.validate_placement_merit_table(p_placement_merit)
  then
    raise exception 'quota_settings_input_invalid' using errcode = '22023';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'rank', (value ->> 'rank')::integer,
        'points', (value ->> 'points')::numeric
      ) order by ordinal
    ),
    '[]'::jsonb
  )
  into placement_rows
  from pg_catalog.jsonb_array_elements(p_placement_merit) with ordinality as item(value, ordinal);

  if (
    p_method = 'moving_average'
    and (
      p_moving_average_history_length is null
      or p_moving_average_history_length not between 4 and 20
    )
  )
    or (p_method <> 'moving_average' and p_moving_average_history_length is not null)
  then
    raise exception 'quota_history_length_invalid' using errcode = '22023';
  end if;

  select membership.group_id
  into actor_group_id
  from public.memberships as membership
  where membership.user_id = p_actor_user_id;
  if not found then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  select actor_group.*
  into locked_group
  from public.groups as actor_group
  where actor_group.id = actor_group_id
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
    and (identity.banned_until is null or identity.banned_until <= pg_catalog.now())
  for update of membership;
  if not found or actor_membership.role <> 'administrator' then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  select event.*
  into prior_event
  from public.audit_events as event
  where event.group_id = actor_membership.group_id
    and event.actor_user_id = p_actor_user_id
    and event.action = 'group.quota_rules_configured'
    and event.operation_id = p_operation_id;
  if found then
    if (prior_event.after_state ->> 'method') is distinct from p_method::text
      or (prior_event.after_state ->> 'moving_average_history_length')::integer is distinct from p_moving_average_history_length
      or (prior_event.after_state ->> 'precision')::integer is distinct from p_precision
      or (prior_event.after_state ->> 'rounding_rule') is distinct from p_rounding_rule::text
      or (prior_event.after_state ->> 'participation_merit')::numeric is distinct from p_participation_merit
      or (prior_event.after_state -> 'placement_merit') is distinct from placement_rows
      or (prior_event.after_state ->> 'standings_reset_date')::date is distinct from p_standings_reset_date
      or (prior_event.after_state -> 'bands') is distinct from p_bands
    then
      raise exception 'operation_id_reused' using errcode = '23505';
    end if;
    return query select
      prior_event.group_id,
      prior_event.target_version,
      (prior_event.after_state ->> 'method')::public.quota_method,
      (prior_event.after_state ->> 'moving_average_history_length')::smallint,
      (prior_event.after_state ->> 'precision')::smallint,
      (prior_event.after_state ->> 'rounding_rule')::public.quota_rounding_rule,
      (prior_event.after_state ->> 'participation_merit')::app.participation_merit_value,
      coalesce(prior_event.after_state -> 'placement_merit', '[]'::jsonb),
      (prior_event.after_state ->> 'standings_reset_date')::date;
    return;
  end if;

  select settings.*
  into prior_settings
  from public.group_quota_settings as settings
  where settings.group_id = locked_group.id
  for update;
  if found then
    if p_expected_settings_version <> prior_settings.version then
      raise exception 'quota_settings_version_changed' using errcode = '40001';
    end if;

    before_state := pg_catalog.jsonb_build_object(
      'method', prior_settings.method,
      'moving_average_history_length', prior_settings.moving_average_history_length,
      'precision', prior_settings.precision,
      'rounding_rule', prior_settings.rounding_rule,
      'version', prior_settings.version,
      'participation_merit', prior_settings.participation_merit,
      'standings_reset_date', prior_settings.standings_reset_date,
      'placement_merit', (
        select coalesce(
          pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object('rank', placement.rank, 'points', placement.merit_points)
            order by placement.rank
          ),
          '[]'::jsonb
        )
        from public.placement_merit_rows as placement
        where placement.group_id = locked_group.id
      ),
      'bands', (
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
        from public.quota_adjustment_bands as band
        where band.group_id = locked_group.id
      )
    );
  elsif p_expected_settings_version <> 0 then
    raise exception 'quota_settings_version_changed' using errcode = '40001';
  else
    before_state := null;
  end if;

  select pg_catalog.jsonb_array_length(p_bands) into band_count;
  if p_method <> 'previous_plus_minus' and band_count <> 0 then
    raise exception 'quota_bands_not_allowed' using errcode = '22023';
  end if;
  if p_method = 'previous_plus_minus' then
    if band_count = 0 then
      raise exception 'quota_bands_incomplete' using errcode = '22023';
    end if;

    with supplied_bands as (
      select
        ordinal::integer as position,
        (value ->> 'lower_bound')::numeric as lower_bound,
        (value ->> 'lower_inclusive')::boolean as lower_inclusive,
        (value ->> 'upper_bound')::numeric as upper_bound,
        (value ->> 'upper_inclusive')::boolean as upper_inclusive,
        (value ->> 'adjustment')::numeric as adjustment,
        value
      from pg_catalog.jsonb_array_elements(p_bands) with ordinality as item(value, ordinal)
    )
    select count(*)
    into invalid_band_count
    from supplied_bands
    where pg_catalog.jsonb_typeof(value) <> 'object'
      or not (value ?& array['lower_bound', 'lower_inclusive', 'upper_bound', 'upper_inclusive', 'adjustment'])
      or lower_bound <> pg_catalog.round(lower_bound, 2)
      or lower_bound not between -100 and 100
      or upper_bound <> pg_catalog.round(upper_bound, 2)
      or upper_bound not between -100 and 100
      or adjustment <> pg_catalog.round(adjustment, 2)
      or adjustment not between -20 and 20
      or lower_bound > upper_bound
      or (lower_bound = upper_bound and not (lower_inclusive and upper_inclusive));
    if invalid_band_count <> 0 then
      raise exception 'quota_band_invalid' using errcode = '22023';
    end if;

    with supplied_bands as (
      select
        ordinal::integer as position,
        (value ->> 'lower_bound')::numeric as lower_bound,
        (value ->> 'lower_inclusive')::boolean as lower_inclusive,
        (value ->> 'upper_bound')::numeric as upper_bound,
        (value ->> 'upper_inclusive')::boolean as upper_inclusive
      from pg_catalog.jsonb_array_elements(p_bands) with ordinality as item(value, ordinal)
    ), checked_bands as (
      select
        band.*,
        pg_catalog.lag(upper_bound) over (order by position) as prior_upper_bound,
        pg_catalog.lag(upper_inclusive) over (order by position) as prior_upper_inclusive
      from supplied_bands as band
    )
    select count(*)
    into invalid_boundary_count
    from checked_bands
    where (position = 1 and (lower_bound <> -100 or not lower_inclusive))
      or (position = band_count and (upper_bound <> 100 or not upper_inclusive))
      or (
        position > 1
        and (lower_bound <> prior_upper_bound or lower_inclusive = prior_upper_inclusive)
      );
    if invalid_boundary_count <> 0 then
      raise exception 'quota_bands_incomplete_or_overlapping' using errcode = '22023';
    end if;
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'position', ordinal,
        'lower_bound', (value ->> 'lower_bound')::numeric,
        'lower_inclusive', (value ->> 'lower_inclusive')::boolean,
        'upper_bound', (value ->> 'upper_bound')::numeric,
        'upper_inclusive', (value ->> 'upper_inclusive')::boolean,
        'adjustment', (value ->> 'adjustment')::numeric
      ) order by ordinal
    ),
    '[]'::jsonb
  )
  into normalized_bands
  from pg_catalog.jsonb_array_elements(p_bands) with ordinality as item(value, ordinal);

  if prior_settings.version is not null then
    quota_policy_unchanged :=
      prior_settings.method = p_method
      and prior_settings.moving_average_history_length is not distinct from p_moving_average_history_length
      and prior_settings.precision = p_precision
      and prior_settings.rounding_rule = p_rounding_rule
      and (
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
        from public.quota_adjustment_bands as band
        where band.group_id = locked_group.id
      ) = normalized_bands;
  end if;

  insert into public.group_quota_settings (
    group_id,
    method,
    moving_average_history_length,
    precision,
    rounding_rule,
    version,
    updated_by,
    participation_merit,
    standings_reset_date
  )
  values (
    locked_group.id,
    p_method,
    p_moving_average_history_length,
    p_precision,
    p_rounding_rule,
    1,
    p_actor_user_id,
    p_participation_merit::app.participation_merit_value,
    p_standings_reset_date
  )
  on conflict (group_id) do update
  set method = excluded.method,
      moving_average_history_length = excluded.moving_average_history_length,
      precision = excluded.precision,
      rounding_rule = excluded.rounding_rule,
      version = public.group_quota_settings.version + 1,
      updated_by = excluded.updated_by,
      participation_merit = excluded.participation_merit,
      standings_reset_date = excluded.standings_reset_date
  returning * into saved_settings;

  delete from public.quota_adjustment_bands where group_id = locked_group.id;
  if p_method = 'previous_plus_minus' then
    insert into public.quota_adjustment_bands (
      group_id, position, lower_bound, lower_inclusive,
      upper_bound, upper_inclusive, adjustment
    )
    select
      locked_group.id,
      ordinal::smallint,
      (value ->> 'lower_bound')::app.plus_minus_value,
      (value ->> 'lower_inclusive')::boolean,
      (value ->> 'upper_bound')::app.plus_minus_value,
      (value ->> 'upper_inclusive')::boolean,
      (value ->> 'adjustment')::app.quota_adjustment_value
    from pg_catalog.jsonb_array_elements(p_bands) with ordinality as item(value, ordinal);
  end if;

  delete from public.placement_merit_rows where group_id = locked_group.id;
  insert into public.placement_merit_rows (group_id, rank, merit_points)
  select
    locked_group.id,
    (value ->> 'rank')::smallint,
    (value ->> 'points')::app.placement_merit_value
  from pg_catalog.jsonb_array_elements(p_placement_merit) as item(value);

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object('rank', placement.rank, 'points', placement.merit_points)
      order by placement.rank
    ),
    '[]'::jsonb
  )
  into placement_rows
  from public.placement_merit_rows as placement
  where placement.group_id = locked_group.id;

  -- Merit/reset-only changes still advance the shared settings version so
  -- snapshots and audit history remain monotonic.  Existing quota projections
  -- remain mathematically valid in that case, so carry their provenance to the
  -- new version atomically.  A quota-policy change deliberately leaves them
  -- stale and forces the normal recalculation path.
  if quota_policy_unchanged then
    update public.membership_quota_projections as projection
    set settings_version = saved_settings.version,
        projection_source = pg_catalog.jsonb_set(
          projection.projection_source,
          '{settings_version}',
          pg_catalog.to_jsonb(saved_settings.version),
          true
        )
    where projection.group_id = locked_group.id
      and projection.settings_version = prior_settings.version;
  end if;

  insert into public.audit_events (
    group_id, actor_user_id, action, target_type, target_id, target_version,
    before_state, after_state, source, correlation_id, operation_id, reason
  )
  values (
    locked_group.id,
    p_actor_user_id,
    'group.quota_rules_configured',
    'group_quota_settings',
    locked_group.id,
    saved_settings.version,
    before_state,
    pg_catalog.jsonb_build_object(
      'method', saved_settings.method,
      'moving_average_history_length', saved_settings.moving_average_history_length,
      'precision', saved_settings.precision,
      'rounding_rule', saved_settings.rounding_rule,
      'version', saved_settings.version,
      'participation_merit', saved_settings.participation_merit,
      'standings_reset_date', saved_settings.standings_reset_date,
      'placement_merit', placement_rows,
      'bands', p_bands
    ),
    'server',
    p_correlation_id,
    p_operation_id,
    normalized_reason
  );

  return query select
    saved_settings.group_id,
    saved_settings.version,
    saved_settings.method,
    saved_settings.moving_average_history_length,
    saved_settings.precision,
    saved_settings.rounding_rule,
    saved_settings.participation_merit,
    placement_rows,
    saved_settings.standings_reset_date;
end;
$$;

comment on function public.configure_group_quota_rules(
  uuid, public.quota_method, integer, integer, public.quota_rounding_rule,
  jsonb, bigint, text, uuid, uuid, numeric, jsonb, date
) is
  'Atomically validates and replaces quota, merit, and standings settings for the actor-derived administrator group.';

revoke all on function public.configure_group_quota_rules(
  uuid, public.quota_method, integer, integer, public.quota_rounding_rule,
  jsonb, bigint, text, uuid, uuid, numeric, jsonb, date
) from public, anon, authenticated;
grant execute on function public.configure_group_quota_rules(
  uuid, public.quota_method, integer, integer, public.quota_rounding_rule,
  jsonb, bigint, text, uuid, uuid, numeric, jsonb, date
) to service_role;
