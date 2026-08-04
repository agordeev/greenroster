begin;

create extension if not exists pgtap with schema extensions;

select plan(4);

select has_function(
  'public',
  'acknowledge_mobile_round_score_sync',
  array['uuid', 'uuid', 'uuid', 'uuid'],
  'mobile receipt function remains available'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.acknowledge_mobile_round_score_sync(uuid,uuid,uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.acknowledge_mobile_round_score_sync(uuid,uuid,uuid,uuid)',
    'execute'
  ),
  'receipt remains authenticated-only'
);
select ok((
  with function_source as (
    select pg_get_functiondef('public.acknowledge_mobile_round_score_sync(uuid,uuid,uuid,uuid)'::regprocedure) as body
  )
  select
    position('from public.groups as group_record' in body)
      < position('select membership.*' in body)
    and position('select membership.*' in body)
      < position('and participant.group_id = actor_membership.group_id' in body)
    and position('and participant.group_id = actor_membership.group_id' in body)
      < position('select projection.*' in body)
    and position('select projection.*' in body)
      < position('select revision.*' in body)
    and position('select revision.*' in body)
      < position('select receipt.*' in body)
    and position('select receipt.*' in body)
      < position('select round_record.*' in body)
  from function_source
  ),
  'receipt locks follow group, membership, participant, projection, revision, receipt, round order'
);
select ok(
  pg_get_functiondef('public.acknowledge_mobile_round_score_sync(uuid,uuid,uuid,uuid)'::regprocedure)
    like '%where group_record.id = target_participant.group_id%'
    and pg_get_functiondef('public.acknowledge_mobile_round_score_sync(uuid,uuid,uuid,uuid)'::regprocedure)
      like '%where membership.user_id = current_actor_user_id%',
  'receipt derives tenant and actor before locking participant score state'
);

select * from finish();

rollback;
