-- Phase 02: asynchronous, all-or-nothing member CSV import.
--
-- The source payload and parsed values are deliberately kept in force-RLS
-- tables with no client grants.  Only the trusted server worker can run the
-- lease/validation/apply boundaries.  Raw invitation tokens are never stored;
-- apply receives only a worker-generated digest, key version, and expiry.

create type public.member_csv_import_state as enum (
  'uploaded',
  'validating',
  'ready',
  'rejected',
  'applying',
  'completed'
);

create type public.member_csv_import_row_state as enum (
  'pending',
  'valid',
  'invalid',
  'skipped_existing',
  'applied',
  'apply_failed'
);

create type public.member_handicap_source as enum ('manual', 'import');

create table public.member_csv_import_jobs (
  id app.entity_id primary key default extensions.gen_random_uuid(),
  group_id app.entity_id not null references public.groups (id) on delete restrict,
  source_fingerprint text not null,
  state public.member_csv_import_state not null default 'uploaded',
  actor_user_id app.entity_id not null references auth.users (id) on delete restrict,
  actor_role public.membership_role not null,
  total_rows integer not null default 0,
  valid_rows integer not null default 0,
  invalid_rows integer not null default 0,
  skipped_rows integer not null default 0,
  applied_rows integer not null default 0,
  revision bigint not null default 1,
  quota_settings_version bigint not null default 0,
  lease_owner uuid,
  lease_expires_at app.utc_instant,
  uploaded_at app.utc_instant not null default pg_catalog.clock_timestamp(),
  validation_started_at app.utc_instant,
  validated_at app.utc_instant,
  apply_started_at app.utc_instant,
  apply_requested_at app.utc_instant,
  apply_confirmed_by app.entity_id references auth.users (id) on delete restrict,
  apply_operation_id uuid,
  apply_reason text,
  completed_at app.utc_instant,
  created_at app.utc_instant not null default pg_catalog.clock_timestamp(),
  updated_at app.utc_instant not null default pg_catalog.clock_timestamp(),
  constraint member_csv_import_jobs_id_group_unique unique (id, group_id),
  constraint member_csv_import_jobs_fingerprint_valid check (source_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint member_csv_import_jobs_counts_nonnegative check (
    total_rows >= 0 and valid_rows >= 0 and invalid_rows >= 0
    and skipped_rows >= 0 and applied_rows >= 0
  ),
  constraint member_csv_import_jobs_revision_positive check (revision > 0),
  constraint member_csv_import_jobs_quota_settings_version_nonnegative check (quota_settings_version >= 0),
  constraint member_csv_import_jobs_count_sum check (valid_rows + invalid_rows + skipped_rows <= total_rows),
  constraint member_csv_import_jobs_lease_consistent check (lease_expires_at is null or lease_owner is not null),
  constraint member_csv_import_jobs_apply_reason_valid check (apply_reason is null or length(apply_reason) <= 500)
);

create unique index member_csv_import_jobs_group_fingerprint_idx
  on public.member_csv_import_jobs (group_id, source_fingerprint);
create index member_csv_import_jobs_claim_idx
  on public.member_csv_import_jobs (state, lease_expires_at, created_at);
create index member_csv_import_jobs_group_created_idx
  on public.member_csv_import_jobs (group_id, created_at desc);

create trigger member_csv_import_jobs_immutable_id
before update of id on public.member_csv_import_jobs
for each row execute function app.reject_id_change('id');
create trigger member_csv_import_jobs_immutable_group
before update of group_id on public.member_csv_import_jobs
for each row execute function app.reject_id_change('group_id');
create trigger member_csv_import_jobs_set_updated_at
before update on public.member_csv_import_jobs
for each row execute function app.set_updated_at();

create table public.member_csv_import_rows (
  id app.entity_id primary key default extensions.gen_random_uuid(),
  import_job_id app.entity_id not null,
  group_id app.entity_id not null references public.groups (id) on delete restrict,
  row_number integer not null,
  raw_payload jsonb not null,
  row_state public.member_csv_import_row_state not null default 'pending',
  error_codes jsonb not null default '[]'::jsonb,
  first_name text,
  last_name text,
  invited_email text,
  invited_email_normalized text,
  spouse_first_name text,
  spouse_last_name text,
  secondary_email text,
  home_phone text,
  work_phone text,
  mobile_phone text,
  address_line1 text,
  address_line2 text,
  city text,
  state_region text,
  postal_code text,
  country text,
  tee_location text,
  dues_paid boolean not null default false,
  secondary_email_visible boolean not null default false,
  home_phone_visible boolean not null default false,
  work_phone_visible boolean not null default false,
  mobile_phone_visible boolean not null default false,
  address_listed boolean not null default false,
  initial_quota app.quota_value,
  use_initial_quota boolean not null default false,
  seed_totals jsonb not null default '[]'::jsonb,
  seed_positions jsonb not null default '[]'::jsonb,
  handicap_id text,
  handicap app.handicap_value,
  handicap_as_of date,
  membership_id app.entity_id,
  invitation_id app.entity_id,
  created_at app.utc_instant not null default pg_catalog.clock_timestamp(),
  updated_at app.utc_instant not null default pg_catalog.clock_timestamp(),
  constraint member_csv_import_rows_id_group_unique unique (id, group_id),
  constraint member_csv_import_rows_job_group_fk
    foreign key (import_job_id, group_id)
    references public.member_csv_import_jobs (id, group_id)
    on delete cascade,
  constraint member_csv_import_rows_row_number_valid check (row_number > 1),
  constraint member_csv_import_rows_payload_object check (jsonb_typeof(raw_payload) = 'object'),
  constraint member_csv_import_rows_errors_array check (jsonb_typeof(error_codes) = 'array'),
  constraint member_csv_import_rows_seed_array check (jsonb_typeof(seed_totals) = 'array'),
  constraint member_csv_import_rows_seed_positions_array check (jsonb_typeof(seed_positions) = 'array'),
  constraint member_csv_import_rows_email_consistent check (
    invited_email is null or invited_email_normalized = lower(btrim(invited_email))
  ),
  constraint member_csv_import_rows_initial_quota_consistent check (
    use_initial_quota = false or initial_quota is not null
  ),
  constraint member_csv_import_rows_handicap_id_valid check (
    handicap_id is null or (btrim(handicap_id) = handicap_id and length(handicap_id) between 1 and 100)
  )
);

create unique index member_csv_import_rows_job_row_idx
  on public.member_csv_import_rows (import_job_id, row_number);
create index member_csv_import_rows_job_state_idx
  on public.member_csv_import_rows (import_job_id, row_state, row_number);
create index member_csv_import_rows_group_email_idx
  on public.member_csv_import_rows (group_id, invited_email_normalized);
create trigger member_csv_import_rows_immutable_id
before update of id on public.member_csv_import_rows
for each row execute function app.reject_id_change('id');
create trigger member_csv_import_rows_immutable_group
before update of group_id on public.member_csv_import_rows
for each row execute function app.reject_id_change('group_id');
create trigger member_csv_import_rows_set_updated_at
before update on public.member_csv_import_rows
for each row execute function app.set_updated_at();

create table public.membership_handicap_records (
  id app.entity_id primary key default extensions.gen_random_uuid(),
  membership_id app.entity_id not null,
  group_id app.entity_id not null,
  handicap_id text,
  handicap app.handicap_value not null,
  source public.member_handicap_source not null,
  as_of date not null,
  created_at app.utc_instant not null default pg_catalog.clock_timestamp(),
  constraint membership_handicap_records_id_group_unique unique (id, group_id),
  constraint membership_handicap_records_membership_group_fk
    foreign key (membership_id, group_id)
    references public.memberships (id, group_id)
    on delete restrict,
  constraint membership_handicap_records_handicap_id_valid check (
    handicap_id is null or (btrim(handicap_id) = handicap_id and length(handicap_id) between 1 and 100)
  )
);
create index membership_handicap_records_group_membership_idx
  on public.membership_handicap_records (group_id, membership_id, as_of desc);
create trigger membership_handicap_records_immutable_id
before update of id on public.membership_handicap_records
for each row execute function app.reject_id_change('id');
create trigger membership_handicap_records_immutable_group
before update of group_id on public.membership_handicap_records
for each row execute function app.reject_id_change('group_id');

alter table public.member_csv_import_jobs enable row level security;
alter table public.member_csv_import_jobs force row level security;
alter table public.member_csv_import_rows enable row level security;
alter table public.member_csv_import_rows force row level security;
alter table public.membership_handicap_records enable row level security;
alter table public.membership_handicap_records force row level security;

revoke all on table
  public.member_csv_import_jobs,
  public.member_csv_import_rows,
  public.membership_handicap_records
from public, anon, authenticated, service_role;
-- No raw-table grant, including service_role: worker/server code uses only
-- the narrow RPC boundaries below, while SECURITY DEFINER functions perform
-- their own tenant and lease checks under the database owner.

-- Resolve only a live, confirmed coordinator/administrator.  The group is
-- always taken from membership; no RPC accepts a client-supplied tenant.
create function app.resolve_csv_import_actor(p_actor_user_id uuid)
returns table (group_id app.entity_id, membership_id app.entity_id, actor_role public.membership_role)
language sql stable security definer set search_path = ''
as $$
  select membership.group_id, membership.id, membership.role
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
revoke all on function app.resolve_csv_import_actor(uuid) from public, anon, authenticated;

create function public.create_member_csv_import(
  p_actor_user_id uuid,
  p_import_job_id uuid,
  p_source_fingerprint text,
  p_rows jsonb,
  p_correlation_id uuid,
  p_operation_id uuid
)
returns table (
  import_job_id app.entity_id,
  group_id app.entity_id,
  state public.member_csv_import_state,
  total_rows integer,
  revision bigint
)
language plpgsql security definer set search_path = ''
as $$
declare
  actor_group_id uuid;
  actor_role public.membership_role;
  existing public.member_csv_import_jobs%rowtype;
  job public.member_csv_import_jobs%rowtype;
  item jsonb;
  sanitized_item jsonb;
  row_no integer := 1;
begin
  if p_actor_user_id is null or p_import_job_id is null or p_correlation_id is null or p_operation_id is null
    or p_rows is null or pg_catalog.jsonb_typeof(p_rows) <> 'array'
  then raise exception 'member_csv_import_input_invalid' using errcode = '22023'; end if;
  if pg_catalog.lower(coalesce(p_source_fingerprint, '')) !~ '^[0-9a-f]{64}$' then
    raise exception 'member_csv_import_fingerprint_invalid' using errcode = '22023';
  end if;
  select membership.group_id into actor_group_id
  from public.memberships as membership
  where membership.user_id = p_actor_user_id;
  if actor_group_id is null then raise exception 'actor_not_authorized' using errcode = 'P0003'; end if;
  perform 1 from public.groups as group_row where group_row.id = actor_group_id for update;
  select actor.group_id, actor.actor_role into actor_group_id, actor_role
  from app.resolve_csv_import_actor(p_actor_user_id) as actor
  limit 1;
  if actor_role is null then raise exception 'actor_not_authorized' using errcode = 'P0003'; end if;
  if pg_catalog.jsonb_array_length(p_rows) = 0 or pg_catalog.jsonb_array_length(p_rows) > 500 then
    raise exception 'member_csv_import_row_count_invalid' using errcode = '22023';
  end if;
  if actor_role = 'coordinator' and exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_rows) as item(value)
    where nullif(pg_catalog.btrim(item.value ->> 'initial_quota'), '') is not null
      or lower(coalesce(item.value ->> 'use_initial_quota', '')) = 'true'
      or exists (
        select 1
        from pg_catalog.jsonb_each(item.value) as field(key, value)
        where field.key like 'seed_total_%'
          and nullif(pg_catalog.btrim(field.value #>> '{}'), '') is not null
      )
  ) then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;
  select * into existing from public.member_csv_import_jobs as import_job
  where import_job.group_id = actor_group_id and import_job.source_fingerprint = pg_catalog.lower(p_source_fingerprint)
  for update;
  if found then
    return query select existing.id, existing.group_id, existing.state, existing.total_rows, existing.revision;
    return;
  end if;
  insert into public.member_csv_import_jobs (id, group_id, source_fingerprint, actor_user_id, actor_role, total_rows)
  values (p_import_job_id, actor_group_id, pg_catalog.lower(p_source_fingerprint), p_actor_user_id, actor_role, pg_catalog.jsonb_array_length(p_rows))
  returning * into job;
  for item in select value from pg_catalog.jsonb_array_elements(p_rows) as e(value) loop
    if pg_catalog.jsonb_typeof(item) <> 'object' then
      raise exception 'member_csv_import_row_payload_invalid' using errcode = '22023';
    end if;
    -- Persist only the parser's approved fields. Unknown keys (including any
    -- attempted status/role override or raw invitation token) are discarded
    -- before the force-RLS row is written.
    select coalesce(pg_catalog.jsonb_object_agg(entry.key, entry.value), '{}'::jsonb)
      into sanitized_item
    from pg_catalog.jsonb_each(item) as entry(key, value)
    where entry.key in (
      'first_name','last_name','invited_email','spouse_first_name','spouse_last_name',
      'secondary_email','home_phone','work_phone','mobile_phone','address_line1','address_line2',
      'city','state_region','postal_code','country','tee_location','dues_paid',
      'secondary_email_visible','home_phone_visible','work_phone_visible','mobile_phone_visible',
      'address_listed','initial_quota','use_initial_quota','handicap_id','handicap','handicap_as_of',
      'seed_total_1','seed_total_2','seed_total_3','seed_total_4','seed_total_5','seed_total_6',
      'seed_total_7','seed_total_8','seed_total_9','seed_total_10','seed_total_11','seed_total_12',
      'seed_total_13','seed_total_14','seed_total_15','seed_total_16','seed_total_17','seed_total_18',
      'seed_total_19','seed_total_20'
    );
    insert into public.member_csv_import_rows (import_job_id, group_id, row_number, raw_payload)
    values (job.id, job.group_id, row_no + 1, sanitized_item);
    row_no := row_no + 1;
  end loop;
  insert into public.audit_events (
    group_id, actor_user_id, action, target_type, target_id, target_version,
    after_state, source, correlation_id, operation_id
  ) values (
    actor_group_id, p_actor_user_id, 'member_csv_import.uploaded', 'member_csv_import', job.id, job.revision,
    pg_catalog.jsonb_build_object('import_job_id', job.id, 'source_fingerprint', job.source_fingerprint, 'total_rows', job.total_rows),
    'server', p_correlation_id, p_operation_id
  );
  return query select job.id, job.group_id, job.state, job.total_rows, job.revision;
