begin;

select plan(73);

select has_table('public', 'password_recovery_sessions', 'password recovery session registry exists');
select col_type_is('public', 'password_recovery_sessions', 'session_id', 'uuid', 'recovery session identifiers are UUIDs');
select col_type_is('public', 'password_recovery_sessions', 'user_id', 'app.entity_id', 'recovery sessions reference entity IDs');
select col_type_is('public', 'password_recovery_sessions', 'consumed_correlation_id', 'uuid', 'consumption retains its retry correlation');
select col_type_is('public', 'password_recovery_sessions', 'reset_operation_id', 'uuid', 'every reset has a stable operation identifier');
select col_not_null('public', 'password_recovery_sessions', 'reset_operation_id', 'reset operation identifiers are required');
select col_is_fk('public', 'password_recovery_sessions', 'user_id', 'recovery sessions reference Auth identities');

select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.password_recovery_sessions'::regclass),
  'password recovery registry has RLS enabled'
);
select ok(
  (select relforcerowsecurity from pg_catalog.pg_class where oid = 'public.password_recovery_sessions'::regclass),
  'password recovery registry forces RLS'
);

select ok(not has_table_privilege('anon', 'public.password_recovery_sessions', 'select'), 'anonymous cannot read recovery sessions');
select ok(not has_table_privilege('authenticated', 'public.password_recovery_sessions', 'select'), 'authenticated users cannot read recovery sessions');
select ok(not has_table_privilege('authenticated', 'public.password_recovery_sessions', 'insert'), 'authenticated users cannot create recovery sessions');
select ok(not has_table_privilege('authenticated', 'public.password_recovery_sessions', 'update'), 'authenticated users cannot consume recovery sessions');

select ok(has_table_privilege('service_role', 'public.password_recovery_sessions', 'select'), 'service role can resolve recovery sessions');
select ok(not has_table_privilege('service_role', 'public.password_recovery_sessions', 'insert'), 'service role cannot insert recovery rows directly');
select ok(not has_table_privilege('service_role', 'public.password_recovery_sessions', 'update'), 'service role cannot update recovery rows directly');
select ok(not has_table_privilege('service_role', 'public.password_recovery_sessions', 'delete'), 'service role cannot delete recovery history');
select ok(has_function_privilege('service_role', 'public.register_password_recovery_session(uuid,uuid,timestamptz)', 'execute'), 'service role can register through the constrained function');
select ok(has_function_privilege('service_role', 'public.claim_password_recovery_session(uuid,uuid,uuid,timestamptz)', 'execute'), 'service role can atomically claim through the constrained function');
select ok(has_function_privilege('service_role', 'public.release_password_recovery_claim(uuid,uuid,uuid)', 'execute'), 'service role can release its exact claim');
select ok(has_function_privilege('service_role', 'public.consume_password_recovery_session(uuid,uuid,uuid,timestamptz,uuid)', 'execute'), 'service role can consume its exact claim');

select has_table('public', 'password_recovery_intents', 'mobile recovery intent proof store exists');
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.password_recovery_intents'::regclass),
  'mobile recovery intents have RLS enabled'
);
select ok(
  (select relforcerowsecurity from pg_catalog.pg_class where oid = 'public.password_recovery_intents'::regclass),
  'mobile recovery intents force RLS'
);
select ok(not has_table_privilege('anon', 'public.password_recovery_intents', 'select'), 'anonymous cannot read recovery intent proof');
select ok(not has_table_privilege('authenticated', 'public.password_recovery_intents', 'select'), 'authenticated users cannot read recovery intent proof');
select ok(has_function_privilege('service_role', 'public.create_password_recovery_intent(text,text,text,timestamptz)', 'execute'), 'service role can create a hashed recovery intent');
select ok(has_function_privilege('service_role', 'public.register_mobile_password_recovery_session(text,text,text,uuid,uuid,uuid,timestamptz)', 'execute'), 'service role can atomically consume proof and register recovery');

select has_table('public', 'identity_security_audit_events', 'unattached identity security audit store exists');
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.identity_security_audit_events'::regclass),
  'identity security audit store has RLS enabled'
);
select ok(
  (select relforcerowsecurity from pg_catalog.pg_class where oid = 'public.identity_security_audit_events'::regclass),
  'identity security audit store forces RLS'
);
select ok(not has_table_privilege('anon', 'public.identity_security_audit_events', 'select'), 'anonymous cannot read identity security audit events');
select ok(not has_table_privilege('authenticated', 'public.identity_security_audit_events', 'select'), 'authenticated users cannot read identity security audit events');
select ok(not has_table_privilege('service_role', 'public.identity_security_audit_events', 'insert'), 'service role cannot append identity security audit events directly');

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at
)
values
  ('10000000-0000-4000-8000-000000000101', 'recovery-a@example.test', now(), false, false, now(), now()),
  ('10000000-0000-4000-8000-000000000102', 'recovery-b@example.test', now(), false, false, now(), now());

