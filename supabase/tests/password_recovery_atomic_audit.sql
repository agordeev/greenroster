begin;

create extension if not exists pgtap with schema extensions;

select plan(43);

select has_trigger(
  'auth',
  'users',
  'auth_user_password_recovery_audit',
  'Supabase Auth password changes have an atomic recovery audit trigger'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'app.finalize_password_recovery_claim(uuid,uuid,uuid,uuid)',
    'execute'
  ),
  'authenticated clients cannot invoke the private recovery finalizer'
);
select ok(
  not has_function_privilege(
    'service_role',
    'app.finalize_password_recovery_claim(uuid,uuid,uuid,uuid)',
    'execute'
  ),
  'the service role cannot bypass the public constrained recovery functions'
);
select ok(
  not has_function_privilege(
    'service_role',
    'app.finalize_recovery_after_password_change()',
    'execute'
  ),
  'the Auth trigger finalizer is not an application RPC'
);
select is(
  (
    select count(*)
    from public.password_recovery_sessions as recovery
    join auth.users as identity on identity.id = recovery.user_id
    where recovery.claim_id is not null
      and recovery.consumed_at is null
      and identity.raw_app_meta_data -> 'greenroster_password_recovery'
        is distinct from pg_catalog.jsonb_build_object(
          'session_id', recovery.session_id,
          'claim_id', recovery.claim_id,
          'operation_id', recovery.reset_operation_id
        )
  ),
  0::bigint,
  'forward migration leaves no live legacy claim without its exact Auth command'
);

insert into auth.users (
  id,
  email,
  encrypted_password,
  email_confirmed_at,
  is_sso_user,
  is_anonymous,
  created_at,
  updated_at
)
values
  ('16000000-0000-4000-8000-000000000001', 'atomic-group@example.test', 'old-hash-1', now(), false, false, now(), now()),
  ('16000000-0000-4000-8000-000000000002', 'atomic-unattached@example.test', 'old-hash-2', now(), false, false, now(), now()),
  ('16000000-0000-4000-8000-000000000003', 'ordinary-password@example.test', 'old-hash-3', now(), false, false, now(), now()),
  ('16000000-0000-4000-8000-000000000004', 'atomic-rollback@example.test', 'old-hash-4', now(), false, false, now(), now()),
  ('16000000-0000-4000-8000-000000000005', 'atomic-claims@example.test', 'old-hash-5', now(), false, false, now(), now()),
  ('16000000-0000-4000-8000-000000000006', 'atomic-expired-claim@example.test', 'old-hash-6', now(), false, false, now(), now()),
  ('16000000-0000-4000-8000-000000000007', 'atomic-ambiguous@example.test', 'old-hash-7', now(), false, false, now(), now()),
  ('16000000-0000-4000-8000-000000000008', 'atomic-stale-claim@example.test', 'old-hash-8', now(), false, false, now(), now());

insert into public.groups (id, name, time_zone)
values ('56000000-0000-4000-8000-000000000001', 'Atomic Recovery', 'UTC');

insert into public.user_profiles (user_id)
values ('16000000-0000-4000-8000-000000000001');

insert into public.memberships (
  id, group_id, user_id, role, status, activated_at
)
values (
  '66000000-0000-4000-8000-000000000001',
  '56000000-0000-4000-8000-000000000001',
  '16000000-0000-4000-8000-000000000001',
  'member',
  'active',
  now()
);

