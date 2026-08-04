begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

select has_function(
  'public',
  'read_mobile_round_detail',
  array['uuid'],
  'actor-derived mobile round detail boundary exists'
);
select has_function(
  'public',
  'set_mobile_round_participant_rsvp',
  array['uuid','public.round_rsvp_status','bigint','uuid','uuid'],
  'actor-derived mobile RSVP boundary exists'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.read_mobile_round_detail(uuid)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.set_mobile_round_participant_rsvp(uuid,public.round_rsvp_status,bigint,uuid,uuid)',
    'execute'
  ),
  'authenticated clients can call the mobile detail and RSVP boundaries'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.read_mobile_round_detail(uuid)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.read_mobile_round_detail(uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.set_mobile_round_participant_rsvp(uuid,public.round_rsvp_status,bigint,uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.set_mobile_round_participant_rsvp(uuid,public.round_rsvp_status,bigint,uuid,uuid)',
    'execute'
  ),
  'anonymous and service-role clients cannot call mobile detail or RSVP boundaries'
);
select ok(
  (select prosecdef from pg_catalog.pg_proc where oid = 'public.read_mobile_round_detail(uuid)'::regprocedure)
  and (select prosecdef from pg_catalog.pg_proc where oid = 'public.set_mobile_round_participant_rsvp(uuid,public.round_rsvp_status,bigint,uuid,uuid)'::regprocedure),
  'mobile detail and RSVP boundaries are security-definer delegates'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.set_round_participant_rsvp(uuid,uuid,public.round_rsvp_status,bigint,text,uuid,uuid)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.set_round_participant_rsvp(uuid,uuid,public.round_rsvp_status,bigint,text,uuid,uuid)',
    'execute'
  ),
  'service-only RSVP implementation remains unavailable to mobile clients'
);
select ok(
  not has_table_privilege('authenticated', 'public.rounds', 'select,insert,update,delete')
  and not has_table_privilege('authenticated', 'public.round_participants', 'select,insert,update,delete')
  and not has_table_privilege('authenticated', 'public.audit_events', 'select,insert,update,delete'),
  'mobile clients cannot bypass detail, RSVP, or audit boundaries through raw tables'
);
select ok(
  (select proconfig @> array['search_path=']::text[]
   from pg_catalog.pg_proc
   where oid = 'public.read_mobile_round_detail(uuid)'::regprocedure)
  and (select proconfig @> array['search_path=']::text[]
   from pg_catalog.pg_proc
   where oid = 'public.set_mobile_round_participant_rsvp(uuid,public.round_rsvp_status,bigint,uuid,uuid)'::regprocedure),
  'mobile boundaries pin an empty search path'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.read_mobile_round_summary(uuid)',
    'execute'
  ),
  'summary deep-link boundary remains authenticated-only'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.read_round_participants(uuid,uuid)',
    'execute'
  ),
  'service-only participant projection remains unavailable to mobile clients'
);
select * from finish();

rollback;