insert into public.groups (id, name, time_zone)
values ('50000000-0000-4000-8000-000000000101', 'Recovery audit group', 'UTC');

insert into public.user_profiles (user_id)
values ('10000000-0000-4000-8000-000000000101');

insert into public.memberships (
  id, group_id, user_id, role, status, activated_at
)
values (
  '60000000-0000-4000-8000-000000000101',
  '50000000-0000-4000-8000-000000000101',
  '10000000-0000-4000-8000-000000000101',
  'member',
  'active',
  now()
);

reset role;
insert into public.password_recovery_intents (
  state_hash,
  email_hash,
  code_verifier,
  expires_at,
  created_at
)
values (
  repeat('d', 64),
  repeat('e', 64),
  repeat('v', 43),
  now() - interval '1 second',
  now() - interval '2 seconds'
);
set local role service_role;
select ok(
  public.create_password_recovery_intent(repeat('f', 64), repeat('6', 64), repeat('v', 43), now() + interval '15 minutes'),
  'creating a recovery intent prunes expired unused proof'
);
reset role;
select is(
  (select count(*) from public.password_recovery_intents where state_hash = repeat('d', 64)),
  0::bigint,
  'expired unused recovery proof is removed during the next create'
);
delete from public.password_recovery_intents where state_hash = repeat('f', 64);

set local role service_role;
do $$ begin
  perform public.create_password_recovery_intent(repeat('a', 64), repeat('b', 64), repeat('v', 43), now() + interval '15 minutes');
  perform public.register_mobile_password_recovery_session(repeat('a', 64), repeat('c', 64), repeat('1', 64), '70000000-0000-4000-8000-000000000101', '20000000-0000-4000-8000-000000000110', '10000000-0000-4000-8000-000000000101', now() + interval '15 minutes');
end $$;
reset role;
select is((select count(*) from public.password_recovery_sessions where session_id = '20000000-0000-4000-8000-000000000110'), 0::bigint, 'an address-mismatched proof cannot register recovery');

set local role service_role;
do $$ begin
  perform public.register_mobile_password_recovery_session(repeat('a', 64), repeat('b', 64), repeat('1', 64), '70000000-0000-4000-8000-000000000101', '20000000-0000-4000-8000-000000000110', '10000000-0000-4000-8000-000000000101', now() + interval '15 minutes');
end $$;
reset role;
select ok(
  not exists (select 1 from public.password_recovery_intents where state_hash = repeat('a', 64))
  and exists (select 1 from public.password_recovery_sessions where session_id = '20000000-0000-4000-8000-000000000110'),
  'matching proof is deleted atomically with recovery registration'
);
select is(
  (select handle_hash from public.password_recovery_sessions where session_id = '20000000-0000-4000-8000-000000000110'),
  repeat('1', 64),
  'mobile recovery stores only the opaque handle hash'
);
select is(
  (select reset_operation_id from public.password_recovery_sessions where session_id = '20000000-0000-4000-8000-000000000110'),
  '70000000-0000-4000-8000-000000000101'::uuid,
  'mobile recovery stores a stable reset operation identifier'
);
set local role service_role;
select is(
  public.register_mobile_password_recovery_session(repeat('a', 64), repeat('b', 64), repeat('1', 64), '70000000-0000-4000-8000-000000000101', '20000000-0000-4000-8000-000000000110', '10000000-0000-4000-8000-000000000101', now() + interval '15 minutes'),
  true,
  'a lost mobile registration response is idempotently reconciled'
);
reset role;

set local role service_role;
do $$ begin
  perform public.register_mobile_password_recovery_session(repeat('a', 64), repeat('b', 64), repeat('1', 64), '70000000-0000-4000-8000-000000000101', '20000000-0000-4000-8000-000000000111', '10000000-0000-4000-8000-000000000101', now() + interval '15 minutes');
end $$;
reset role;
select is((select count(*) from public.password_recovery_sessions where session_id = '20000000-0000-4000-8000-000000000111'), 0::bigint, 'consumed recovery proof cannot be replayed');

delete from public.password_recovery_sessions where session_id = '20000000-0000-4000-8000-000000000110';
delete from public.password_recovery_intents where state_hash = repeat('a', 64);

