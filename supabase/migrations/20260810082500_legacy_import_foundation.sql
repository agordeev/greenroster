-- Tenant-safe staging foundation for authorized, profiled legacy CSV exports.
--
-- This migration intentionally stops before writing domain records.  A source
-- profile, mapping decision, identity rule, and cutover owner are external
-- inputs.  The staged rows, immutable legacy-key crosswalk, safe exception
-- report, audit events, and replay key make a dry/restartable migration
-- possible without guessing the GolfDogFight export contract.

create type public.legacy_import_state as enum (
  'staged',
  'mapping_required',
  'ready',
  'blocked',
  'applying',
  'completed'
);

create type public.legacy_import_row_state as enum (
  'pending',
  'mapped',
  'ambiguous',
  'invalid',
  'skipped',
  'applied'
);

create type public.legacy_import_mapping_state as enum (
  'pending',
  'matched',
  'ambiguous',
  'rejected'
);

create type public.legacy_import_exception_severity as enum (
  'warning',
  'error'
);

create function app.legacy_payload_contains_sensitive_key(p_payload jsonb)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select case pg_catalog.jsonb_typeof(p_payload)
    when 'object' then exists (
      select 1
      from pg_catalog.jsonb_each(p_payload) as entry(key, value)
      where lower(entry.key) ~ '(password|passcode|token|secret|api[_-]?key|private[_-]?key|card|cvv|cvc)'
        or app.legacy_payload_contains_sensitive_key(entry.value)
    )
    when 'array' then exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_payload) as item(value)
      where app.legacy_payload_contains_sensitive_key(item.value)
    )
    else false
  end;
$$;
revoke all on function app.legacy_payload_contains_sensitive_key(jsonb)
from public, anon, authenticated, service_role;