end;
$$;
comment on function public.create_member_csv_import(uuid, uuid, text, jsonb, uuid, uuid) is
  'Coordinator/administrator upload boundary. Parsed row payloads remain service-only and source fingerprint is the replay key.';
revoke all on function public.create_member_csv_import(uuid, uuid, text, jsonb, uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.create_member_csv_import(uuid, uuid, text, jsonb, uuid, uuid) to service_role;

create function public.claim_member_csv_import(
  p_import_job_id uuid,
  p_worker_id uuid,
  p_lease_seconds integer default 300
)
returns table (
  claimed_job_id app.entity_id,
  group_id app.entity_id,
  state public.member_csv_import_state,
  revision bigint,
  lease_expires_at app.utc_instant
)
language plpgsql security definer set search_path = ''
as $$
declare
  job public.member_csv_import_jobs%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_import_job_id is null or p_worker_id is null or p_lease_seconds not between 30 and 3600 then
    raise exception 'member_csv_import_claim_input_invalid' using errcode = '22023';
  end if;
  select * into job from public.member_csv_import_jobs where id = p_import_job_id for update;
  if not found then raise exception 'member_csv_import_not_found' using errcode = 'P0002'; end if;
  if job.state <> 'uploaded' then
    raise exception 'member_csv_import_not_claimable' using errcode = 'P0001';
  end if;
  update public.member_csv_import_jobs
  set state = 'validating', lease_owner = p_worker_id,
      lease_expires_at = v_now + pg_catalog.make_interval(secs => p_lease_seconds),
      validation_started_at = v_now, revision = public.member_csv_import_jobs.revision + 1
  where id = job.id
  returning * into job;
  return query select job.id, job.group_id, job.state, job.revision, job.lease_expires_at;
end;
$$;
comment on function public.claim_member_csv_import(uuid, uuid, integer) is
  'Service-only worker lease. It permits only Uploaded -> Validating.';
revoke all on function public.claim_member_csv_import(uuid, uuid, integer)
from public, anon, authenticated, service_role;
grant execute on function public.claim_member_csv_import(uuid, uuid, integer) to service_role;

create function public.recover_stale_member_csv_import(
  p_import_job_id uuid,
  p_worker_id uuid
)
returns table (
  recovered_job_id app.entity_id,
  previous_state public.member_csv_import_state,
  state public.member_csv_import_state,
  revision bigint
)
language plpgsql security definer set search_path = ''
as $$
declare
  job public.member_csv_import_jobs%rowtype;
  prior public.member_csv_import_state;
begin
  if p_import_job_id is null or p_worker_id is null then raise exception 'member_csv_import_recovery_input_invalid' using errcode = '22023'; end if;
  select * into job from public.member_csv_import_jobs where id = p_import_job_id for update;
  if not found then raise exception 'member_csv_import_not_found' using errcode = 'P0002'; end if;
  if job.lease_owner is distinct from p_worker_id
    or job.lease_expires_at is null or job.lease_expires_at > pg_catalog.clock_timestamp()
  then raise exception 'member_csv_import_lease_not_stale' using errcode = 'P0001'; end if;
  prior := job.state;
  if prior = 'validating' then
    update public.member_csv_import_jobs set state = 'uploaded', lease_owner = null, lease_expires_at = null,
      validation_started_at = null, revision = public.member_csv_import_jobs.revision + 1 where id = job.id returning * into job;
  elsif prior = 'applying' then
    update public.member_csv_import_jobs set state = 'ready', lease_owner = null, lease_expires_at = null,
      apply_started_at = null, revision = public.member_csv_import_jobs.revision + 1 where id = job.id returning * into job;
  else
    raise exception 'member_csv_import_state_not_recoverable' using errcode = 'P0001';
  end if;
  return query select job.id, prior, job.state, job.revision;
end;
$$;
comment on function public.recover_stale_member_csv_import(uuid, uuid) is
  'Service-only stale lease recovery: Validating -> Uploaded or Applying -> Ready.';
revoke all on function public.recover_stale_member_csv_import(uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.recover_stale_member_csv_import(uuid, uuid) to service_role;

-- Settings drift invalidates the prior validation/confirmation.  This helper
-- performs the complete requeue in the same transaction as the boundary that
-- discovered the drift, so a fingerprint replay can be claimed again instead
-- of leaving a Ready/Applying job permanently wedged.
create function app.requeue_member_csv_import_for_settings(
  p_import_job_id uuid,
  p_settings_version bigint,
  p_actor_user_id uuid,
  p_correlation_id uuid,
  p_source text
)
returns public.member_csv_import_jobs
language plpgsql security definer set search_path = ''
as $$
declare
  job public.member_csv_import_jobs%rowtype;
begin
  if p_import_job_id is null or p_settings_version is null or p_settings_version < 0
    or p_actor_user_id is null or p_correlation_id is null
  then
    raise exception 'member_csv_import_requeue_input_invalid' using errcode = '22023';
  end if;
  update public.member_csv_import_jobs
  set state = 'uploaded', valid_rows = 0, invalid_rows = 0, skipped_rows = 0, applied_rows = 0,
      quota_settings_version = p_settings_version,
      lease_owner = null, lease_expires_at = null,
      validation_started_at = null, validated_at = null, apply_started_at = null,
      apply_requested_at = null, apply_confirmed_by = null, apply_operation_id = null,
      apply_reason = null, completed_at = null,
      revision = public.member_csv_import_jobs.revision + 1
  where id = p_import_job_id
  returning * into job;
  if not found then raise exception 'member_csv_import_not_found' using errcode = 'P0002'; end if;

  update public.member_csv_import_rows
  set row_state = 'pending', error_codes = '[]'::jsonb,
      membership_id = null, invitation_id = null
  where import_job_id = job.id;

  insert into public.audit_events (
    group_id, actor_user_id, action, target_type, target_id, target_version,
    after_state, source, correlation_id
  ) values (
    job.group_id, p_actor_user_id, 'member_csv_import.settings_drift_requeued',
    'member_csv_import', job.id, job.revision,
    pg_catalog.jsonb_build_object(
      'import_job_id', job.id, 'state', job.state,
      'settings_version', p_settings_version, 'source', coalesce(p_source, 'server')
    ), 'server', p_correlation_id
  );
  return job;
end;
$$;
revoke all on function app.requeue_member_csv_import_for_settings(uuid, bigint, uuid, uuid, text)
from public, anon, authenticated, service_role;

create function public.validate_member_csv_import(
  p_import_job_id uuid,
  p_worker_id uuid
)
returns table (validated_job_id app.entity_id, state public.member_csv_import_state, revision bigint)
language plpgsql security definer set search_path = ''
as $$
declare
  job public.member_csv_import_jobs%rowtype;
  row public.member_csv_import_rows%rowtype;
  value text;
  errors jsonb;
  seed_values jsonb := '[]'::jsonb;
  seed_positions jsonb := '[]'::jsonb;
  seed_value text;
  settings_version bigint;
begin
  select * into job from public.member_csv_import_jobs where id = p_import_job_id for update;
  if not found then raise exception 'member_csv_import_not_found' using errcode = 'P0002'; end if;
  perform group_row.id from public.groups as group_row where group_row.id = job.group_id for update;
  if job.state <> 'validating' or job.lease_owner is distinct from p_worker_id
    or job.lease_expires_at is null or job.lease_expires_at <= pg_catalog.clock_timestamp()
  then raise exception 'member_csv_import_lease_invalid' using errcode = 'P0001'; end if;

  -- The group row is locked for the complete validation window.  Quota-rule
  -- updates use the same lock, so the version captured here is the version
  -- every row in this file was validated against.
  select version
    into settings_version
  from public.group_quota_settings as quota_settings
  where quota_settings.group_id = job.group_id;
  update public.member_csv_import_jobs
  set quota_settings_version = coalesce(settings_version, 0)
  where id = job.id;

  -- Validation is deliberately lexical before domain casts, preserving exact
  -- decimal meaning and rejecting exponent/whitespace forms.
  for row in select * from public.member_csv_import_rows where import_job_id = job.id order by row_number for update loop
    errors := '[]'::jsonb;
    row.first_name := nullif(pg_catalog.btrim(row.raw_payload ->> 'first_name'), '');
    row.last_name := nullif(pg_catalog.btrim(row.raw_payload ->> 'last_name'), '');
    row.invited_email := nullif(pg_catalog.btrim(row.raw_payload ->> 'invited_email'), '');
    if row.first_name is null or length(row.first_name) > 100 then errors := errors || jsonb_build_array(jsonb_build_object('code','required','column','first_name')); end if;
    if row.last_name is null or length(row.last_name) > 100 then errors := errors || jsonb_build_array(jsonb_build_object('code','required','column','last_name')); end if;
    if row.invited_email is null or length(row.invited_email) not between 3 and 320
      or row.invited_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    then errors := errors || jsonb_build_array(jsonb_build_object('code','invalid_email','column','invited_email')); end if;
    row.invited_email_normalized := case when row.invited_email is null then null else lower(row.invited_email) end;

    row.spouse_first_name := nullif(btrim(row.raw_payload ->> 'spouse_first_name'), '');
    row.spouse_last_name := nullif(btrim(row.raw_payload ->> 'spouse_last_name'), '');
    row.secondary_email := nullif(btrim(row.raw_payload ->> 'secondary_email'), '');
    row.home_phone := nullif(btrim(row.raw_payload ->> 'home_phone'), '');
    row.work_phone := nullif(btrim(row.raw_payload ->> 'work_phone'), '');
    row.mobile_phone := nullif(btrim(row.raw_payload ->> 'mobile_phone'), '');
    row.address_line1 := nullif(btrim(row.raw_payload ->> 'address_line1'), '');
    row.address_line2 := nullif(btrim(row.raw_payload ->> 'address_line2'), '');
    row.city := nullif(btrim(row.raw_payload ->> 'city'), '');
    row.state_region := nullif(btrim(row.raw_payload ->> 'state_region'), '');
    row.postal_code := nullif(btrim(row.raw_payload ->> 'postal_code'), '');
    row.country := nullif(btrim(row.raw_payload ->> 'country'), '');
    row.tee_location := nullif(lower(btrim(row.raw_payload ->> 'tee_location')), '');
    row.handicap_id := nullif(btrim(row.raw_payload ->> 'handicap_id'), '');
    if row.handicap_id is not null and length(row.handicap_id) > 100 then
      errors := errors || jsonb_build_array(jsonb_build_object('code','invalid_handicap_id','column','handicap_id'));
      row.handicap_id := null;
    end if;
    value := nullif(btrim(row.raw_payload ->> 'handicap_as_of'), '');
    row.handicap_as_of := null;
    if value is not null and value !~ '^\d{4}-\d{2}-\d{2}$' then errors := errors || jsonb_build_array(jsonb_build_object('code','invalid_date','column','handicap_as_of'));
    elsif value is not null then begin row.handicap_as_of := value::date; exception when others then errors := errors || jsonb_build_array(jsonb_build_object('code','invalid_date','column','handicap_as_of')); end; end if;
    value := nullif(btrim(row.raw_payload ->> 'handicap'), '');
    row.handicap := null;
    if value is not null and value !~ '^[+-]?\d+(\.\d)?$' then errors := errors || jsonb_build_array(jsonb_build_object('code','invalid_number','column','handicap'));
    elsif value is not null then begin row.handicap := value::app.handicap_value; exception when others then errors := errors || jsonb_build_array(jsonb_build_object('code','invalid_number','column','handicap')); end; end if;
    if (row.handicap_id is not null or row.handicap_as_of is not null) and row.handicap is null then errors := errors || jsonb_build_array(jsonb_build_object('code','handicap_value_required','column','handicap')); end if;
    if row.handicap is not null and row.handicap_as_of is null then errors := errors || jsonb_build_array(jsonb_build_object('code','handicap_as_of_required','column','handicap_as_of')); end if;

    -- Validate optional bounded display fields.
    if row.secondary_email is not null and (length(row.secondary_email) not between 3 and 320 or row.secondary_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then errors := errors || jsonb_build_array(jsonb_build_object('code','invalid_email','column','secondary_email')); end if;
    if row.tee_location is not null and row.tee_location not in ('pro','back','middle','front') then errors := errors || jsonb_build_array(jsonb_build_object('code','invalid_tee','column','tee_location')); end if;
    if (row.spouse_first_name is not null and length(row.spouse_first_name) > 100) or (row.spouse_last_name is not null and length(row.spouse_last_name) > 100) then errors := errors || jsonb_build_array(jsonb_build_object('code','invalid_name','column','spouse')); end if;
    if (row.home_phone is not null and length(row.home_phone) > 64) or (row.work_phone is not null and length(row.work_phone) > 64) or (row.mobile_phone is not null and length(row.mobile_phone) > 64) then errors := errors || jsonb_build_array(jsonb_build_object('code','invalid_phone','column','phone')); end if;
    if (row.address_line1 is not null and length(row.address_line1) > 200) or (row.address_line2 is not null and length(row.address_line2) > 200) or (row.city is not null and length(row.city) > 100) or (row.state_region is not null and length(row.state_region) > 100) or (row.postal_code is not null and length(row.postal_code) > 32) or (row.country is not null and length(row.country) > 100) then errors := errors || jsonb_build_array(jsonb_build_object('code','invalid_address','column','address')); end if;

    -- Booleans are parser-normalized JSON booleans or blank strings only.
    if lower(coalesce(row.raw_payload ->> 'dues_paid','')) not in ('','true','false') then errors := errors || jsonb_build_array(jsonb_build_object('code','invalid_boolean','column','dues_paid')); end if;
    if lower(coalesce(row.raw_payload ->> 'use_initial_quota','')) not in ('','true','false') then errors := errors || jsonb_build_array(jsonb_build_object('code','invalid_boolean','column','use_initial_quota')); end if;
    if lower(coalesce(row.raw_payload ->> 'secondary_email_visible','')) not in ('','true','false') then errors := errors || jsonb_build_array(jsonb_build_object('code','invalid_boolean','column','secondary_email_visible')); end if;
    if lower(coalesce(row.raw_payload ->> 'home_phone_visible','')) not in ('','true','false') then errors := errors || jsonb_build_array(jsonb_build_object('code','invalid_boolean','column','home_phone_visible')); end if;
    if lower(coalesce(row.raw_payload ->> 'work_phone_visible','')) not in ('','true','false') then errors := errors || jsonb_build_array(jsonb_build_object('code','invalid_boolean','column','work_phone_visible')); end if;
    if lower(coalesce(row.raw_payload ->> 'mobile_phone_visible','')) not in ('','true','false') then errors := errors || jsonb_build_array(jsonb_build_object('code','invalid_boolean','column','mobile_phone_visible')); end if;
    if lower(coalesce(row.raw_payload ->> 'address_listed','')) not in ('','true','false') then errors := errors || jsonb_build_array(jsonb_build_object('code','invalid_boolean','column','address_listed')); end if;
    row.dues_paid := lower(coalesce(row.raw_payload ->> 'dues_paid','')) = 'true';
    row.use_initial_quota := case
      when nullif(lower(pg_catalog.btrim(row.raw_payload ->> 'use_initial_quota')), '') is null
        then nullif(pg_catalog.btrim(row.raw_payload ->> 'initial_quota'), '') is not null
      else lower(pg_catalog.btrim(row.raw_payload ->> 'use_initial_quota')) = 'true'
    end;
    row.secondary_email_visible := lower(coalesce(row.raw_payload ->> 'secondary_email_visible','')) = 'true';
    row.home_phone_visible := lower(coalesce(row.raw_payload ->> 'home_phone_visible','')) = 'true';
    row.work_phone_visible := lower(coalesce(row.raw_payload ->> 'work_phone_visible','')) = 'true';
    row.mobile_phone_visible := lower(coalesce(row.raw_payload ->> 'mobile_phone_visible','')) = 'true';
    row.address_listed := lower(coalesce(row.raw_payload ->> 'address_listed','')) = 'true';

    value := nullif(btrim(row.raw_payload ->> 'initial_quota'), ''); row.initial_quota := null;
    if value is not null and value !~ '^\+?\d+(\.\d{1,2})?$' then errors := errors || jsonb_build_array(jsonb_build_object('code','invalid_number','column','initial_quota'));
    elsif value is not null then begin row.initial_quota := value::app.quota_value; exception when others then errors := errors || jsonb_build_array(jsonb_build_object('code','invalid_number','column','initial_quota')); end; end if;
    if row.use_initial_quota and row.initial_quota is null then errors := errors || jsonb_build_array(jsonb_build_object('code','initial_quota_required','column','initial_quota')); end if;
    -- Keep the persisted row shape compatible with the table invariant when
    -- a requested initial value itself is malformed; the error code above
    -- still rejects the row, but the invalid value never leaves a null quota
    -- paired with a true freeze flag.
    if row.initial_quota is null then row.use_initial_quota := false; end if;

    seed_values := '[]'::jsonb;
    seed_positions := '[]'::jsonb;
    for i in 1..20 loop
      seed_value := nullif(btrim(row.raw_payload ->> ('seed_total_' || i::text)), '');
      if seed_value is null then continue; end if;
      if seed_value !~ '^\+?\d+(\.\d{1,2})?$' then
        errors := errors || jsonb_build_array(jsonb_build_object('code','invalid_number','column','seed_total_' || i::text));
      else
        begin perform seed_value::app.golf_points_value; exception when others then errors := errors || jsonb_build_array(jsonb_build_object('code','invalid_number','column','seed_total_' || i::text)); end;
      end if;
      seed_values := seed_values || jsonb_build_array(seed_value);
      seed_positions := seed_positions || jsonb_build_array(i);
    end loop;
    row.seed_totals := seed_values;
    row.seed_positions := seed_positions;
    if settings_version is null and (
      nullif(pg_catalog.btrim(row.raw_payload ->> 'initial_quota'), '') is not null
      or lower(pg_catalog.btrim(row.raw_payload ->> 'use_initial_quota')) = 'true'
      or jsonb_array_length(seed_values) > 0
    ) then
      errors := errors || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('code','quota_settings_required','column','initial_quota')
      );
    end if;
    if row.initial_quota is not null and exists (select 1 from public.group_quota_settings as quota_settings where quota_settings.group_id = job.group_id
      and round(row.initial_quota::numeric, 2) <> round(row.initial_quota::numeric, quota_settings.precision)) then
      errors := errors || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('code','quota_precision_invalid','column','initial_quota'));
    end if;

    if row.invited_email_normalized is not null and (
      exists (
        select 1 from public.memberships as existing_membership
        join auth.users as identity on identity.id = existing_membership.user_id
        where existing_membership.group_id = job.group_id
          and lower(identity.email) = row.invited_email_normalized
      )
      or exists (
        select 1 from public.membership_invitations as pending_invite
        where pending_invite.group_id = job.group_id
          and pending_invite.status = 'pending'
          and pending_invite.invited_email_normalized = row.invited_email_normalized
      )
    ) and jsonb_array_length(errors) = 0 then
      row.row_state := 'skipped_existing';
    elsif jsonb_array_length(errors) > 0 then
      row.row_state := 'invalid';
    else
      row.row_state := 'valid';
    end if;
    update public.member_csv_import_rows set row_state = row.row_state, error_codes = errors,
      first_name = row.first_name, last_name = row.last_name, invited_email = row.invited_email,
      invited_email_normalized = row.invited_email_normalized, spouse_first_name = row.spouse_first_name,
      spouse_last_name = row.spouse_last_name, secondary_email = row.secondary_email,
      home_phone = row.home_phone, work_phone = row.work_phone, mobile_phone = row.mobile_phone,
      address_line1 = row.address_line1, address_line2 = row.address_line2, city = row.city,
      state_region = row.state_region, postal_code = row.postal_code, country = row.country,
      tee_location = row.tee_location, dues_paid = row.dues_paid,
      secondary_email_visible = row.secondary_email_visible, home_phone_visible = row.home_phone_visible,
      work_phone_visible = row.work_phone_visible, mobile_phone_visible = row.mobile_phone_visible,
      address_listed = row.address_listed, initial_quota = row.initial_quota,
      use_initial_quota = row.use_initial_quota, seed_totals = row.seed_totals,
      seed_positions = row.seed_positions,
      handicap_id = row.handicap_id, handicap = row.handicap, handicap_as_of = row.handicap_as_of
    where id = row.id;
  end loop;
  update public.member_csv_import_jobs
  set quota_settings_version = coalesce(settings_version, 0)
  where id = job.id;
  -- Duplicate normalized invited addresses are whole-file errors. Mark both
  -- rows so the safe result projection explains the rejection completely.
  for row in select * from public.member_csv_import_rows as duplicate_row
    where duplicate_row.import_job_id = job.id
      and duplicate_row.invited_email_normalized is not null
      and (select count(*) from public.member_csv_import_rows as same_row
           where same_row.import_job_id = job.id
             and same_row.invited_email_normalized = duplicate_row.invited_email_normalized) > 1
    for update loop
    update public.member_csv_import_rows
    set row_state = 'invalid',
        error_codes = error_codes || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('code','duplicate_in_file','column','invited_email'))
    where id = row.id;
  end loop;
  return query select job.id, job.state, job.revision;
