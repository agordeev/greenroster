begin;

create extension if not exists pgtap with schema extensions;

select plan(4);

select has_function(
  'public',
  'set_round_draft_score_fields',
  array['uuid','uuid','boolean','boolean','bigint','uuid','uuid'],
  'the draft score-field mutation RPC exists'
);

select ok(
  array['enable_gross_score', 'enable_net_score']::name[] <@
    (
      select proargnames::name[]
      from pg_catalog.pg_proc
      where oid = 'public.list_rounds(uuid)'::regprocedure
    ),
  'the coordinator round projection exposes both score-field capabilities'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.set_round_draft_score_fields(uuid,uuid,boolean,boolean,bigint,uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.set_round_draft_score_fields(uuid,uuid,boolean,boolean,bigint,uuid,uuid)',
    'execute'
  ),
  'only the trusted server can change draft score fields'
);

select is(
  (
    select prokind
    from pg_catalog.pg_proc
    where oid = 'public.list_rounds(uuid)'::regprocedure
  ),
  'f'::"char",
  'round capability projection is a function boundary'
);

select * from finish();
rollback;