create table public.legacy_import_jobs (
  id app.entity_id primary key default extensions.gen_random_uuid(),
  group_id app.entity_id not null references public.groups (id) on delete restrict,
  profile_key text not null,
  schema_version text not null,
  source_fingerprint text not null,
  state public.legacy_import_state not null default 'staged',
  actor_user_id app.entity_id not null references auth.users (id) on delete restrict,
  total_rows integer not null default 0,
  mapped_rows integer not null default 0,
  exception_rows integer not null default 0,
  revision bigint not null default 1,
  blocked_reason text,
  created_at app.utc_instant not null default pg_catalog.clock_timestamp(),
  updated_at app.utc_instant not null default pg_catalog.clock_timestamp(),
  constraint legacy_import_jobs_id_group_unique unique (id, group_id),
  constraint legacy_import_jobs_profile_valid check (profile_key ~ '^[a-z][a-z0-9_.-]{1,63}$'),
  constraint legacy_import_jobs_schema_valid check (schema_version ~ '^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,31}$'),
  constraint legacy_import_jobs_fingerprint_valid check (source_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint legacy_import_jobs_counts_nonnegative check (
    total_rows >= 0 and mapped_rows >= 0 and exception_rows >= 0
  ),
  constraint legacy_import_jobs_revision_positive check (revision > 0),
  constraint legacy_import_jobs_blocked_reason_valid check (
    blocked_reason is null or length(btrim(blocked_reason)) between 1 and 500
  )
);

create unique index legacy_import_jobs_replay_idx
  on public.legacy_import_jobs (group_id, profile_key, schema_version, source_fingerprint);
create index legacy_import_jobs_group_created_idx
  on public.legacy_import_jobs (group_id, created_at desc);

create trigger legacy_import_jobs_immutable_id
before update of id on public.legacy_import_jobs
for each row execute function app.reject_id_change('id');
create trigger legacy_import_jobs_immutable_group
before update of group_id on public.legacy_import_jobs
for each row execute function app.reject_id_change('group_id');
create trigger legacy_import_jobs_set_updated_at
before update on public.legacy_import_jobs
for each row execute function app.set_updated_at();

create table public.legacy_import_rows (
  id app.entity_id primary key default extensions.gen_random_uuid(),
  import_job_id app.entity_id not null,
  group_id app.entity_id not null references public.groups (id) on delete restrict,
  row_number integer not null,
  legacy_type text not null,
  legacy_key text not null,
  payload jsonb not null default '{}'::jsonb,
  row_state public.legacy_import_row_state not null default 'pending',
  created_at app.utc_instant not null default pg_catalog.clock_timestamp(),
  updated_at app.utc_instant not null default pg_catalog.clock_timestamp(),
  constraint legacy_import_rows_id_group_unique unique (id, group_id),
  constraint legacy_import_rows_job_group_fk foreign key (import_job_id, group_id)
    references public.legacy_import_jobs (id, group_id) on delete cascade,
  constraint legacy_import_rows_row_number_valid check (row_number > 1),
  constraint legacy_import_rows_type_valid check (length(btrim(legacy_type)) between 1 and 100),
  constraint legacy_import_rows_key_valid check (length(btrim(legacy_key)) between 1 and 200),
  constraint legacy_import_rows_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint legacy_import_rows_no_sensitive_keys check (
    not app.legacy_payload_contains_sensitive_key(payload)
  )
);

create unique index legacy_import_rows_job_row_idx
  on public.legacy_import_rows (import_job_id, row_number);
create index legacy_import_rows_job_state_idx
  on public.legacy_import_rows (import_job_id, row_state, row_number);
create trigger legacy_import_rows_immutable_id
before update of id on public.legacy_import_rows
for each row execute function app.reject_id_change('id');
create trigger legacy_import_rows_immutable_group
before update of group_id on public.legacy_import_rows
for each row execute function app.reject_id_change('group_id');
create trigger legacy_import_rows_set_updated_at
before update on public.legacy_import_rows
for each row execute function app.set_updated_at();

create table public.legacy_import_crosswalk (
  id app.entity_id primary key default extensions.gen_random_uuid(),
  group_id app.entity_id not null references public.groups (id) on delete restrict,
  import_job_id app.entity_id not null,
  source_profile text not null,
  legacy_type text not null,
  legacy_key text not null,
  mapping_state public.legacy_import_mapping_state not null default 'pending',
  target_type text,
  target_id app.entity_id,
  mapping_method text,
  decision_reason text,
  created_at app.utc_instant not null default pg_catalog.clock_timestamp(),
  updated_at app.utc_instant not null default pg_catalog.clock_timestamp(),
  constraint legacy_import_crosswalk_id_group_unique unique (id, group_id),
  constraint legacy_import_crosswalk_job_group_fk foreign key (import_job_id, group_id)
    references public.legacy_import_jobs (id, group_id) on delete cascade,
  constraint legacy_import_crosswalk_profile_valid check (source_profile ~ '^[a-z][a-z0-9_.-]{1,63}$'),
  constraint legacy_import_crosswalk_type_valid check (length(btrim(legacy_type)) between 1 and 100),
  constraint legacy_import_crosswalk_key_valid check (length(btrim(legacy_key)) between 1 and 200),
  constraint legacy_import_crosswalk_mapping_consistent check (
    (mapping_state = 'matched' and target_type is not null and target_id is not null)
    or (mapping_state <> 'matched' and target_id is null)
  ),
  constraint legacy_import_crosswalk_reason_valid check (
    decision_reason is null or length(btrim(decision_reason)) between 1 and 500
  )
);

create unique index legacy_import_crosswalk_key_idx
  on public.legacy_import_crosswalk (group_id, source_profile, legacy_type, legacy_key);
create index legacy_import_crosswalk_job_state_idx
  on public.legacy_import_crosswalk (import_job_id, mapping_state);
create trigger legacy_import_crosswalk_immutable_id
before update of id on public.legacy_import_crosswalk
for each row execute function app.reject_id_change('id');
create trigger legacy_import_crosswalk_immutable_group
before update of group_id on public.legacy_import_crosswalk
for each row execute function app.reject_id_change('group_id');
create trigger legacy_import_crosswalk_set_updated_at
before update on public.legacy_import_crosswalk
for each row execute function app.set_updated_at();

create table public.legacy_import_exceptions (
  id app.entity_id primary key default extensions.gen_random_uuid(),
  import_job_id app.entity_id not null,
  group_id app.entity_id not null references public.groups (id) on delete restrict,
  row_id app.entity_id,
  row_number integer,
  severity public.legacy_import_exception_severity not null,
  code text not null,
  field text,
  message text not null,
  safe_details jsonb not null default '{}'::jsonb,
  created_at app.utc_instant not null default pg_catalog.clock_timestamp(),
  constraint legacy_import_exceptions_id_group_unique unique (id, group_id),
  constraint legacy_import_exceptions_job_group_fk foreign key (import_job_id, group_id)
    references public.legacy_import_jobs (id, group_id) on delete cascade,
  constraint legacy_import_exceptions_row_group_fk foreign key (row_id, group_id)
    references public.legacy_import_rows (id, group_id) on delete cascade,
  constraint legacy_import_exceptions_row_number_valid check (row_number is null or row_number > 1),
  constraint legacy_import_exceptions_code_valid check (code ~ '^[a-z][a-z0-9_.-]{1,100}$'),
  constraint legacy_import_exceptions_message_valid check (length(btrim(message)) between 1 and 500),
  constraint legacy_import_exceptions_details_object check (jsonb_typeof(safe_details) = 'object'),
  constraint legacy_import_exceptions_no_sensitive_keys check (
    not app.legacy_payload_contains_sensitive_key(safe_details)
  )
);

create index legacy_import_exceptions_job_idx
  on public.legacy_import_exceptions (import_job_id, severity, row_number);

alter table public.legacy_import_jobs enable row level security;
alter table public.legacy_import_jobs force row level security;
alter table public.legacy_import_rows enable row level security;
alter table public.legacy_import_rows force row level security;
alter table public.legacy_import_crosswalk enable row level security;
alter table public.legacy_import_crosswalk force row level security;
alter table public.legacy_import_exceptions enable row level security;
alter table public.legacy_import_exceptions force row level security;

revoke all on table
  public.legacy_import_jobs,
  public.legacy_import_rows,
  public.legacy_import_crosswalk,
  public.legacy_import_exceptions
from public, anon, authenticated, service_role;

-- Redact nested sensitive keys before a staged payload reaches a force-RLS row.
create function app.redact_legacy_payload(p_payload jsonb)
returns jsonb
language sql
immutable
strict
set search_path = ''
as $$
  select case pg_catalog.jsonb_typeof(p_payload)
    when 'object' then coalesce((
      select pg_catalog.jsonb_object_agg(entry.key, app.redact_legacy_payload(entry.value))
      from pg_catalog.jsonb_each(p_payload) as entry(key, value)
      where lower(entry.key) !~ '(password|passcode|token|secret|api[_-]?key|private[_-]?key|card|cvv|cvc)'
    ), '{}'::jsonb)
    when 'array' then coalesce((
      select pg_catalog.jsonb_agg(app.redact_legacy_payload(item.value) order by item.ordinal)
      from pg_catalog.jsonb_array_elements(p_payload) with ordinality as item(value, ordinal)
    ), '[]'::jsonb)
    else p_payload
  end;
$$;
revoke all on function app.redact_legacy_payload(jsonb) from public, anon, authenticated, service_role;

create function app.resolve_legacy_import_actor(p_actor_user_id uuid)
returns table (group_id app.entity_id, actor_role public.membership_role)
language sql
stable
security definer
set search_path = ''
as $$
  select membership.group_id, membership.role
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
    and (identity.banned_until is null or identity.banned_until <= pg_catalog.clock_timestamp());
$$;
revoke all on function app.resolve_legacy_import_actor(uuid) from public, anon, authenticated, service_role;

create function public.create_legacy_import_job(
  p_actor_user_id uuid,
  p_import_job_id uuid,
  p_profile_key text,
  p_schema_version text,
  p_source_fingerprint text,
  p_rows jsonb,
  p_warnings jsonb,
  p_correlation_id uuid,
  p_operation_id uuid
)
returns table (
  import_job_id app.entity_id,
  group_id app.entity_id,
  profile_key text,
  state public.legacy_import_state,
  total_rows integer,
  exception_rows integer,
  revision bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_group_id uuid;
  existing public.legacy_import_jobs%rowtype;
  job public.legacy_import_jobs%rowtype;
  item jsonb;
  row_record public.legacy_import_rows%rowtype;
  sanitized_payload jsonb;
  row_number_value integer;
  legacy_type_value text;
  legacy_key_value text;
  warning jsonb;
  warning_row_number integer;
  exception_count integer := 0;
  invalid_count integer := 0;
  mapped_count integer := 0;
begin
  if p_actor_user_id is null or p_import_job_id is null
    or p_correlation_id is null or p_operation_id is null
    or p_rows is null or pg_catalog.jsonb_typeof(p_rows) <> 'array'
    or p_warnings is null or pg_catalog.jsonb_typeof(p_warnings) <> 'array'
  then
    raise exception 'legacy_import_input_invalid' using errcode = '22023';
  end if;
  if nullif(pg_catalog.btrim(p_profile_key), '') is null
    or pg_catalog.lower(pg_catalog.btrim(p_profile_key)) !~ '^[a-z][a-z0-9_.-]{1,63}$'
  then
    raise exception 'legacy_import_profile_invalid' using errcode = '22023';
  end if;
  if nullif(pg_catalog.btrim(p_schema_version), '') is null
    or pg_catalog.btrim(p_schema_version) !~ '^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,31}$'
  then
    raise exception 'legacy_import_schema_version_invalid' using errcode = '22023';
  end if;
  if pg_catalog.lower(coalesce(p_source_fingerprint, '')) !~ '^[0-9a-f]{64}$' then
    raise exception 'legacy_import_fingerprint_invalid' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_array_length(p_rows) = 0
    or pg_catalog.jsonb_array_length(p_rows) > 50000
  then
    raise exception 'legacy_import_row_count_invalid' using errcode = '22023';
  end if;

  select actor.group_id
  into actor_group_id
  from app.resolve_legacy_import_actor(p_actor_user_id) as actor
  limit 1;
  if actor_group_id is null then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;
  perform 1 from public.groups as group_record
  where group_record.id = actor_group_id
  for update;

  select * into existing
  from public.legacy_import_jobs as import_job
  where import_job.group_id = actor_group_id
    and import_job.profile_key = pg_catalog.lower(pg_catalog.btrim(p_profile_key))
    and import_job.schema_version = pg_catalog.btrim(p_schema_version)
    and import_job.source_fingerprint = pg_catalog.lower(p_source_fingerprint)
  for update;
  if found then
    return query select existing.id, existing.group_id, existing.profile_key,
      existing.state, existing.total_rows, existing.exception_rows, existing.revision;
    return;
  end if;

  insert into public.legacy_import_jobs (
    id, group_id, profile_key, schema_version, source_fingerprint,
    actor_user_id, total_rows
  ) values (
    p_import_job_id, actor_group_id, pg_catalog.lower(pg_catalog.btrim(p_profile_key)),
    pg_catalog.btrim(p_schema_version), pg_catalog.lower(p_source_fingerprint),
    p_actor_user_id, pg_catalog.jsonb_array_length(p_rows)
  ) returning * into job;

  for item in select value from pg_catalog.jsonb_array_elements(p_rows) as entry(value) loop
    if pg_catalog.jsonb_typeof(item) <> 'object'
      or (item ->> 'row_number') !~ '^[0-9]+$'
      or nullif(pg_catalog.btrim(item ->> 'legacy_type'), '') is null
      or nullif(pg_catalog.btrim(item ->> 'legacy_key'), '') is null
      or pg_catalog.jsonb_typeof(item -> 'payload') <> 'object'
    then
      raise exception 'legacy_import_row_invalid' using errcode = '22023';
    end if;
    row_number_value := (item ->> 'row_number')::integer;
    legacy_type_value := pg_catalog.btrim(item ->> 'legacy_type');
    legacy_key_value := pg_catalog.btrim(item ->> 'legacy_key');
    if row_number_value <= 1 or row_number_value > 50001
      or length(legacy_type_value) > 100 or length(legacy_key_value) > 200
    then
      raise exception 'legacy_import_row_invalid' using errcode = '22023';
    end if;
    sanitized_payload := app.redact_legacy_payload(item -> 'payload');
    insert into public.legacy_import_rows (
      import_job_id, group_id, row_number, legacy_type, legacy_key, payload
    ) values (
      job.id, job.group_id, row_number_value, legacy_type_value, legacy_key_value,
      sanitized_payload
    ) returning * into row_record;
    insert into public.legacy_import_crosswalk (
      group_id, import_job_id, source_profile, legacy_type, legacy_key
    ) values (
      job.group_id, job.id, job.profile_key, legacy_type_value, legacy_key_value
    ) on conflict do nothing;
  end loop;

  -- A duplicate key within one source file is an explicit row exception.  The
  -- crosswalk remains immutable, so a later corrected export can be staged
  -- under a new fingerprint without rewriting the original evidence.
  for row_record in
    select row.*
    from public.legacy_import_rows as row
    where row.import_job_id = job.id
      and exists (
        select 1
        from public.legacy_import_rows as duplicate
        where duplicate.import_job_id = row.import_job_id
          and duplicate.legacy_type = row.legacy_type
          and duplicate.legacy_key = row.legacy_key
          and duplicate.id <> row.id
      )
    for update
  loop
    insert into public.legacy_import_exceptions (
      import_job_id, group_id, row_id, row_number, severity, code, field,
      message, safe_details
    ) values (
      job.id, job.group_id, row_record.id, row_record.row_number, 'error',
      'duplicate_legacy_key', 'legacy_key',
      'The source repeats a legacy key for this row type.', '{}'::jsonb
    );
    update public.legacy_import_rows
    set row_state = 'invalid'
    where id = row_record.id;
  end loop;

  -- Profile warnings (for example unmapped source columns) are retained as
  -- reportable exceptions.  They do not become domain data silently.
  for warning in select value from pg_catalog.jsonb_array_elements(p_warnings) as entry(value) loop
    if pg_catalog.jsonb_typeof(warning) <> 'object'
      or nullif(pg_catalog.btrim(warning ->> 'code'), '') is null
      or nullif(pg_catalog.btrim(warning ->> 'message'), '') is null
    then
      raise exception 'legacy_import_warning_invalid' using errcode = '22023';
    end if;
    warning_row_number := null;
    if nullif(pg_catalog.btrim(warning ->> 'rowNumber'), '') is not null then
      if (warning ->> 'rowNumber') !~ '^[0-9]+$' then
        raise exception 'legacy_import_warning_invalid' using errcode = '22023';
      end if;
      warning_row_number := (warning ->> 'rowNumber')::integer;
    end if;
    insert into public.legacy_import_exceptions (
      import_job_id, group_id, row_number, severity, code, field, message, safe_details
    ) values (
      job.id, job.group_id, warning_row_number, 'warning',
      pg_catalog.left(pg_catalog.lower(pg_catalog.btrim(warning ->> 'code')), 100),
      nullif(pg_catalog.left(pg_catalog.btrim(warning ->> 'column'), 100), ''),
      pg_catalog.left(pg_catalog.btrim(warning ->> 'message'), 500), '{}'::jsonb
    );
  end loop;

  update public.legacy_import_rows as row
  set row_state = 'mapped'
  from public.legacy_import_crosswalk as crosswalk
  where row.import_job_id = job.id
    and crosswalk.group_id = row.group_id
    and crosswalk.source_profile = job.profile_key
    and crosswalk.legacy_type = row.legacy_type
    and crosswalk.legacy_key = row.legacy_key
    and crosswalk.mapping_state = 'matched'
    and row.row_state = 'pending';

  select count(*) filter (where row.row_state = 'invalid'),
    count(*) filter (where crosswalk.mapping_state = 'matched')
  into invalid_count, mapped_count
  from public.legacy_import_rows as row
  left join public.legacy_import_crosswalk as crosswalk
    on crosswalk.group_id = row.group_id
   and crosswalk.source_profile = job.profile_key
   and crosswalk.legacy_type = row.legacy_type
   and crosswalk.legacy_key = row.legacy_key
  where row.import_job_id = job.id;
  select count(*) into exception_count
  from public.legacy_import_exceptions as exception
  where exception.import_job_id = job.id;
  update public.legacy_import_jobs as import_job
  set state = case
      when invalid_count > 0 then 'blocked'::public.legacy_import_state
      when mapped_count = job.total_rows and exception_count = 0 then 'ready'::public.legacy_import_state
      else 'mapping_required'::public.legacy_import_state
    end,
    mapped_rows = mapped_count,
    exception_rows = exception_count,
    blocked_reason = case when invalid_count > 0 then 'The source contains duplicate or invalid legacy keys.' else null end,
    revision = import_job.revision + 1
  where import_job.id = job.id
  returning * into job;

  insert into public.audit_events (
    group_id, actor_user_id, action, target_type, target_id, target_version,
    after_state, source, correlation_id, operation_id
  ) values (
    job.group_id, p_actor_user_id, 'legacy_import.staged', 'legacy_import_job',
    job.id, job.revision,
    pg_catalog.jsonb_build_object(
      'import_job_id', job.id, 'profile_key', job.profile_key,
      'schema_version', job.schema_version, 'source_fingerprint', job.source_fingerprint,
      'state', job.state, 'total_rows', job.total_rows,
      'mapped_rows', job.mapped_rows, 'exception_rows', job.exception_rows
    ),
    'server', p_correlation_id, p_operation_id
  );

  return query select job.id, job.group_id, job.profile_key, job.state,
    job.total_rows, job.exception_rows, job.revision;
end;
$$;

comment on function public.create_legacy_import_job(uuid, uuid, text, text, text, jsonb, jsonb, uuid, uuid) is
  'Coordinator/administrator staging boundary for an explicitly profiled legacy export. It records a replay fingerprint, redacts sensitive payload keys, and never writes domain records.';

revoke all on function public.create_legacy_import_job(uuid, uuid, text, text, text, jsonb, jsonb, uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.create_legacy_import_job(uuid, uuid, text, text, text, jsonb, jsonb, uuid, uuid)
to service_role;

create function public.get_legacy_import_job(
  p_actor_user_id uuid,
  p_import_job_id uuid
)
returns table (
  import_job_id app.entity_id,
  group_id app.entity_id,
  profile_key text,
  schema_version text,
  state public.legacy_import_state,
  total_rows integer,
  mapped_rows integer,
  exception_rows integer,
  revision bigint,
  row_id app.entity_id,
  row_number integer,
  legacy_type text,
  legacy_key text,
  row_state public.legacy_import_row_state,
  mapping_state public.legacy_import_mapping_state,
  target_type text,
  target_id app.entity_id,
  exception_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_group_id uuid;
  job public.legacy_import_jobs%rowtype;
begin
  select actor.group_id into actor_group_id
  from app.resolve_legacy_import_actor(p_actor_user_id) as actor
  limit 1;
  if actor_group_id is null then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;
  select import_job.* into job
  from public.legacy_import_jobs as import_job
  where import_job.id = p_import_job_id
    and import_job.group_id = actor_group_id;
  if not found then
    raise exception 'legacy_import_not_found' using errcode = 'P0002';
  end if;
  return query
  select
    job.id,
    job.group_id,
    job.profile_key,
    job.schema_version,
    job.state,
    job.total_rows,
    job.mapped_rows,
    job.exception_rows,
    job.revision,
    row.id,
    row.row_number,
    row.legacy_type,
    row.legacy_key,
    row.row_state,
    crosswalk.mapping_state,
    crosswalk.target_type,
    crosswalk.target_id,
    (
      select count(*)::integer
      from public.legacy_import_exceptions as exception
      where exception.import_job_id = job.id
        and exception.row_id = row.id
    )
  from public.legacy_import_rows as row
  left join public.legacy_import_crosswalk as crosswalk
    on crosswalk.group_id = row.group_id
   and crosswalk.source_profile = job.profile_key
   and crosswalk.legacy_type = row.legacy_type
   and crosswalk.legacy_key = row.legacy_key
  where row.import_job_id = job.id
  order by row.row_number;
end;
$$;

comment on function public.get_legacy_import_job(uuid, uuid) is
  'Coordinator/administrator safe legacy-import projection. It returns keys, mapping state, and exception counts but never staged payload values.';

revoke all on function public.get_legacy_import_job(uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.get_legacy_import_job(uuid, uuid)
to service_role;

create function public.set_legacy_import_mapping(
  p_actor_user_id uuid,
  p_import_job_id uuid,
  p_row_id uuid,
  p_mapping_state text,
  p_target_type text,
  p_target_id uuid,
  p_mapping_method text,
  p_reason text,
  p_expected_revision bigint,
  p_correlation_id uuid,
  p_operation_id uuid
)
returns table (
  import_job_id app.entity_id,
  row_id app.entity_id,
  row_state public.legacy_import_row_state,
  mapping_state public.legacy_import_mapping_state,
  revision bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_group_id uuid;
  job public.legacy_import_jobs%rowtype;
  row_record public.legacy_import_rows%rowtype;
  crosswalk_record public.legacy_import_crosswalk%rowtype;
  prior_event public.audit_events%rowtype;
  normalized_state public.legacy_import_mapping_state;
  normalized_reason text;
  normalized_type text;
  normalized_method text;
  mapped_count integer;
  invalid_count integer;
  pending_count integer;
  next_job_state public.legacy_import_state;
begin
  if p_actor_user_id is null or p_import_job_id is null or p_row_id is null
    or p_expected_revision is null or p_expected_revision <= 0
    or p_correlation_id is null or p_operation_id is null
  then
    raise exception 'legacy_import_mapping_context_invalid' using errcode = '22023';
  end if;
  if nullif(pg_catalog.lower(pg_catalog.btrim(p_mapping_state)), '') is null
    or pg_catalog.lower(pg_catalog.btrim(p_mapping_state)) not in ('matched', 'ambiguous', 'rejected')
  then
    raise exception 'legacy_import_mapping_state_invalid' using errcode = '22023';
  end if;
  normalized_state := pg_catalog.lower(pg_catalog.btrim(p_mapping_state))::public.legacy_import_mapping_state;
  normalized_reason := nullif(pg_catalog.btrim(p_reason), '');
  if normalized_reason is null or length(normalized_reason) > 500 then
    raise exception 'legacy_import_mapping_reason_required' using errcode = '22023';
  end if;
  normalized_type := nullif(pg_catalog.btrim(p_target_type), '');
  normalized_method := nullif(pg_catalog.btrim(p_mapping_method), '');
  if normalized_state = 'matched' then
    if normalized_type is null or normalized_type !~ '^[a-z][a-z0-9_.-]{1,63}$'
      or p_target_id is null or normalized_method is null
      or normalized_method !~ '^[a-z][a-z0-9_.-]{1,63}$'
    then
      raise exception 'legacy_import_mapping_target_invalid' using errcode = '22023';
    end if;
  elsif p_target_id is not null or normalized_type is not null then
    raise exception 'legacy_import_mapping_target_invalid' using errcode = '22023';
  end if;

  select actor.group_id
  into actor_group_id
  from app.resolve_legacy_import_actor(p_actor_user_id) as actor
  limit 1;
  if actor_group_id is null then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;
  perform 1 from public.groups as group_record
  where group_record.id = actor_group_id
  for update;
  select import_job.* into job
  from public.legacy_import_jobs as import_job
  where import_job.id = p_import_job_id
    and import_job.group_id = actor_group_id
  for update;
  if not found then
    raise exception 'legacy_import_not_found' using errcode = 'P0002';
  end if;
  select event.* into prior_event
  from public.audit_events as event
  where event.group_id = job.group_id
    and event.actor_user_id = p_actor_user_id
    and event.action = 'legacy_import.mapping_set'
    and event.operation_id = p_operation_id;
  if found then
    if prior_event.target_id is distinct from p_row_id
      or prior_event.reason is distinct from normalized_reason
    then
      raise exception 'operation_id_reused' using errcode = '23505';
    end if;
    select row.* into row_record
    from public.legacy_import_rows as row
    where row.id = p_row_id and row.import_job_id = job.id;
    select crosswalk.* into crosswalk_record
    from public.legacy_import_crosswalk as crosswalk
    where crosswalk.group_id = job.group_id
      and crosswalk.source_profile = job.profile_key
      and crosswalk.legacy_type = row_record.legacy_type
      and crosswalk.legacy_key = row_record.legacy_key;
    return query select job.id, row_record.id, row_record.row_state,
      crosswalk_record.mapping_state, job.revision;
    return;
  end if;
  if job.revision <> p_expected_revision then
    raise exception 'legacy_import_revision_changed' using errcode = '40001';
  end if;
  if job.state in ('applying', 'completed') then
    raise exception 'legacy_import_mapping_locked' using errcode = 'P0001';
  end if;

  select row.* into row_record
  from public.legacy_import_rows as row
  where row.id = p_row_id and row.import_job_id = job.id and row.group_id = job.group_id
  for update;
  if not found then
    raise exception 'legacy_import_row_not_found' using errcode = 'P0002';
  end if;
  select crosswalk.* into crosswalk_record
  from public.legacy_import_crosswalk as crosswalk
  where crosswalk.group_id = job.group_id
    and crosswalk.source_profile = job.profile_key
    and crosswalk.legacy_type = row_record.legacy_type
    and crosswalk.legacy_key = row_record.legacy_key
  for update;
  if not found then
    raise exception 'legacy_import_crosswalk_not_found' using errcode = 'P0002';
  end if;

  update public.legacy_import_crosswalk
  set mapping_state = normalized_state,
      target_type = normalized_type,
      target_id = case when normalized_state = 'matched' then p_target_id else null end,
      mapping_method = normalized_method,
      decision_reason = normalized_reason
  where id = crosswalk_record.id
  returning * into crosswalk_record;
  update public.legacy_import_rows
  set row_state = case normalized_state
      when 'matched' then 'mapped'::public.legacy_import_row_state
      when 'ambiguous' then 'ambiguous'::public.legacy_import_row_state
      else 'invalid'::public.legacy_import_row_state
    end
  where id = row_record.id
  returning * into row_record;

  if normalized_state in ('ambiguous', 'rejected') then
    insert into public.legacy_import_exceptions (
      import_job_id, group_id, row_id, row_number, severity, code, message, safe_details
    ) values (
      job.id, job.group_id, row_record.id, row_record.row_number, 'warning',
      case when normalized_state = 'ambiguous' then 'mapping_ambiguous' else 'mapping_rejected' end,
      case when normalized_state = 'ambiguous'
        then 'The legacy row needs an identity decision before you continue.'
        else 'The legacy row is excluded until you approve a mapping.' end,
      pg_catalog.jsonb_build_object('decision_reason', normalized_reason)
    );
  end if;

  select count(*) filter (where crosswalk.mapping_state = 'matched'),
    count(*) filter (where row.row_state in ('invalid', 'ambiguous')),
    count(*) filter (where crosswalk.mapping_state <> 'matched')
  into mapped_count, invalid_count, pending_count
  from public.legacy_import_rows as row
  join public.legacy_import_crosswalk as crosswalk
    on crosswalk.group_id = row.group_id
   and crosswalk.source_profile = job.profile_key
   and crosswalk.legacy_type = row.legacy_type
   and crosswalk.legacy_key = row.legacy_key
  where row.import_job_id = job.id;
  next_job_state := case
    when invalid_count > 0 then 'mapping_required'::public.legacy_import_state
    when pending_count > 0 then 'mapping_required'::public.legacy_import_state
    else 'ready'::public.legacy_import_state
  end;
  update public.legacy_import_jobs as import_job
  set state = next_job_state,
      mapped_rows = mapped_count,
      revision = import_job.revision + 1
  where import_job.id = job.id
  returning * into job;

  insert into public.audit_events (
    group_id, actor_user_id, action, target_type, target_id, target_version,
    after_state, source, correlation_id, operation_id, reason
  ) values (
    job.group_id, p_actor_user_id, 'legacy_import.mapping_set',
    'legacy_import_crosswalk', crosswalk_record.id, job.revision,
    pg_catalog.jsonb_build_object(
      'import_job_id', job.id, 'row_id', row_record.id,
      'mapping_state', crosswalk_record.mapping_state,
      'target_type', crosswalk_record.target_type,
      'target_id', crosswalk_record.target_id,
      'mapping_method', crosswalk_record.mapping_method,
      'state', job.state, 'mapped_rows', job.mapped_rows
    ),
    'server', p_correlation_id, p_operation_id, normalized_reason
  );
  return query select job.id, row_record.id, row_record.row_state,
    crosswalk_record.mapping_state, job.revision;
end;
$$;

comment on function public.set_legacy_import_mapping(uuid, uuid, uuid, text, text, uuid, text, text, bigint, uuid, uuid) is
  'Coordinator/administrator mapping decision boundary. It records a target only after an explicit decision and remains restartable through operation idempotency.';

revoke all on function public.set_legacy_import_mapping(uuid, uuid, uuid, text, text, uuid, text, text, bigint, uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.set_legacy_import_mapping(uuid, uuid, uuid, text, text, uuid, text, text, bigint, uuid, uuid)
to service_role;