end;
$$;
comment on function public.validate_member_csv_import(uuid, uuid) is
  'Service-only lexical/domain validation. A single invalid row rejects the whole file; existing account/pending-invitation addresses are safe skips.';
revoke all on function public.validate_member_csv_import(uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.validate_member_csv_import(uuid, uuid) to service_role;

create function public.finalize_member_csv_import_validation(
  p_import_job_id uuid,
  p_worker_id uuid,
  p_correlation_id uuid
)
returns table (
  finalized_job_id app.entity_id,
  state public.member_csv_import_state,
  total_rows integer,
  valid_rows integer,
  invalid_rows integer,
  skipped_rows integer,
  revision bigint
)
language plpgsql security definer set search_path = ''
as $$
declare
  job public.member_csv_import_jobs%rowtype;
  v_valid integer;
  v_invalid integer;
  v_skipped integer;
  v_total integer;
  current_settings_version bigint;
  next_state public.member_csv_import_state;
begin
  select group_id into job.group_id from public.member_csv_import_jobs where id = p_import_job_id;
  if not found then raise exception 'member_csv_import_not_found' using errcode = 'P0002'; end if;
  perform group_row.id from public.groups as group_row where group_row.id = job.group_id for update;
  select * into job from public.member_csv_import_jobs where id = p_import_job_id for update;
  if not found then raise exception 'member_csv_import_not_found' using errcode = 'P0002'; end if;
  if job.state <> 'validating' or job.lease_owner is distinct from p_worker_id
    or job.lease_expires_at is null or job.lease_expires_at <= pg_catalog.clock_timestamp()
  then raise exception 'member_csv_import_lease_invalid' using errcode = 'P0001'; end if;
  select version into current_settings_version
  from public.group_quota_settings as quota_settings
  where quota_settings.group_id = job.group_id;
  if coalesce(current_settings_version, 0) <> job.quota_settings_version then
    select * into job
    from app.requeue_member_csv_import_for_settings(
      job.id, coalesce(current_settings_version, 0), job.actor_user_id,
      p_correlation_id, 'validation_finalize'
    );
    return query select job.id, job.state, job.total_rows, job.valid_rows,
      job.invalid_rows, job.skipped_rows, job.revision;
    return;
  end if;
  select count(*) filter (where row_state = 'valid'), count(*) filter (where row_state = 'invalid'),
    count(*) filter (where row_state = 'skipped_existing'), count(*)
  into v_valid, v_invalid, v_skipped, v_total
  from public.member_csv_import_rows where import_job_id = job.id;
  if exists (select 1 from public.member_csv_import_rows where import_job_id = job.id and row_state = 'pending') then
    raise exception 'member_csv_import_rows_not_validated' using errcode = 'P0001';
  end if;
  next_state := case when v_invalid > 0 then 'rejected'::public.member_csv_import_state else 'ready'::public.member_csv_import_state end;
  update public.member_csv_import_jobs set state = next_state, total_rows = v_total,
    valid_rows = v_valid, invalid_rows = v_invalid, skipped_rows = v_skipped,
    validated_at = pg_catalog.clock_timestamp(), lease_owner = null, lease_expires_at = null,
    revision = public.member_csv_import_jobs.revision + 1 where id = job.id returning * into job;
  insert into public.audit_events (
    group_id, actor_user_id, action, target_type, target_id, target_version,
    after_state, source, correlation_id
  ) values (
    job.group_id, job.actor_user_id, 'member_csv_import.validated', 'member_csv_import', job.id, job.revision,
    pg_catalog.jsonb_build_object('state', job.state, 'total_rows', v_total, 'valid_rows', v_valid,
      'invalid_rows', v_invalid, 'skipped_rows', v_skipped), 'worker', p_correlation_id
  );
  return query select job.id, job.state, v_total, v_valid, v_invalid, v_skipped, job.revision;
end;
$$;
comment on function public.finalize_member_csv_import_validation(uuid, uuid, uuid) is
  'Service-only validation finalization. Invalid rows reject the file as a whole.';
revoke all on function public.finalize_member_csv_import_validation(uuid, uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.finalize_member_csv_import_validation(uuid, uuid, uuid) to service_role;

create function public.get_member_csv_import(
  p_actor_user_id uuid,
  p_import_job_id uuid
)
returns table (
  import_job_id app.entity_id,
  group_id app.entity_id,
  state public.member_csv_import_state,
  total_rows integer,
  valid_rows integer,
  invalid_rows integer,
  skipped_rows integer,
  applied_rows integer,
  revision bigint,
  row_number integer,
  row_state public.member_csv_import_row_state,
  error_codes jsonb,
  membership_id app.entity_id,
  invitation_id app.entity_id
)
language plpgsql security definer set search_path = ''
as $$
declare
  actor_group_id uuid;
  job public.member_csv_import_jobs%rowtype;
begin
  select actor.group_id into actor_group_id from app.resolve_csv_import_actor(p_actor_user_id) as actor limit 1;
  if actor_group_id is null then raise exception 'actor_not_authorized' using errcode = 'P0003'; end if;
  select * into job from public.member_csv_import_jobs as import_job where import_job.id = p_import_job_id and import_job.group_id = actor_group_id;
  if not found then raise exception 'member_csv_import_not_found' using errcode = 'P0002'; end if;
  return query
  select job.id, job.group_id, job.state, job.total_rows, job.valid_rows, job.invalid_rows,
    job.skipped_rows, job.applied_rows, job.revision, row.row_number, row.row_state,
    row.error_codes, row.membership_id, row.invitation_id
  from public.member_csv_import_rows as row where row.import_job_id = job.id order by row.row_number;
end;
$$;
comment on function public.get_member_csv_import(uuid, uuid) is
  'Coordinator/administrator safe projection. It never returns raw row payloads, names, addresses, or invitation secrets.';
revoke all on function public.get_member_csv_import(uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.get_member_csv_import(uuid, uuid) to service_role;

create function public.request_member_csv_import_apply(
  p_actor_user_id uuid,
  p_import_job_id uuid,
  p_expected_revision bigint,
  p_confirmed boolean,
  p_reason text,
  p_correlation_id uuid,
  p_operation_id uuid
)
returns table (
  requested_job_id app.entity_id,
  group_id app.entity_id,
  state public.member_csv_import_state,
  revision bigint,
  apply_operation_id uuid
)
language plpgsql security definer set search_path = ''
as $$
declare
  actor_group_id uuid;
  actor_role public.membership_role;
  job public.member_csv_import_jobs%rowtype;
  normalized_reason text;
  prior_event public.audit_events%rowtype;
  current_settings_version bigint;
begin
  if p_actor_user_id is null or p_import_job_id is null or p_expected_revision is null
    or p_expected_revision <= 0 or p_confirmed is distinct from true
    or p_correlation_id is null or p_operation_id is null
  then raise exception 'member_csv_import_apply_confirmation_invalid' using errcode = '22023'; end if;
  normalized_reason := nullif(pg_catalog.btrim(p_reason), '');
  if normalized_reason is null or length(normalized_reason) > 500 then
    raise exception 'member_csv_import_apply_reason_required' using errcode = '22023';
  end if;
  select membership.group_id into actor_group_id
  from public.memberships as membership
  where membership.user_id = p_actor_user_id;
  if actor_group_id is null then raise exception 'actor_not_authorized' using errcode = 'P0003'; end if;
  perform 1 from public.groups as group_row where group_row.id = actor_group_id for update;
  select actor.group_id, actor.actor_role into actor_group_id, actor_role
  from app.resolve_csv_import_actor(p_actor_user_id) as actor
  limit 1;
  if actor_role is null then raise exception 'actor_not_authorized' using errcode = 'P0003'; end if;
  select * into job from public.member_csv_import_jobs as import_job where import_job.id = p_import_job_id and import_job.group_id = actor_group_id for update;
  if not found then raise exception 'member_csv_import_not_found' using errcode = 'P0002'; end if;
  if actor_role = 'coordinator' and exists (
    select 1 from public.member_csv_import_rows as import_row
    where import_row.import_job_id = job.id
      and (
        import_row.initial_quota is not null
        or import_row.use_initial_quota
        or pg_catalog.jsonb_array_length(import_row.seed_totals) > 0
      )
  ) then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;
  select * into prior_event from public.audit_events
  where action = 'member_csv_import.apply_requested' and operation_id = p_operation_id;
  if found then
    if prior_event.target_id is distinct from p_import_job_id
      or prior_event.actor_user_id is distinct from p_actor_user_id
      or prior_event.reason is distinct from normalized_reason
      or (prior_event.after_state ->> 'expected_revision')::bigint is distinct from p_expected_revision
    then raise exception 'operation_id_reused' using errcode = '23505'; end if;
    return query select job.id, job.group_id, job.state, job.revision, job.apply_operation_id;
    return;
  end if;
  if job.state <> 'ready' or job.revision <> p_expected_revision then
    raise exception 'member_csv_import_revision_changed' using errcode = '40001';
  end if;
  select version into current_settings_version
  from public.group_quota_settings as quota_settings
  where quota_settings.group_id = job.group_id;
  if coalesce(current_settings_version, 0) <> job.quota_settings_version then
    select * into job
    from app.requeue_member_csv_import_for_settings(
      job.id, coalesce(current_settings_version, 0), p_actor_user_id,
      p_correlation_id, 'apply_request'
    );
    return query select job.id, job.group_id, job.state, job.revision, job.apply_operation_id;
    return;
  end if;
  update public.member_csv_import_jobs
  set state = 'applying', apply_requested_at = pg_catalog.clock_timestamp(), apply_confirmed_by = p_actor_user_id,
      apply_operation_id = p_operation_id, apply_reason = normalized_reason, revision = public.member_csv_import_jobs.revision + 1
  where id = job.id returning * into job;
  insert into public.audit_events (
    group_id, actor_user_id, action, target_type, target_id, target_version, after_state, source, correlation_id, operation_id, reason
  ) values (
    job.group_id, p_actor_user_id, 'member_csv_import.apply_requested', 'member_csv_import', job.id, job.revision,
    pg_catalog.jsonb_build_object('import_job_id', job.id, 'state', job.state, 'revision', job.revision, 'expected_revision', p_expected_revision, 'confirmed', true),
    'server', p_correlation_id, p_operation_id, normalized_reason
  );
  return query select job.id, job.group_id, job.state, job.revision, job.apply_operation_id;
end;
$$;
comment on function public.request_member_csv_import_apply(uuid, uuid, bigint, boolean, text, uuid, uuid) is
  'Explicit coordinator/administrator confirmation boundary. Ready -> Applying is never implicit in a worker call.';
revoke all on function public.request_member_csv_import_apply(uuid, uuid, bigint, boolean, text, uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.request_member_csv_import_apply(uuid, uuid, bigint, boolean, text, uuid, uuid) to service_role;

create function public.claim_member_csv_import_apply(
  p_import_job_id uuid,
  p_worker_id uuid,
  p_lease_seconds integer default 1800
)
returns table (claimed_job_id app.entity_id, state public.member_csv_import_state, revision bigint, lease_expires_at app.utc_instant)
language plpgsql security definer set search_path = ''
as $$
declare
  job public.member_csv_import_jobs%rowtype;
begin
  if p_import_job_id is null or p_worker_id is null or p_lease_seconds not between 60 and 7200 then
    raise exception 'member_csv_import_claim_input_invalid' using errcode = '22023';
  end if;
  select * into job from public.member_csv_import_jobs where id = p_import_job_id for update;
  if not found then raise exception 'member_csv_import_not_found' using errcode = 'P0002'; end if;
  if job.state <> 'applying' or job.lease_owner is not null then
    raise exception 'member_csv_import_not_claimable' using errcode = 'P0001';
  end if;
  update public.member_csv_import_jobs set lease_owner = p_worker_id,
    lease_expires_at = pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => p_lease_seconds)
  where id = job.id returning * into job;
  return query select job.id, job.state, job.revision, job.lease_expires_at;
end;
$$;
comment on function public.claim_member_csv_import_apply(uuid, uuid, integer) is
  'Service-only worker lease for a coordinator-confirmed Applying job.';
revoke all on function public.claim_member_csv_import_apply(uuid, uuid, integer)
from public, anon, authenticated, service_role;
grant execute on function public.claim_member_csv_import_apply(uuid, uuid, integer) to service_role;

create function public.get_member_csv_import_apply_material(
  p_import_job_id uuid,
  p_worker_id uuid
)
returns table (
  import_job_id app.entity_id,
  row_number integer,
  invited_email text,
  invited_email_normalized text,
  apply_confirmed_by app.entity_id,
  apply_operation_id uuid,
  revision bigint
)
language plpgsql security definer set search_path = ''
as $$
declare
  job public.member_csv_import_jobs%rowtype;
begin
  select * into job from public.member_csv_import_jobs where id = p_import_job_id for update;
  if not found then raise exception 'member_csv_import_not_found' using errcode = 'P0002'; end if;
  if job.state <> 'applying' or job.lease_owner is distinct from p_worker_id
    or job.lease_expires_at is null or job.lease_expires_at <= pg_catalog.clock_timestamp()
  then raise exception 'member_csv_import_apply_lease_invalid' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.member_csv_import_rows as import_row where import_row.import_job_id = job.id and import_row.row_state = 'valid') then
    return query select job.id, null::integer, null::text, null::text,
      job.apply_confirmed_by, job.apply_operation_id, job.revision;
    return;
  end if;
  return query
  select job.id, row.row_number, row.invited_email, row.invited_email_normalized,
    job.apply_confirmed_by, job.apply_operation_id, job.revision
  from public.member_csv_import_rows as row
  where row.import_job_id = job.id and row.row_state = 'valid'
  order by row.row_number;
end;
$$;
comment on function public.get_member_csv_import_apply_material(uuid, uuid) is
  'Service-only apply material projection. It exposes only row number/e-mail and stored confirmation attribution; contact values and invitation secrets never leave the database.';
revoke all on function public.get_member_csv_import_apply_material(uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.get_member_csv_import_apply_material(uuid, uuid) to service_role;

create function public.claim_next_member_csv_import(
  p_worker_id uuid,
  p_lease_seconds integer default 300
)
returns table (
  claimed_job_id app.entity_id,
  claimed_state public.member_csv_import_state,
  group_id app.entity_id,
  revision bigint,
  lease_expires_at app.utc_instant
)
language plpgsql security definer set search_path = ''
as $$
declare
  job public.member_csv_import_jobs%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_worker_id is null or p_lease_seconds not between 30 and 7200 then
    raise exception 'member_csv_import_claim_input_invalid' using errcode = '22023';
  end if;
  select * into job from public.member_csv_import_jobs as import_job
  where (import_job.state = 'uploaded' and import_job.lease_owner is null)
     or (import_job.state = 'validating' and import_job.lease_expires_at <= v_now)
     or (import_job.state = 'applying' and import_job.apply_operation_id is not null
       and (import_job.lease_owner is null or import_job.lease_expires_at <= v_now))
  order by import_job.created_at
  for update skip locked limit 1;
  if not found then return; end if;
  if job.state = 'validating' then
    update public.member_csv_import_jobs set state = 'uploaded', lease_owner = null, lease_expires_at = null,
      validation_started_at = null, revision = public.member_csv_import_jobs.revision + 1 where id = job.id returning * into job;
  end if;
  if job.state = 'uploaded' then
    update public.member_csv_import_jobs set state = 'validating', validation_started_at = v_now,
      lease_owner = p_worker_id, lease_expires_at = v_now + pg_catalog.make_interval(secs => p_lease_seconds), revision = public.member_csv_import_jobs.revision + 1
    where id = job.id returning * into job;
  else
    update public.member_csv_import_jobs set lease_owner = p_worker_id,
      lease_expires_at = v_now + pg_catalog.make_interval(secs => p_lease_seconds)
    where id = job.id returning * into job;
  end if;
  return query select job.id, job.state, job.group_id, job.revision, job.lease_expires_at;
end;
$$;
comment on function public.claim_next_member_csv_import(uuid, integer) is
  'Service-only SKIP LOCKED discovery for asynchronous validation and confirmed apply jobs.';
revoke all on function public.claim_next_member_csv_import(uuid, integer)
from public, anon, authenticated, service_role;
grant execute on function public.claim_next_member_csv_import(uuid, integer) to service_role;

create function public.apply_member_csv_import(
  p_actor_user_id uuid,
  p_import_job_id uuid,
  p_worker_id uuid,
  p_invitation_payloads jsonb,
  p_correlation_id uuid,
  p_operation_id uuid
)
returns table (
  import_job_id app.entity_id,
  group_id app.entity_id,
  state public.member_csv_import_state,
  total_rows integer,
  skipped_rows integer,
  applied_rows integer,
  revision bigint
)
language plpgsql security definer set search_path = ''
as $$
declare
  actor_group_id uuid;
  job public.member_csv_import_jobs%rowtype;
  row public.member_csv_import_rows%rowtype;
  payload jsonb;
  invitation_id uuid;
  invitation_digest text;
  invitation_email text;
  invitation_key integer;
  invitation_expires timestamptz;
  membership_record public.memberships%rowtype;
  profile_record public.membership_golfer_profiles%rowtype;
  contact_record public.membership_private_contacts%rowtype;
  outbox_record public.notification_outbox_jobs%rowtype;
  delivery_record public.notification_deliveries%rowtype;
  settings_version bigint;
  settings_method public.quota_method;
  settings_history_length smallint;
  settings_precision smallint;
  settings_rounding_rule public.quota_rounding_rule;
  projected_quota app.quota_value;
  projection_ready boolean;
  uses_initial_effective boolean;
  projection_kind text;
  projection_positions jsonb;
  seed_count integer;
  seed text;
  seed_position integer;
  applied_count integer := 0;
  skipped_count integer := 0;
  valid_count integer := 0;
  invalid_count integer := 0;
  payload_count integer := 0;
begin
  if p_actor_user_id is null or p_import_job_id is null or p_worker_id is null
    or p_correlation_id is null or p_operation_id is null
    or p_invitation_payloads is null or pg_catalog.jsonb_typeof(p_invitation_payloads) <> 'array'
  then raise exception 'member_csv_import_apply_input_invalid' using errcode = '22023'; end if;
  select import_job.group_id into actor_group_id
  from public.member_csv_import_jobs as import_job
  where import_job.id = p_import_job_id;
  if not found then raise exception 'member_csv_import_not_found' using errcode = 'P0002'; end if;
  perform group_row.id from public.groups as group_row where group_row.id = actor_group_id for update;
  select * into job from public.member_csv_import_jobs where id = p_import_job_id for update;
  if not found then raise exception 'member_csv_import_not_found' using errcode = 'P0002'; end if;
  if p_actor_user_id is distinct from job.apply_confirmed_by then
    raise exception 'member_csv_import_apply_actor_mismatch' using errcode = 'P0003';
  end if;
  if job.apply_operation_id is null then raise exception 'member_csv_import_apply_not_confirmed' using errcode = 'P0001'; end if;
  if p_operation_id <> job.apply_operation_id then raise exception 'member_csv_import_apply_operation_mismatch' using errcode = '22023'; end if;
  if job.state = 'completed' then
    return query select job.id, job.group_id, job.state, job.total_rows, job.skipped_rows, job.applied_rows, job.revision;
    return;
  end if;
  if job.state <> 'applying' or job.lease_owner is distinct from p_worker_id
    or job.lease_expires_at is null or job.lease_expires_at <= pg_catalog.clock_timestamp()
  then raise exception 'member_csv_import_apply_lease_invalid' using errcode = 'P0001'; end if;
  select count(*) into valid_count from public.member_csv_import_rows as import_row where import_row.import_job_id = job.id and import_row.row_state = 'valid';
  payload_count := pg_catalog.jsonb_array_length(p_invitation_payloads);
  if payload_count <> valid_count then raise exception 'member_csv_import_invitation_payload_count_mismatch' using errcode = '22023'; end if;
  for row in select * from public.member_csv_import_rows as import_row where import_row.import_job_id = job.id and import_row.row_state = 'valid' loop
    if (select count(*) from pg_catalog.jsonb_array_elements(p_invitation_payloads) as e(value)
        where (value ->> 'row_number')::integer = row.row_number) <> 1
    then raise exception 'member_csv_import_invitation_payload_binding_invalid' using errcode = '22023'; end if;
  end loop;

  -- Check every trusted invitation payload before changing any state.  This
  -- makes malformed/duplicate payloads fail atomically before member rows are
  -- inserted and binds every secret-independent value to its CSV row.
  for payload in select value from pg_catalog.jsonb_array_elements(p_invitation_payloads) as e(value) loop
    if pg_catalog.jsonb_typeof(payload) <> 'object'
      or (payload ->> 'row_number') !~ '^[0-9]+$'
      or not exists (select 1 from public.member_csv_import_rows as import_row where import_row.import_job_id = job.id and import_row.row_number = (payload ->> 'row_number')::integer and import_row.row_state = 'valid')
    then raise exception 'member_csv_import_invitation_payload_binding_invalid' using errcode = '22023'; end if;
    if (payload ->> 'invitation_id') !~ '^[0-9a-fA-F-]{36}$'
      or (payload ->> 'token_digest') !~ '^[0-9a-fA-F]{64}$'
      or (payload ->> 'token_key_version') !~ '^[1-9][0-9]*$'
      or (payload ->> 'expires_at') is null
    then raise exception 'member_csv_import_invitation_payload_invalid' using errcode = '22023'; end if;
    invitation_id := (payload ->> 'invitation_id')::uuid;
    invitation_key := (payload ->> 'token_key_version')::integer;
    invitation_digest := lower(payload ->> 'token_digest');
    invitation_expires := (payload ->> 'expires_at')::timestamptz;
    invitation_email := nullif(btrim(payload ->> 'invited_email'), '');
    if invitation_email is null or invitation_expires <= pg_catalog.clock_timestamp() or invitation_key <= 0 then
      raise exception 'member_csv_import_invitation_payload_invalid' using errcode = '22023';
    end if;
    if (select count(*) from pg_catalog.jsonb_array_elements(p_invitation_payloads) as other(value)
      where other.value ->> 'invitation_id' = payload ->> 'invitation_id') > 1
    then raise exception 'member_csv_import_duplicate_invitation_id' using errcode = '23505'; end if;
    if exists (select 1 from public.membership_invitations where id = invitation_id) then
      raise exception 'member_csv_import_invitation_id_in_use' using errcode = '23505';
    end if;
    if lower(invitation_email) <> (select import_row.invited_email_normalized from public.member_csv_import_rows as import_row where import_row.import_job_id = job.id and import_row.row_number = (payload ->> 'row_number')::integer) then
      raise exception 'member_csv_import_invitation_payload_email_mismatch' using errcode = '22023';
    end if;
  end loop;

  update public.member_csv_import_jobs set apply_started_at = coalesce(apply_started_at, pg_catalog.clock_timestamp())
    where id = job.id returning * into job;
  select version, method, moving_average_history_length, precision, rounding_rule
    into settings_version, settings_method, settings_history_length, settings_precision, settings_rounding_rule
  from public.group_quota_settings as quota_settings where quota_settings.group_id = job.group_id;
  settings_version := coalesce(settings_version, 0);
  if settings_version <> job.quota_settings_version then
    select * into job
    from app.requeue_member_csv_import_for_settings(
      job.id, settings_version, p_actor_user_id,
      p_correlation_id, 'apply'
    );
    return query select job.id, job.group_id, job.state, job.total_rows,
      job.skipped_rows, job.applied_rows, job.revision;
    return;
  end if;

  for row in select * from public.member_csv_import_rows as import_row where import_row.import_job_id = job.id and import_row.row_state = 'valid' order by import_row.row_number for update loop
    -- Re-check races after validation. Existing identities and pending invites
    -- remain safe skips rather than becoming duplicate permanent members.
    if exists (
      select 1 from public.memberships as existing_membership
      join auth.users as identity on identity.id = existing_membership.user_id
      where existing_membership.group_id = job.group_id
        and lower(identity.email) = row.invited_email_normalized
    )
      or exists (
        select 1 from public.membership_invitations as pending_invite
        where pending_invite.group_id = job.group_id
          and pending_invite.status = 'pending'
          and pending_invite.invited_email_normalized = row.invited_email_normalized
      )
    then
      update public.member_csv_import_rows set row_state = 'skipped_existing' where id = row.id;
      skipped_count := skipped_count + 1;
      continue;
    end if;
    payload := (select value from pg_catalog.jsonb_array_elements(p_invitation_payloads) as e(value) where (value ->> 'row_number')::integer = row.row_number);
    invitation_id := (payload ->> 'invitation_id')::uuid;
    invitation_digest := lower(payload ->> 'token_digest');
    invitation_key := (payload ->> 'token_key_version')::integer;
    invitation_expires := (payload ->> 'expires_at')::timestamptz;
    uses_initial_effective := coalesce(row.use_initial_quota, false);
    insert into public.memberships (group_id, role, status, dues_paid, initial_quota, uses_initial_quota, initial_quota_provenance)
    values (job.group_id, 'member', 'pending', row.dues_paid, row.initial_quota, uses_initial_effective,
      case when row.initial_quota is null then null else 'member_csv_import' end)
    returning * into membership_record;
    insert into public.membership_golfer_profiles (membership_id, group_id, first_name, last_name, spouse_first_name, spouse_last_name, tee_location)
    values (membership_record.id, job.group_id, row.first_name, row.last_name, row.spouse_first_name, row.spouse_last_name, row.tee_location)
    returning * into profile_record;
    insert into public.membership_private_contacts (
      membership_id, group_id, secondary_email, secondary_email_normalized, home_phone_display, home_phone_normalized,
      work_phone_display, work_phone_normalized, mobile_phone_display, mobile_phone_normalized, address_line1, address_line2,
      city, state_region, postal_code, country, secondary_email_visible, home_phone_visible, work_phone_visible,
      mobile_phone_visible, address_listed
    ) values (
      membership_record.id, job.group_id, row.secondary_email, case when row.secondary_email is null then null else lower(row.secondary_email) end,
      row.home_phone, app.normalize_member_phone(row.home_phone), row.work_phone, app.normalize_member_phone(row.work_phone),
      row.mobile_phone, app.normalize_member_phone(row.mobile_phone), row.address_line1, row.address_line2, row.city, row.state_region,
      row.postal_code, row.country, row.secondary_email_visible, row.home_phone_visible, row.work_phone_visible,
      row.mobile_phone_visible, row.address_listed
    ) returning * into contact_record;
    seed_position := 0;
    for seed, seed_position in
      select values.value, (positions.value #>> '{}')::integer
      from pg_catalog.jsonb_array_elements_text(row.seed_totals) with ordinality as values(value, ordinal)
      join pg_catalog.jsonb_array_elements(row.seed_positions) with ordinality as positions(value, ordinal)
        on positions.ordinal = values.ordinal
      order by values.ordinal
    loop
      insert into public.membership_quota_seed_totals (membership_id, group_id, position, point_total, source, source_metadata)
      values (membership_record.id, job.group_id, seed_position, seed::app.golf_points_value, 'member_csv_import',
        pg_catalog.jsonb_build_object('import_job_id', job.id, 'row_number', row.row_number));
    end loop;
    seed_count := pg_catalog.jsonb_array_length(row.seed_totals);
    projected_quota := null;
    projection_ready := false;
    projection_kind := 'not_ready';
    projection_positions := '[]'::jsonb;
    uses_initial_effective := coalesce(row.use_initial_quota, false);
    -- The initial quota is a freeze only until the configured history
    -- threshold is reached.  At that point the calculated history projection
    -- is authoritative and the freeze is deactivated.
    if settings_method = 'moving_average'
      and row.initial_quota is not null
      and seed_count >= coalesce(settings_history_length, 10) then
      uses_initial_effective := false;
    elsif settings_method = 'best_10_of_20'
      and row.initial_quota is not null
      and seed_count >= 10 then
      uses_initial_effective := false;
    end if;
    if uses_initial_effective and row.initial_quota is not null then
      projected_quota := row.initial_quota;
      projection_ready := true;
      projection_kind := 'initial_quota';
    elsif row.initial_quota is not null and seed_count = 0 then
      -- An explicit freeze disable does not erase a supplied initial quota.
      -- With no history to supersede it, the initial value remains the only
      -- authoritative ready projection while the membership flag stays false.
      projected_quota := row.initial_quota;
      projection_ready := true;
      projection_kind := 'initial_quota';
    elsif settings_method = 'moving_average' and seed_count > 0
      and (not uses_initial_effective or seed_count >= coalesce(settings_history_length, 10)) then
      select round(avg(seed_value), coalesce(settings_precision, 2))::app.quota_value,
        coalesce(pg_catalog.jsonb_agg(source_position order by source_position), '[]'::jsonb)
        into projected_quota, projection_positions
      from (
        select item.value::numeric as seed_value,
          (positions.value #>> '{}')::smallint as source_position
        from pg_catalog.jsonb_array_elements_text(row.seed_totals) with ordinality as item(value, ordinal)
        join pg_catalog.jsonb_array_elements(row.seed_positions) with ordinality as positions(value, ordinal)
          on positions.ordinal = item.ordinal
        order by source_position desc limit coalesce(settings_history_length, 10)
      ) as recent;
      projection_ready := projected_quota is not null;
      projection_kind := 'seed_history';
    elsif settings_method = 'best_10_of_20' and seed_count > 0
      and (not uses_initial_effective or seed_count >= 10) then
      select round(avg(seed_value), coalesce(settings_precision, 2))::app.quota_value,
        coalesce(pg_catalog.jsonb_agg(source_position order by source_position), '[]'::jsonb)
        into projected_quota, projection_positions
      from (
        select item.value::numeric as seed_value,
          (positions.value #>> '{}')::smallint as source_position
        from pg_catalog.jsonb_array_elements_text(row.seed_totals) with ordinality as item(value, ordinal)
        join pg_catalog.jsonb_array_elements(row.seed_positions) with ordinality as positions(value, ordinal)
          on positions.ordinal = item.ordinal
        order by seed_value desc, source_position asc limit 10
      ) as best_totals;
      projection_ready := projected_quota is not null;
      projection_kind := 'seed_history';
    elsif settings_method = 'previous_plus_minus' and row.initial_quota is not null then
      projected_quota := round(row.initial_quota, coalesce(settings_precision, 2))::app.quota_value;
      projection_ready := true;
      projection_kind := 'initial_quota';
    end if;
    if not projection_ready then
      projection_kind := 'not_ready';
      projection_positions := '[]'::jsonb;
    end if;
    update public.memberships
    set uses_initial_quota = uses_initial_effective
    where id = membership_record.id;
    insert into public.membership_quota_projections (
      membership_id, group_id, settings_version, projection_ready, projected_quota, projection_source
    ) values (
      membership_record.id, job.group_id, settings_version, projection_ready, projected_quota,
      pg_catalog.jsonb_build_object('kind', projection_kind, 'source', 'member_csv_import', 'import_job_id', job.id,
        'seed_count', seed_count, 'seed_positions', projection_positions, 'settings_version', settings_version,
        'method', settings_method, 'history_length', settings_history_length, 'precision', coalesce(settings_precision, 2),
        'rounding_rule', coalesce(settings_rounding_rule::text, 'half_away_from_zero'))
    );
    if row.handicap is not null then
      insert into public.membership_handicap_records (membership_id, group_id, handicap_id, handicap, source, as_of)
      values (membership_record.id, job.group_id, row.handicap_id, row.handicap, 'import', row.handicap_as_of);
    end if;
    insert into public.membership_invitations (
      id, group_id, membership_id, invited_email, invited_email_normalized, role, token_digest_sha256,
      token_key_version, status, issued_at, expires_at, inviter_user_id
    ) values (
      invitation_id, job.group_id, membership_record.id, row.invited_email, row.invited_email_normalized, 'member', invitation_digest,
      invitation_key, 'pending', pg_catalog.clock_timestamp(), invitation_expires, p_actor_user_id
    );
    update public.memberships set invited_at = pg_catalog.clock_timestamp() where id = membership_record.id;
    insert into public.notification_outbox_jobs (
      group_id, event_type, aggregate_type, aggregate_id, aggregate_version, idempotency_key, state, attempts, next_attempt_at
    ) values (
      job.group_id, 'membership.invitation', 'membership_invitation', invitation_id,
      1, 'membership.invitation:' || invitation_id::text, 'queued', 0, pg_catalog.clock_timestamp()
    ) returning * into outbox_record;
    insert into public.notification_deliveries (
      group_id, outbox_job_id, recipient_membership_id, recipient_address, recipient_address_normalized,
      channel, state, attempts, next_attempt_at
    ) values (
      job.group_id, outbox_record.id, membership_record.id, row.invited_email, row.invited_email_normalized,
      'email', 'queued', 0, pg_catalog.clock_timestamp()
    ) returning * into delivery_record;
    insert into public.audit_events (
      group_id, actor_user_id, action, target_type, target_id, target_version, after_state, source, correlation_id
    ) values (
      job.group_id, p_actor_user_id, 'member.created', 'membership', membership_record.id, membership_record.version,
      pg_catalog.jsonb_build_object('membership_id', membership_record.id, 'group_id', job.group_id, 'status', 'pending', 'role', 'member', 'profile_version', profile_record.version, 'contact_version', contact_record.version, 'import_job_id', job.id, 'row_number', row.row_number),
      'server', p_correlation_id
    );
    insert into public.audit_events (
      group_id, actor_user_id, action, target_type, target_id, target_version, after_state, source, correlation_id
    ) values (
      job.group_id, p_actor_user_id, 'membership.invitation_issued', 'membership_invitation', invitation_id, 1,
      pg_catalog.jsonb_build_object('invitation_id', invitation_id, 'membership_id', membership_record.id, 'group_id', job.group_id, 'outbox_job_id', outbox_record.id, 'delivery_id', delivery_record.id, 'role', 'member', 'status', 'pending', 'token_key_version', invitation_key, 'import_job_id', job.id, 'row_number', row.row_number),
      'server', p_correlation_id
    );
    update public.member_csv_import_rows set row_state = 'applied', membership_id = membership_record.id,
      invitation_id = (payload ->> 'invitation_id')::uuid where id = row.id;
    applied_count := applied_count + 1;
  end loop;
  -- Recompute final counters from row state.  A member or invitation created
  -- after validation is a skip, so counters cannot be derived only from the
  -- worker's local increments.
  select count(*) filter (where import_row.row_state = 'valid'),
    count(*) filter (where import_row.row_state = 'invalid'),
    count(*) filter (where import_row.row_state = 'skipped_existing'),
    count(*) filter (where import_row.row_state = 'applied')
    into valid_count, invalid_count, skipped_count, applied_count
  from public.member_csv_import_rows as import_row
  where import_row.import_job_id = job.id;
  if valid_count <> 0 then
    raise exception 'member_csv_import_rows_not_applied' using errcode = 'P0001';
  end if;
  update public.member_csv_import_jobs set state = 'completed', valid_rows = valid_count,
    invalid_rows = invalid_count, skipped_rows = skipped_count, applied_rows = applied_count,
    completed_at = pg_catalog.clock_timestamp(), lease_owner = null, lease_expires_at = null,
    revision = public.member_csv_import_jobs.revision + 1 where id = job.id returning * into job;
  insert into public.audit_events (
    group_id, actor_user_id, action, target_type, target_id, target_version, after_state, source, correlation_id, operation_id
  ) values (
    job.group_id, p_actor_user_id, 'member_csv_import.completed', 'member_csv_import', job.id, job.revision,
    pg_catalog.jsonb_build_object('import_job_id', job.id, 'state', job.state, 'total_rows', job.total_rows, 'skipped_rows', job.skipped_rows, 'applied_rows', job.applied_rows),
    'server', p_correlation_id, p_operation_id
  );
  return query select job.id, job.group_id, job.state, job.total_rows, job.skipped_rows, job.applied_rows, job.revision;
end;
$$;
comment on function public.apply_member_csv_import(uuid, uuid, uuid, jsonb, uuid, uuid) is
  'Coordinator/administrator atomic apply. Every non-skipped valid row creates pending/member profile/contact/quota/handicap/invitation/outbox records in one transaction.';
revoke all on function public.apply_member_csv_import(uuid, uuid, uuid, jsonb, uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.apply_member_csv_import(uuid, uuid, uuid, jsonb, uuid, uuid) to service_role;