set local role service_role;
do $$ begin
  perform public.register_password_recovery_session('20000000-0000-4000-8000-000000000101', '10000000-0000-4000-8000-000000000101', now() + interval '15 minutes');
  perform public.register_password_recovery_session('20000000-0000-4000-8000-000000000102', '10000000-0000-4000-8000-000000000102', now() + interval '15 minutes');
  perform public.register_password_recovery_session('20000000-0000-4000-8000-000000000103', '10000000-0000-4000-8000-000000000101', clock_timestamp() + interval '1 millisecond');
end $$;
reset role;

update public.password_recovery_sessions
set reset_operation_id = case session_id
  when '20000000-0000-4000-8000-000000000101' then '40000000-0000-4000-8000-000000000101'::uuid
  when '20000000-0000-4000-8000-000000000102' then '40000000-0000-4000-8000-000000000103'::uuid
  else reset_operation_id
end
where session_id in (
  '20000000-0000-4000-8000-000000000101',
  '20000000-0000-4000-8000-000000000102'
);

select is((select count(*) from public.password_recovery_sessions), 3::bigint, 'trusted registration creates one row per Auth session');

select pg_sleep(0.01);
set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '10000000-0000-4000-8000-000000000101',
    'session_id', '20000000-0000-4000-8000-000000000101'
  )::text,
  true
);
select pg_catalog.set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000101', true);
select is((select count(*) from public.groups), 0::bigint, 'active recovery sessions cannot read tenant groups');
select is((select app.active_membership_role()), null::public.membership_role, 'active recovery sessions have no membership role');
select is((select count(*) from public.resolve_identity_context()), 0::bigint, 'active recovery sessions have no identity context');

select pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '10000000-0000-4000-8000-000000000101',
    'session_id', '20000000-0000-4000-8000-000000000199'
  )::text,
  true
);
select pg_catalog.set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000101', true);
select is((select count(*) from public.groups), 1::bigint, 'the same identity retains tenant reads outside a registered recovery session');
select is((select app.active_membership_role()), 'member'::public.membership_role, 'the same identity retains its membership role outside recovery');
select is((select count(*) from public.resolve_identity_context()), 1::bigint, 'the same identity retains identity context outside recovery');

select pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '10000000-0000-4000-8000-000000000101',
    'session_id', '20000000-0000-4000-8000-000000000103'
  )::text,
  true
);
select pg_catalog.set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000101', true);
select is((select count(*) from public.groups), 0::bigint, 'expired recovery sessions cannot read tenant groups');
select is((select app.active_membership_role()), null::public.membership_role, 'expired recovery sessions have no membership role');
select is((select count(*) from public.resolve_identity_context()), 0::bigint, 'expired recovery sessions have no identity context');
reset role;

set local role service_role;
do $$ begin
  perform public.register_password_recovery_session('20000000-0000-4000-8000-000000000104', '10000000-0000-4000-8000-000000000101', clock_timestamp() + interval '1 hour');
end $$;
reset role;
select is((select count(*) from public.password_recovery_sessions where session_id = '20000000-0000-4000-8000-000000000104'), 0::bigint, 'registry refuses recovery lifetimes beyond 15 minutes');
select is((select count(*) from public.password_recovery_sessions where session_id = '20000000-0000-4000-8000-000000000101' and user_id = '10000000-0000-4000-8000-000000000102'), 0::bigint, 'recovery sessions remain bound to one identity');
select ok((select expires_at > created_at from public.password_recovery_sessions where session_id = '20000000-0000-4000-8000-000000000101'), 'registered recovery session has a bounded future expiry');

set local role service_role;
do $$ begin
  perform public.claim_password_recovery_session('20000000-0000-4000-8000-000000000101', '10000000-0000-4000-8000-000000000101', '30000000-0000-4000-8000-000000000101', clock_timestamp());
end $$;
reset role;
select is((select claim_id from public.password_recovery_sessions where session_id = '20000000-0000-4000-8000-000000000101'), '30000000-0000-4000-8000-000000000101'::uuid, 'active recovery session is claimed atomically');

set local role service_role;
do $$ begin
  perform public.claim_password_recovery_session('20000000-0000-4000-8000-000000000101', '10000000-0000-4000-8000-000000000101', '30000000-0000-4000-8000-000000000102', clock_timestamp());
end $$;
reset role;
select is((select claim_id from public.password_recovery_sessions where session_id = '20000000-0000-4000-8000-000000000101'), '30000000-0000-4000-8000-000000000101'::uuid, 'a concurrent claimant cannot replace the winning claim');