insert into public.password_recovery_sessions (
  session_id,
  user_id,
  expires_at,
  claim_id,
  claimed_at,
  reset_operation_id,
  created_at
)
values
  ('26000000-0000-4000-8000-000000000001', '16000000-0000-4000-8000-000000000001', now() + interval '10 minutes', '36000000-0000-4000-8000-000000000001', now(), '46000000-0000-4000-8000-000000000001', now() - interval '1 minute'),
  ('26000000-0000-4000-8000-000000000002', '16000000-0000-4000-8000-000000000002', now() + interval '10 minutes', '36000000-0000-4000-8000-000000000002', now(), '46000000-0000-4000-8000-000000000002', now() - interval '1 minute'),
  ('26000000-0000-4000-8000-000000000004', '16000000-0000-4000-8000-000000000004', now() + interval '10 minutes', '36000000-0000-4000-8000-000000000004', now(), '46000000-0000-4000-8000-000000000004', now() - interval '1 minute'),
  ('26000000-0000-4000-8000-000000000005', '16000000-0000-4000-8000-000000000005', now() + interval '10 minutes', null, null, '46000000-0000-4000-8000-000000000005', now() - interval '1 minute'),
  ('26000000-0000-4000-8000-000000000006', '16000000-0000-4000-8000-000000000005', now() + interval '10 minutes', null, null, '46000000-0000-4000-8000-000000000006', now() - interval '1 minute'),
  ('26000000-0000-4000-8000-000000000007', '16000000-0000-4000-8000-000000000006', now() - interval '5 minutes', '36000000-0000-4000-8000-000000000007', now() - interval '10 minutes', '46000000-0000-4000-8000-000000000007', now() - interval '20 minutes'),
  ('26000000-0000-4000-8000-000000000008', '16000000-0000-4000-8000-000000000007', now() + interval '10 minutes', '36000000-0000-4000-8000-000000000008', now(), '46000000-0000-4000-8000-000000000008', now() - interval '1 minute'),
  ('26000000-0000-4000-8000-000000000009', '16000000-0000-4000-8000-000000000007', now() + interval '10 minutes', '36000000-0000-4000-8000-000000000009', now(), '46000000-0000-4000-8000-000000000009', now() - interval '1 minute'),
  ('26000000-0000-4000-8000-000000000010', '16000000-0000-4000-8000-000000000008', now() - interval '5 minutes', '36000000-0000-4000-8000-000000000010', now() - interval '10 minutes', '46000000-0000-4000-8000-000000000010', now() - interval '20 minutes'),
  ('26000000-0000-4000-8000-000000000011', '16000000-0000-4000-8000-000000000008', now() + interval '10 minutes', null, null, '46000000-0000-4000-8000-000000000011', now() - interval '1 minute');

set local role service_role;
select is(
  public.consume_password_recovery_session(
    '26000000-0000-4000-8000-000000000001',
    '16000000-0000-4000-8000-000000000001',
    '36000000-0000-4000-8000-000000000001',
    clock_timestamp(),
    '46000000-0000-4000-8000-000000000099'
  ),
  false,
  'an unconsumed claim rejects a correlation other than its stable operation ID'
);
reset role;
set local role service_role;
select is(
  public.consume_password_recovery_session(
    '26000000-0000-4000-8000-000000000001',
    '16000000-0000-4000-8000-000000000001',
    '36000000-0000-4000-8000-000000000001',
    clock_timestamp(),
    '46000000-0000-4000-8000-000000000001'
  ),
  false,
  'confirmation cannot consume or audit before the Auth password transaction'
);
reset role;
select ok(
  (
    select consumed_at is null
    from public.password_recovery_sessions
    where session_id = '26000000-0000-4000-8000-000000000001'
  ),
  'a mismatched correlation cannot consume recovery state'
);
select is(
  (
    select count(*)
    from public.audit_events
    where actor_user_id = '16000000-0000-4000-8000-000000000001'
      and action = 'identity.password_recovered'
  ),
  0::bigint,
  'a mismatched correlation writes no recovery audit'
);

select lives_ok(
  $$
    update auth.users
    set encrypted_password = 'new-hash-1',
        raw_app_meta_data = pg_catalog.jsonb_build_object(
          'greenroster_password_recovery',
          pg_catalog.jsonb_build_object(
            'session_id', '26000000-0000-4000-8000-000000000001',
            'claim_id', '36000000-0000-4000-8000-000000000001',
            'operation_id', '46000000-0000-4000-8000-000000000001'
          )
        )
    where id = '16000000-0000-4000-8000-000000000001'
  $$,
  'an attached recovery password change commits through the Auth trigger'
);
select ok(
  (
    select consumed_at is not null
      and consumed_correlation_id = '46000000-0000-4000-8000-000000000001'
    from public.password_recovery_sessions
    where session_id = '26000000-0000-4000-8000-000000000001'
  ),
  'the Auth password transaction consumes the exact claimed recovery operation'
);
select is(
  (
    select correlation_id
    from public.audit_events
    where actor_user_id = '16000000-0000-4000-8000-000000000001'
      and action = 'identity.password_recovered'
  ),
  '46000000-0000-4000-8000-000000000001'::uuid,
  'the stable recovery operation reaches the tenant audit'
);
select is(
  (
    select operation_id
    from public.audit_events
    where actor_user_id = '16000000-0000-4000-8000-000000000001'
      and action = 'identity.password_recovered'
  ),
  '46000000-0000-4000-8000-000000000001'::uuid,
  'the tenant audit retains the exactly-once operation identifier'
);
select is(
  (
    select count(*)
    from public.audit_events
    where actor_user_id = '16000000-0000-4000-8000-000000000001'
      and action = 'identity.password_recovered'
  ),
  1::bigint,
  'the password transaction writes exactly one tenant audit event'
);
select is(
  (
    select after_state
    from public.audit_events
    where actor_user_id = '16000000-0000-4000-8000-000000000001'
      and action = 'identity.password_recovered'
  ),
  '{"recovery_session_consumed": true}'::jsonb,
  'the atomic audit contains no password or credential material'
);
select ok(
  (
    select not raw_app_meta_data ? 'greenroster_password_recovery'
    from auth.users
    where id = '16000000-0000-4000-8000-000000000001'
  ),
  'the ephemeral recovery command is not retained in Auth user metadata'
);

