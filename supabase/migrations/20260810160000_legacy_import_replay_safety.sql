-- Harden legacy-import replay identity and bound the browser projection.
--
-- A source file can be submitted with more than one approved profile. The
-- profile digest therefore participates in the job replay key. Mapping
-- operation ids also bind to every normalized decision field, not only the
-- row and reason. The job projection remains deliberately bounded because a
-- Vercel response must not grow with an unbounded staged export.

alter table public.legacy_import_jobs
  add column profile_digest text;

update public.legacy_import_jobs
set profile_digest = repeat('0', 64)
where profile_digest is null;

alter table public.legacy_import_jobs
  alter column profile_digest set not null;

alter table public.legacy_import_jobs
  add constraint legacy_import_jobs_profile_digest_valid
  check (profile_digest ~ '^[0-9a-f]{64}$');

drop index if exists public.legacy_import_jobs_replay_idx;
create unique index legacy_import_jobs_replay_idx
  on public.legacy_import_jobs (
    group_id,
    profile_key,
    schema_version,
    source_fingerprint,
    profile_digest
  );

-- Add the profile digest to the existing staging function without duplicating
-- its validation and tenant-authority implementation. The preceding
-- crosswalk-scope migration has already patched the function text that is
-- retrieved here.
do $$
declare
  function_definition text;
  original_definition text;
