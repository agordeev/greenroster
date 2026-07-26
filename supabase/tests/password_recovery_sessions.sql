begin;

select plan(28);

select has_table('public', 'password_recovery_sessions', 'password recovery session registry exists');
select col_type_is('public', 'password_recovery_sessions', 'session_id', 'uuid', 'recovery session identifiers are UUIDs');
select col_type_is('public', 'password_recovery_sessions', 'user_id', 'app.entity_id', 'recovery sessions reference entity IDs');
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
select ok(has_function_privilege('service_role', 'public.consume_password_recovery_session(uuid,uuid,uuid,timestamptz)', 'execute'), 'service role can consume its exact claim');

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at
)
values
  ('10000000-0000-4000-8000-000000000101', 'recovery-a@example.test', now(), false, false, now(), now()),
  ('10000000-0000-4000-8000-000000000102', 'recovery-b@example.test', now(), false, false, now(), now());

set local role service_role;
do $$ begin
  perform public.register_password_recovery_session('20000000-0000-4000-8000-000000000101', '10000000-0000-4000-8000-000000000101', now() + interval '15 minutes');
  perform public.register_password_recovery_session('20000000-0000-4000-8000-000000000102', '10000000-0000-4000-8000-000000000102', now() + interval '15 minutes');
  perform public.register_password_recovery_session('20000000-0000-4000-8000-000000000103', '10000000-0000-4000-8000-000000000101', clock_timestamp() + interval '1 millisecond');
end $$;
reset role;

select is((select count(*) from public.password_recovery_sessions), 3::bigint, 'trusted registration creates one row per Auth session');
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

set local role service_role;
do $$ begin
  perform public.consume_password_recovery_session('20000000-0000-4000-8000-000000000101', '10000000-0000-4000-8000-000000000101', '30000000-0000-4000-8000-000000000101', clock_timestamp());
end $$;
reset role;
select ok((select consumed_at is not null from public.password_recovery_sessions where session_id = '20000000-0000-4000-8000-000000000101'), 'only the winning claim consumes the recovery session');

create temporary table consumed_snapshot as
select consumed_at from public.password_recovery_sessions
where session_id = '20000000-0000-4000-8000-000000000101';
set local role service_role;
do $$ begin
  perform public.consume_password_recovery_session('20000000-0000-4000-8000-000000000101', '10000000-0000-4000-8000-000000000101', '30000000-0000-4000-8000-000000000101', clock_timestamp() + interval '1 hour');
end $$;
reset role;
select is((select consumed_at from public.password_recovery_sessions where session_id = '20000000-0000-4000-8000-000000000101'), (select consumed_at from consumed_snapshot), 'consumed recovery session cannot be replayed');

select pg_sleep(0.01);
set local role service_role;
do $$ begin
  perform public.claim_password_recovery_session('20000000-0000-4000-8000-000000000103', '10000000-0000-4000-8000-000000000101', '30000000-0000-4000-8000-000000000103', clock_timestamp());
end $$;
reset role;
select is((select claim_id from public.password_recovery_sessions where session_id = '20000000-0000-4000-8000-000000000103'), null::uuid, 'expired recovery session cannot be claimed');
select is((select count(*) from public.password_recovery_sessions where consumed_at is not null), 1::bigint, 'only one recovery session is consumed across the concurrency fixture');

select * from finish();
rollback;