set local role service_role;
select is(
  public.consume_password_recovery_session(
    '26000000-0000-4000-8000-000000000001',
    '16000000-0000-4000-8000-000000000001',
    '36000000-0000-4000-8000-000000000001',
    clock_timestamp(),
    '46000000-0000-4000-8000-000000000001'
  ),
  true,
  'the post-response consume call idempotently confirms trigger finalization'
);
reset role;
select is(
  (
    select count(*)
    from public.audit_events
    where actor_user_id = '16000000-0000-4000-8000-000000000001'
      and action = 'identity.password_recovered'
  ),
  1::bigint,
  'idempotent confirmation cannot duplicate the trigger audit'
);
select lives_ok(
  $$ update auth.users set encrypted_password = 'newer-hash-1' where id = '16000000-0000-4000-8000-000000000001' $$,
  'a later ordinary password change remains available'
);
select is(
  (
    select count(*)
    from public.audit_events
    where actor_user_id = '16000000-0000-4000-8000-000000000001'
      and action = 'identity.password_recovered'
  ),
  1::bigint,
  'a later ordinary password change does not duplicate recovery audit'
);

select lives_ok(
  $$
    update auth.users
    set encrypted_password = 'new-hash-2',
        raw_app_meta_data = pg_catalog.jsonb_build_object(
          'greenroster_password_recovery',
          pg_catalog.jsonb_build_object(
            'session_id', '26000000-0000-4000-8000-000000000002',
            'claim_id', '36000000-0000-4000-8000-000000000002',
            'operation_id', '46000000-0000-4000-8000-000000000002'
          )
        )
    where id = '16000000-0000-4000-8000-000000000002'
  $$,
  'an unattached identity recovery commits through the same Auth trigger'
);
select is(
  (
    select action
    from public.identity_security_audit_events
    where user_id = '16000000-0000-4000-8000-000000000002'
  ),
  'identity.password_recovered'::text,
  'an unattached recovery writes the server-only identity audit'
);
select is(
  (
    select operation_id
    from public.identity_security_audit_events
    where user_id = '16000000-0000-4000-8000-000000000002'
  ),
  '46000000-0000-4000-8000-000000000002'::uuid,
  'the unattached identity audit retains the exactly-once operation identifier'
);
select is(
  (
    select count(*)
    from public.audit_events
    where actor_user_id = '16000000-0000-4000-8000-000000000002'
  ),
  0::bigint,
  'an unattached recovery does not fabricate a tenant audit'
);

select lives_ok(
  $$ update auth.users set encrypted_password = 'new-hash-3' where id = '16000000-0000-4000-8000-000000000003' $$,
  'an ordinary password change without a recovery claim still succeeds'
);
select is(
  (
    select count(*)
    from public.audit_events
    where actor_user_id = '16000000-0000-4000-8000-000000000003'
  ) + (
    select count(*)
    from public.identity_security_audit_events
    where user_id = '16000000-0000-4000-8000-000000000003'
  ),
  0::bigint,
  'an ordinary password change is not mislabeled as account recovery'
);

select throws_ok(
  $$
    do $rollback$
    begin
      update auth.users
      set encrypted_password = 'new-hash-4',
          raw_app_meta_data = pg_catalog.jsonb_build_object(
            'greenroster_password_recovery',
            pg_catalog.jsonb_build_object(
              'session_id', '26000000-0000-4000-8000-000000000004',
              'claim_id', '36000000-0000-4000-8000-000000000004',
              'operation_id', '46000000-0000-4000-8000-000000000004'
            )
          )
      where id = '16000000-0000-4000-8000-000000000004';
      raise exception 'forced_password_transaction_rollback';
    end
    $rollback$
  $$,
  'P0001',
  'forced_password_transaction_rollback',
  'a failed Auth password transaction rolls back the finalizer'
);
select ok(
  (
    select consumed_at is null
    from public.password_recovery_sessions
    where session_id = '26000000-0000-4000-8000-000000000004'
  ),
  'a rolled-back password change leaves the recovery unconsumed'
);
select is(
  (
    select count(*)
    from public.identity_security_audit_events
    where user_id = '16000000-0000-4000-8000-000000000004'
  ),
  0::bigint,
  'a rolled-back password change leaves no recovery audit'
);