update auth.users
set encrypted_password = 'recovered-hash-a'
where id = '10000000-0000-4000-8000-000000000101';
select ok((select consumed_at is not null from public.password_recovery_sessions where session_id = '20000000-0000-4000-8000-000000000101'), 'only the winning claim consumes the recovery session');
select is(
  (select action from public.audit_events where correlation_id = '40000000-0000-4000-8000-000000000101'),
  'identity.password_recovered',
  'successful account recovery appends a correlated group audit event'
);
select is(
  (select after_state from public.audit_events where correlation_id = '40000000-0000-4000-8000-000000000101'),
  '{"recovery_session_consumed": true}'::jsonb,
  'recovery audit contains no password or token material'
);

set local role service_role;
select is(
  public.consume_password_recovery_session(
    '20000000-0000-4000-8000-000000000101',
    '10000000-0000-4000-8000-000000000101',
    '30000000-0000-4000-8000-000000000101',
    clock_timestamp() + interval '1 hour',
    '40000000-0000-4000-8000-000000000101'
  ),
  true,
  'consuming the same claim and correlation is idempotent'
);
reset role;
select is(
  (select count(*) from public.audit_events where correlation_id = '40000000-0000-4000-8000-000000000101'),
  1::bigint,
  'an idempotent recovery retry does not duplicate its correlated audit'
);

set local role service_role;
select is(
  public.consume_password_recovery_session(
    '20000000-0000-4000-8000-000000000101',
    '10000000-0000-4000-8000-000000000101',
    '30000000-0000-4000-8000-000000000101',
    clock_timestamp() + interval '1 hour',
    '40000000-0000-4000-8000-000000000102'
  ),
  false,
  'a consumed claim cannot be retried with a different correlation'
);
reset role;

set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '10000000-0000-4000-8000-000000000101',
    'session_id', '20000000-0000-4000-8000-000000000101'
  )::text,
  true
);
select pg_catalog.set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000101', true);
select is((select count(*) from public.groups), 0::bigint, 'consumed recovery sessions cannot read tenant groups');
select is((select app.active_membership_role()), null::public.membership_role, 'consumed recovery sessions have no membership role');
select is((select count(*) from public.resolve_identity_context()), 0::bigint, 'consumed recovery sessions have no identity context');
reset role;

create temporary table consumed_snapshot as
select consumed_at from public.password_recovery_sessions
where session_id = '20000000-0000-4000-8000-000000000101';
select is((select consumed_at from public.password_recovery_sessions where session_id = '20000000-0000-4000-8000-000000000101'), (select consumed_at from consumed_snapshot), 'consumed recovery session cannot be replayed');

set local role service_role;
do $$ begin
  perform public.claim_password_recovery_session('20000000-0000-4000-8000-000000000102', '10000000-0000-4000-8000-000000000102', '30000000-0000-4000-8000-000000000104', clock_timestamp());
end $$;
reset role;
update auth.users
set encrypted_password = 'recovered-hash-b'
where id = '10000000-0000-4000-8000-000000000102';
set local role service_role;
select is(
  public.consume_password_recovery_session('20000000-0000-4000-8000-000000000102', '10000000-0000-4000-8000-000000000102', '30000000-0000-4000-8000-000000000104', clock_timestamp(), '40000000-0000-4000-8000-000000000103'),
  true,
  'unattached identity recovery consumes through the same transaction'
);
reset role;
select is(
  (select action from public.identity_security_audit_events where correlation_id = '40000000-0000-4000-8000-000000000103'),
  'identity.password_recovered',
  'unattached identity recovery appends a server-only security audit'
);
select is(
  (select after_state from public.identity_security_audit_events where correlation_id = '40000000-0000-4000-8000-000000000103'),
  '{"recovery_session_consumed": true}'::jsonb,
  'identity security audit contains no password or token material'
);
select is(
  (select count(*) from public.audit_events where correlation_id = '40000000-0000-4000-8000-000000000103'),
  0::bigint,
  'unattached identity recovery does not fabricate a tenant audit'
);

select pg_sleep(0.01);
set local role service_role;
do $$ begin
  perform public.claim_password_recovery_session('20000000-0000-4000-8000-000000000103', '10000000-0000-4000-8000-000000000101', '30000000-0000-4000-8000-000000000103', clock_timestamp());
end $$;
reset role;
select is((select claim_id from public.password_recovery_sessions where session_id = '20000000-0000-4000-8000-000000000103'), null::uuid, 'expired recovery session cannot be claimed');
select is((select count(*) from public.password_recovery_sessions where consumed_at is not null), 2::bigint, 'only the two explicitly consumed recovery sessions are marked consumed');

select * from finish();
rollback;
