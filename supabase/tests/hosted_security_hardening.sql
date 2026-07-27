begin;

create extension if not exists pgtap with schema extensions;

select plan(2);

select ok(
  case
    when to_regprocedure('public.rls_auto_enable()') is null then true
    else not has_function_privilege('anon', 'public.rls_auto_enable()', 'execute')
  end,
  'anonymous users cannot execute the automatic-RLS event trigger function'
);

select ok(
  case
    when to_regprocedure('public.rls_auto_enable()') is null then true
    else not has_function_privilege('authenticated', 'public.rls_auto_enable()', 'execute')
  end,
  'authenticated users cannot execute the automatic-RLS event trigger function'
);

select * from finish();

rollback;