select lives_ok(
  $$
    update auth.users
    set encrypted_password = 'new-hash-6',
        raw_app_meta_data = pg_catalog.jsonb_build_object(
          'greenroster_password_recovery',
          pg_catalog.jsonb_build_object(
            'session_id', '26000000-0000-4000-8000-000000000007',
            'claim_id', '36000000-0000-4000-8000-000000000007',
            'operation_id', '46000000-0000-4000-8000-000000000007'
          )
        )
    where id = '16000000-0000-4000-8000-000000000006'
  $$,
  'an exact server marker finalizes a claim that expires after acquisition'
);
select ok(
  (
    select consumed_at is not null
    from public.password_recovery_sessions
    where session_id = '26000000-0000-4000-8000-000000000007'
  ),
  'claim expiry during the Auth transaction cannot recreate an audit-loss window'
);

select throws_ok(
  $$
    update auth.users
    set encrypted_password = 'new-hash-7',
        raw_app_meta_data = pg_catalog.jsonb_build_object(
          'greenroster_password_recovery',
          pg_catalog.jsonb_build_object(
            'session_id', '26000000-0000-4000-8000-000000000099',
            'claim_id', '36000000-0000-4000-8000-000000000099',
            'operation_id', '46000000-0000-4000-8000-000000000099'
          )
        )
    where id = '16000000-0000-4000-8000-000000000007'
  $$,
  'P0001',
  'password_recovery_claim_mismatch',
  'a password update carrying no exact claimed recovery fails closed'
);
select is(
  (
    select encrypted_password
    from auth.users
    where id = '16000000-0000-4000-8000-000000000007'
  )::text,
  'old-hash-7'::text,
  'a mismatched recovery marker rolls back the password hash change'
);
select is(
  (
    select count(*)
    from public.password_recovery_sessions
    where user_id = '16000000-0000-4000-8000-000000000007'
      and consumed_at is not null
  ),
  0::bigint,
  'a mismatched recovery marker consumes no candidate claim'
);

set local role service_role;
select is(
  public.claim_password_recovery_session(
    '26000000-0000-4000-8000-000000000005',
    '16000000-0000-4000-8000-000000000005',
    '36000000-0000-4000-8000-000000000005',
    clock_timestamp()
  ),
  true,
  'the first active recovery claim for an identity succeeds'
);
select is(
  public.claim_password_recovery_session(
    '26000000-0000-4000-8000-000000000006',
    '16000000-0000-4000-8000-000000000005',
    '36000000-0000-4000-8000-000000000006',
    clock_timestamp()
  ),
  false,
  'a second active recovery claim for the same identity is refused'
);
reset role;
select is(
  (
    select raw_app_meta_data -> 'greenroster_password_recovery'
    from auth.users
    where id = '16000000-0000-4000-8000-000000000005'
  ),
  pg_catalog.jsonb_build_object(
    'session_id', '26000000-0000-4000-8000-000000000005'::uuid,
    'claim_id', '36000000-0000-4000-8000-000000000005'::uuid,
    'operation_id', '46000000-0000-4000-8000-000000000005'::uuid
  ),
  'claiming writes the exact transient command into server-only Auth app metadata'
);
select is(
  (
    select count(*)
    from public.password_recovery_sessions
    where user_id = '16000000-0000-4000-8000-000000000005'
      and claim_id is not null
      and consumed_at is null
  ),
  1::bigint,
  'one identity has at most one active claimed recovery operation'
);

set local role service_role;
select is(
  public.release_password_recovery_claim(
    '26000000-0000-4000-8000-000000000005',
    '16000000-0000-4000-8000-000000000005',
    '36000000-0000-4000-8000-000000000005'
  ),
  true,
  'the winning claim can be released after an Auth failure'
);
reset role;
select ok(
  (
    select not raw_app_meta_data ? 'greenroster_password_recovery'
    from auth.users
    where id = '16000000-0000-4000-8000-000000000005'
  ),
  'releasing the claim clears its transient Auth command'
);

set local role service_role;
select is(
  public.claim_password_recovery_session(
    '26000000-0000-4000-8000-000000000011',
    '16000000-0000-4000-8000-000000000008',
    '36000000-0000-4000-8000-000000000011',
    clock_timestamp()
  ),
  true,
  'a newer recovery can claim after the abandoned command lease expires'
);
reset role;
select is(
  (
    select claim_id
    from public.password_recovery_sessions
    where session_id = '26000000-0000-4000-8000-000000000010'
  ),
  null::uuid,
  'claim lease cleanup releases the abandoned recovery'
);
select is(
  (
    select raw_app_meta_data -> 'greenroster_password_recovery' ->> 'session_id'
    from auth.users
    where id = '16000000-0000-4000-8000-000000000008'
  ),
  '26000000-0000-4000-8000-000000000011'::text,
  'stale cleanup arms only the newer recovery command'
);

select * from finish();

rollback;