begin
  select pg_catalog.pg_get_functiondef(procedure_record.oid)
  into function_definition
  from pg_catalog.pg_proc as procedure_record
  where procedure_record.oid =
    'public.create_legacy_import_job(uuid,uuid,text,text,text,jsonb,jsonb,uuid,uuid)'::pg_catalog.regprocedure;
  if function_definition is null then
    raise exception 'legacy_import_create_function_missing';
  end if;
  original_definition := function_definition;

  function_definition := pg_catalog.replace(
    function_definition,
    'p_source_fingerprint text, p_rows jsonb,',
    'p_source_fingerprint text, p_profile_digest text, p_rows jsonb,'
  );
  function_definition := pg_catalog.replace(
    function_definition,
    '  if pg_catalog.lower(coalesce(p_source_fingerprint, '''')) !~ ''^[0-9a-f]{64}$'' then' || pg_catalog.chr(10)
      || '    raise exception ''legacy_import_fingerprint_invalid'' using errcode = ''22023'';' || pg_catalog.chr(10)
      || '  end if;',
    '  if pg_catalog.lower(coalesce(p_source_fingerprint, '''')) !~ ''^[0-9a-f]{64}$'' then' || pg_catalog.chr(10)
      || '    raise exception ''legacy_import_fingerprint_invalid'' using errcode = ''22023'';' || pg_catalog.chr(10)
      || '  end if;' || pg_catalog.chr(10)
      || '  if pg_catalog.lower(coalesce(p_profile_digest, '''')) !~ ''^[0-9a-f]{64}$'' then' || pg_catalog.chr(10)
      || '    raise exception ''legacy_import_profile_digest_invalid'' using errcode = ''22023'';' || pg_catalog.chr(10)
      || '  end if;'
  );
  function_definition := pg_catalog.replace(
    function_definition,
    '    and import_job.source_fingerprint = pg_catalog.lower(p_source_fingerprint)' || pg_catalog.chr(10) || '  for update;',
    '    and import_job.source_fingerprint = pg_catalog.lower(p_source_fingerprint)' || pg_catalog.chr(10)
      || '    and import_job.profile_digest = pg_catalog.lower(p_profile_digest)' || pg_catalog.chr(10) || '  for update;'
  );
  function_definition := pg_catalog.replace(
    function_definition,
    '    id, group_id, profile_key, schema_version, source_fingerprint,' || pg_catalog.chr(10) || '    actor_user_id, total_rows',
    '    id, group_id, profile_key, schema_version, source_fingerprint, profile_digest,' || pg_catalog.chr(10)
      || '    actor_user_id, total_rows'
  );
  function_definition := pg_catalog.replace(
    function_definition,
    '    pg_catalog.btrim(p_schema_version), pg_catalog.lower(p_source_fingerprint),' || pg_catalog.chr(10)
      || '    p_actor_user_id, pg_catalog.jsonb_array_length(p_rows)',
    '    pg_catalog.btrim(p_schema_version), pg_catalog.lower(p_source_fingerprint),' || pg_catalog.chr(10)
      || '    pg_catalog.lower(p_profile_digest), p_actor_user_id, pg_catalog.jsonb_array_length(p_rows)'
  );
  function_definition := pg_catalog.replace(
    function_definition,
    '''import_job_id'', job.id, ''profile_key'', job.profile_key,' || pg_catalog.chr(10)
      || '      ''schema_version'', job.schema_version, ''source_fingerprint'', job.source_fingerprint,',
    '''import_job_id'', job.id, ''profile_key'', job.profile_key,' || pg_catalog.chr(10)
      || '      ''schema_version'', job.schema_version, ''source_fingerprint'', job.source_fingerprint,' || pg_catalog.chr(10)
      || '      ''profile_digest'', job.profile_digest,'
  );
  if function_definition = original_definition
    or function_definition not like '%p_profile_digest text%'
    or function_definition not like '%profile_digest = pg_catalog.lower(p_profile_digest)%'
  then
    raise exception 'legacy_import_create_function_not_patched';
  end if;
  execute function_definition;
end;
$$;

-- Keep the original positional RPC available for existing trusted workers and
-- database tests. Calls through this compatibility boundary use the legacy
-- zero digest; new callers must submit the canonical profile digest through
-- the ten-argument function above.
create or replace function public.create_legacy_import_job(
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
language sql
security definer
set search_path = ''
as $$
  select *
  from public.create_legacy_import_job(
    p_actor_user_id,
    p_import_job_id,
    p_profile_key,
    p_schema_version,
    p_source_fingerprint,
    repeat('0', 64),
    p_rows,
    p_warnings,
    p_correlation_id,
    p_operation_id
  );
$$;

revoke all on function public.create_legacy_import_job(uuid,uuid,text,text,text,text,jsonb,jsonb,uuid,uuid)
from public, anon, authenticated, service_role;
grant execute on function public.create_legacy_import_job(uuid,uuid,text,text,text,text,jsonb,jsonb,uuid,uuid)
to service_role;
revoke all on function public.create_legacy_import_job(uuid,uuid,text,text,text,jsonb,jsonb,uuid,uuid)
from public, anon, authenticated, service_role;
grant execute on function public.create_legacy_import_job(uuid,uuid,text,text,text,jsonb,jsonb,uuid,uuid)
to service_role;

-- Add a cursor/limit overload for the safe projection. It returns at most
-- limit + 1 rows so the trusted server can derive a next cursor without an
-- unbounded response. Existing callers keep the two-argument boundary below.
do $$
declare
  function_definition text;
begin
  select pg_catalog.pg_get_functiondef(procedure_record.oid)
  into function_definition
  from pg_catalog.pg_proc as procedure_record
  where procedure_record.oid =
    'public.get_legacy_import_job(uuid,uuid)'::pg_catalog.regprocedure;
  if function_definition is null then
    raise exception 'legacy_import_get_function_missing';
  end if;
  function_definition := pg_catalog.replace(
    function_definition,
    'p_actor_user_id uuid, p_import_job_id uuid)',
    'p_actor_user_id uuid, p_import_job_id uuid, p_after_row_number integer, p_limit integer)'
  );
  function_definition := pg_catalog.replace(
    function_definition,
    'begin' || pg_catalog.chr(10),
    'begin' || pg_catalog.chr(10)
      || '  if (p_after_row_number is not null and p_after_row_number < 1)'
      || ' or p_limit is null or p_limit < 1 or p_limit > 100 then' || pg_catalog.chr(10)
      || '    raise exception ''legacy_import_projection_query_invalid'' using errcode = ''22023'';' || pg_catalog.chr(10)
      || '  end if;' || pg_catalog.chr(10)
  );
  function_definition := pg_catalog.replace(
    function_definition,
    '  where row.import_job_id = job.id' || pg_catalog.chr(10)
      || '  order by row.row_number;',
    '  where row.import_job_id = job.id' || pg_catalog.chr(10)
      || '    and (p_after_row_number is null or row.row_number > p_after_row_number)' || pg_catalog.chr(10)
      || '  order by row.row_number' || pg_catalog.chr(10)
      || '  limit (p_limit + 1);'
  );
  if function_definition not like '%p_after_row_number integer%'
    or function_definition not like '%p_limit integer%'
    or function_definition not like '%limit (p_limit + 1)%'
  then
    raise exception 'legacy_import_get_function_not_patched';
  end if;
  execute function_definition;
end;
$$;

create or replace function public.get_legacy_import_job(
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
language sql
stable
security definer
set search_path = ''
as $$
  select *
  from public.get_legacy_import_job(
    p_actor_user_id,
    p_import_job_id,
    null,
    100
  );
$$;

revoke all on function public.get_legacy_import_job(uuid,uuid,integer,integer)
from public, anon, authenticated, service_role;
grant execute on function public.get_legacy_import_job(uuid,uuid,integer,integer)
to service_role;
revoke all on function public.get_legacy_import_job(uuid,uuid)
from public, anon, authenticated, service_role;
grant execute on function public.get_legacy_import_job(uuid,uuid)
to service_role;

-- An operation id is a receipt for the complete normalized decision. A
-- replay may return the original result, but any changed state, target,
-- method, or reason is a reused operation and must fail closed.
do $$
declare
  function_definition text;
begin
  select pg_catalog.pg_get_functiondef(procedure_record.oid)
  into function_definition
  from pg_catalog.pg_proc as procedure_record
  where procedure_record.oid =
    'public.set_legacy_import_mapping(uuid,uuid,uuid,text,text,uuid,text,text,bigint,uuid,uuid)'::pg_catalog.regprocedure;
  if function_definition is null then
    raise exception 'legacy_import_mapping_function_missing';
  end if;
  function_definition := pg_catalog.replace(
    function_definition,
    '      or prior_event.reason is distinct from normalized_reason',
    '      or prior_event.reason is distinct from normalized_reason' || pg_catalog.chr(10)
      || '      or prior_event.after_state ->> ''mapping_state'' is distinct from normalized_state::text' || pg_catalog.chr(10)
      || '      or prior_event.after_state ->> ''target_type'' is distinct from normalized_type' || pg_catalog.chr(10)
      || '      or prior_event.after_state ->> ''target_id'' is distinct from' || pg_catalog.chr(10)
      || '        (case when p_target_id is null then null else p_target_id::text end)' || pg_catalog.chr(10)
      || '      or prior_event.after_state ->> ''mapping_method'' is distinct from normalized_method'
  );
  function_definition := pg_catalog.replace(
    function_definition,
    '      ''mapping_method'', crosswalk_record.mapping_method,' || pg_catalog.chr(10)
      || '      ''state'', job.state, ''mapped_rows'', job.mapped_rows',
    '      ''mapping_method'', crosswalk_record.mapping_method, ''row_state'', row_record.row_state,' || pg_catalog.chr(10)
      || '      ''state'', job.state, ''mapped_rows'', job.mapped_rows'
  );
  function_definition := pg_catalog.replace(
    function_definition,
    '    return query select job.id, row_record.id, row_record.row_state,' || pg_catalog.chr(10)
      || '      crosswalk_record.mapping_state, job.revision;' || pg_catalog.chr(10)
      || '    return;' || pg_catalog.chr(10)
      || '  end if;' || pg_catalog.chr(10)
      || '  if job.revision <> p_expected_revision then',
    '    return query select job.id, row_record.id,' || pg_catalog.chr(10)
      || '      coalesce(nullif(prior_event.after_state ->> ''row_state'', '''')::public.legacy_import_row_state, row_record.row_state),' || pg_catalog.chr(10)
      || '      coalesce(nullif(prior_event.after_state ->> ''mapping_state'', '''')::public.legacy_import_mapping_state, crosswalk_record.mapping_state),' || pg_catalog.chr(10)
      || '      prior_event.target_version;' || pg_catalog.chr(10)
      || '    return;' || pg_catalog.chr(10)
      || '  end if;' || pg_catalog.chr(10)
      || '  if job.revision <> p_expected_revision then'
  );
  if function_definition not like '%after_state ->> ''mapping_state''%'
    or function_definition not like '%after_state ->> ''mapping_method''%'
    or function_definition not like '%prior_event.target_version%'
  then
    raise exception 'legacy_import_mapping_function_not_patched';
  end if;
  execute function_definition;
end;
$$;
