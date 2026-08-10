-- Keep every legacy-key decision scoped to the import job that produced it.
--
-- The original foundation used a group/profile/type/key uniqueness key and
-- joins that omitted import_job_id. That prevented a corrected export from
-- being staged under a new fingerprint and could make a later projection join
-- rows to an earlier job's mapping. This forward migration preserves the
-- already-recorded evidence while making each job's crosswalk independent.

drop index if exists public.legacy_import_crosswalk_key_idx;

create unique index legacy_import_crosswalk_key_idx
  on public.legacy_import_crosswalk (
    import_job_id,
    group_id,
    source_profile,
    legacy_type,
    legacy_key
  );

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
    'crosswalk.group_id = row.group_id' || pg_catalog.chr(10),
    'crosswalk.group_id = row.group_id' || pg_catalog.chr(10)
      || '   and crosswalk.import_job_id = row.import_job_id' || pg_catalog.chr(10)
  );
  if function_definition = original_definition then
    raise exception 'legacy_import_create_function_not_patched';
  end if;
  execute function_definition;

  select pg_catalog.pg_get_functiondef(procedure_record.oid)
  into function_definition
  from pg_catalog.pg_proc as procedure_record
  where procedure_record.oid =
    'public.get_legacy_import_job(uuid,uuid)'::pg_catalog.regprocedure;
  if function_definition is null then
    raise exception 'legacy_import_get_function_missing';
  end if;
  original_definition := function_definition;
  function_definition := pg_catalog.replace(
    function_definition,
    'crosswalk.group_id = row.group_id' || pg_catalog.chr(10),
    'crosswalk.group_id = row.group_id' || pg_catalog.chr(10)
      || '   and crosswalk.import_job_id = row.import_job_id' || pg_catalog.chr(10)
  );
  if function_definition = original_definition then
    raise exception 'legacy_import_get_function_not_patched';
  end if;
  execute function_definition;

  select pg_catalog.pg_get_functiondef(procedure_record.oid)
  into function_definition
  from pg_catalog.pg_proc as procedure_record
  where procedure_record.oid =
    'public.set_legacy_import_mapping(uuid,uuid,uuid,text,text,uuid,text,text,bigint,uuid,uuid)'::pg_catalog.regprocedure;
  if function_definition is null then
    raise exception 'legacy_import_mapping_function_missing';
  end if;
  original_definition := function_definition;
  function_definition := pg_catalog.replace(
    function_definition,
    'crosswalk.group_id = row.group_id' || pg_catalog.chr(10),
    'crosswalk.group_id = row.group_id' || pg_catalog.chr(10)
      || '   and crosswalk.import_job_id = row.import_job_id' || pg_catalog.chr(10)
  );
  function_definition := pg_catalog.replace(
    function_definition,
    'crosswalk.group_id = job.group_id' || pg_catalog.chr(10),
    'crosswalk.group_id = job.group_id' || pg_catalog.chr(10)
      || '      and crosswalk.import_job_id = job.id' || pg_catalog.chr(10)
  );
  -- The original idempotency check compared an audit event's crosswalk
  -- target_id with the source row id. Resolve the requested row's scoped
  -- crosswalk before comparing so a replay returns the original result.
  function_definition := pg_catalog.replace(
    function_definition,
    'prior_event.target_id is distinct from p_row_id',
    'prior_event.target_id is distinct from (' || pg_catalog.chr(10)
      || '      select crosswalk.id' || pg_catalog.chr(10)
      || '      from public.legacy_import_rows as row' || pg_catalog.chr(10)
      || '      join public.legacy_import_crosswalk as crosswalk' || pg_catalog.chr(10)
      || '        on crosswalk.group_id = row.group_id' || pg_catalog.chr(10)
      || '       and crosswalk.import_job_id = row.import_job_id' || pg_catalog.chr(10)
      || '       and crosswalk.source_profile = job.profile_key' || pg_catalog.chr(10)
      || '       and crosswalk.legacy_type = row.legacy_type' || pg_catalog.chr(10)
      || '       and crosswalk.legacy_key = row.legacy_key' || pg_catalog.chr(10)
      || '      where row.id = p_row_id' || pg_catalog.chr(10)
      || '        and row.import_job_id = job.id' || pg_catalog.chr(10)
      || '    )'
  );
  if function_definition = original_definition then
    raise exception 'legacy_import_mapping_function_not_patched';
  end if;
  execute function_definition;
end;
$$;
