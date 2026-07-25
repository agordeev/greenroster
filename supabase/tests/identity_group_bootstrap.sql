begin;

create extension if not exists pgtap with schema extensions;

select plan(93);

select has_type('public', 'membership_role', 'membership roles have a database enum');
select has_type('public', 'membership_status', 'membership states have a database enum');
select results_eq(
  $$ select enumlabel from pg_catalog.pg_enum where enumtypid = 'public.membership_role'::regtype order by enumsortorder $$,
  $$ values ('member'::name), ('coordinator'::name), ('administrator'::name) $$,
  'membership roles match the product contract exactly'
);
select results_eq(
  $$ select enumlabel from pg_catalog.pg_enum where enumtypid = 'public.membership_status'::regtype order by enumsortorder $$,
  $$ values ('pending'::name), ('active'::name), ('inactive'::name) $$,
  'membership states match the product contract exactly'
);

select has_table('public', 'user_profiles', 'user profiles exist');
select has_table('public', 'groups', 'groups exist');
select has_table('public', 'memberships', 'memberships exist');
select has_table('public', 'audit_events', 'audit events exist');
select has_pk('public', 'user_profiles', 'user profiles have an immutable identity primary key');
select has_pk('public', 'groups', 'groups have an immutable identity primary key');
select has_pk('public', 'memberships', 'memberships have an immutable identity primary key');
select has_pk('public', 'audit_events', 'audit events have an immutable identity primary key');

select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.user_profiles'::regclass
      and confrelid = 'auth.users'::regclass
      and contype = 'f'
  ),
  'profiles reference Supabase Auth identities'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.memberships'::regclass
      and confrelid = 'public.groups'::regclass
      and contype = 'f'
  ),
  'memberships reference their tenant group'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.memberships'::regclass
      and confrelid = 'auth.users'::regclass
      and contype = 'f'
  ),
  'attached memberships reference Supabase Auth identities'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.audit_events'::regclass
      and confrelid = 'public.groups'::regclass
      and contype = 'f'
  ),
  'audit events retain their tenant group'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.audit_events'::regclass
      and confrelid = 'auth.users'::regclass
      and contype = 'f'
  ),
  'audit actors reference Supabase Auth identities without cascading history deletion'
);

select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.user_profiles'::regclass), 'profiles enable RLS');
select ok((select relforcerowsecurity from pg_catalog.pg_class where oid = 'public.user_profiles'::regclass), 'profiles force RLS');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.groups'::regclass), 'groups enable RLS');
select ok((select relforcerowsecurity from pg_catalog.pg_class where oid = 'public.groups'::regclass), 'groups force RLS');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.memberships'::regclass), 'memberships enable RLS');
select ok((select relforcerowsecurity from pg_catalog.pg_class where oid = 'public.memberships'::regclass), 'memberships force RLS');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.audit_events'::regclass), 'audit events enable RLS');
select ok((select relforcerowsecurity from pg_catalog.pg_class where oid = 'public.audit_events'::regclass), 'audit events force RLS');

select ok(
  exists (
    select 1
    from pg_catalog.pg_index
    where indexrelid = 'public.memberships_one_attached_identity_idx'::regclass
      and indisunique
      and indpred is not null
  ),
  'one partial unique index enforces a single attached v1 membership per identity'
);
select ok(
  not pg_catalog.has_function_privilege('authenticated', 'public.bootstrap_group(uuid,text,text,uuid,uuid)', 'execute'),
  'authenticated application users cannot invoke server-only group bootstrap'
);
select ok(
  not pg_catalog.has_function_privilege('anon', 'public.bootstrap_group(uuid,text,text,uuid,uuid)', 'execute'),
  'anonymous users cannot invoke server-only group bootstrap'
);
select ok(
  pg_catalog.has_function_privilege('service_role', 'public.bootstrap_group(uuid,text,text,uuid,uuid)', 'execute'),
  'the trusted server role can invoke group bootstrap'
);
select ok(
  pg_catalog.has_function_privilege('authenticated', 'public.resolve_identity_context()', 'execute'),
  'authenticated users can resolve only their own active identity context'
);

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at
)
values
  ('10000000-0000-4000-8000-000000000001', 'admin-a@example.test', now(), false, false, now(), now()),
  ('10000000-0000-4000-8000-000000000002', 'admin-b@example.test', now(), false, false, now(), now()),
  ('10000000-0000-4000-8000-000000000003', 'member-a@example.test', now(), false, false, now(), now()),
  ('10000000-0000-4000-8000-000000000004', 'coordinator-a@example.test', now(), false, false, now(), now()),
  ('10000000-0000-4000-8000-000000000005', 'inactive-a@example.test', now(), false, false, now(), now()),
  ('10000000-0000-4000-8000-000000000006', 'disabled-a@example.test', now(), false, false, now(), now()),
  ('10000000-0000-4000-8000-000000000007', 'replacement-admin@example.test', now(), false, false, now(), now()),
  ('10000000-0000-4000-8000-000000000008', 'invalid-zone@example.test', now(), false, false, now(), now()),
  ('10000000-0000-4000-8000-000000000009', 'blank-group@example.test', now(), false, false, now(), now()),
  ('10000000-0000-4000-8000-000000000010', 'unverified@example.test', null, false, false, now(), now()),
  ('10000000-0000-4000-8000-000000000011', 'banned-a@example.test', now(), false, false, now(), now());

update auth.users
set banned_until = now() + interval '1 day'
where id = '10000000-0000-4000-8000-000000000011';

select lives_ok(
  $$
    create temporary table bootstrap_a as
    select * from public.bootstrap_group(
      '10000000-0000-4000-8000-000000000001',
      '  Green Hills  ',
      'America/New_York',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001'
    )
  $$,
  'a verified identity bootstraps its group and administrator membership atomically'
);
select lives_ok(
  $$
    create temporary table bootstrap_b as
    select * from public.bootstrap_group(
      '10000000-0000-4000-8000-000000000002',
      'Lake Club',
      'America/Chicago',
      '20000000-0000-4000-8000-000000000002',
      '30000000-0000-4000-8000-000000000002'
    )
  $$,
  'a second tenant bootstraps independently'
);
select is((select count(*) from public.groups), 2::bigint, 'bootstrap creates exactly one group per operation');
select is(
  (
    select count(*)
    from public.memberships
    where role = 'administrator' and status = 'active'
  ),
  2::bigint,
  'bootstrap creates exactly one active administrator membership per group'
);
select is((select count(*) from public.user_profiles), 2::bigint, 'bootstrap creates one Auth-linked profile per administrator');
select is((select count(*) from public.audit_events), 2::bigint, 'bootstrap commits its audit event in the same transaction');
select is(
  (
    select correlation_id
    from public.audit_events
    where actor_user_id = '10000000-0000-4000-8000-000000000001'
  ),
  '20000000-0000-4000-8000-000000000001'::uuid,
  'the request correlation identifier reaches the audit event'
);
select is(
  (
    select source
    from public.audit_events
    where actor_user_id = '10000000-0000-4000-8000-000000000001'
  ),
  'server'::text,
  'bootstrap records its trusted execution source'
);
select is(
  (
    select after_state ->> 'group_time_zone'
    from public.audit_events
    where actor_user_id = '10000000-0000-4000-8000-000000000001'
  ),
  'America/New_York'::text,
  'bootstrap audit retains safe group creation evidence'
);
select is(
  (select name from public.groups where id = (select created_group_id from bootstrap_a)),
  'Green Hills'::text,
  'group names are normalized by the server transaction'
);
select is(
  (select time_zone::text from public.groups where id = (select created_group_id from bootstrap_a)),
  'America/New_York'::text,
  'groups retain a validated IANA time zone'
);

select lives_ok(
  $$
    select * from public.bootstrap_group(
      '10000000-0000-4000-8000-000000000001',
      'ignored retry payload',
      'UTC',
      '20000000-0000-4000-8000-000000000099',
      '30000000-0000-4000-8000-000000000001'
    )
  $$,
  'retrying the same server operation is idempotent'
);
select is((select count(*) from public.groups), 2::bigint, 'idempotent retry creates no duplicate group');
select is((select count(*) from public.audit_events), 2::bigint, 'idempotent retry creates no duplicate audit event');
select throws_ok(
  $$
    select * from public.bootstrap_group(
      '10000000-0000-4000-8000-000000000001',
      'Another Group',
      'UTC',
      '20000000-0000-4000-8000-000000000003',
      '30000000-0000-4000-8000-000000000003'
    )
  $$,
  '23505',
  'identity_already_attached',
  'a second attached v1 membership is refused by the server transaction'
);
select is((select count(*) from public.groups), 2::bigint, 'membership conflict leaves no partial group');
select throws_ok(
  $$
    select * from public.bootstrap_group(
      '10000000-0000-4000-8000-000000000008',
      'Invalid Time Zone',
      'Mars/Olympus_Mons',
      '20000000-0000-4000-8000-000000000008',
      '30000000-0000-4000-8000-000000000008'
    )
  $$,
  '23514',
  null,
  'an invalid IANA time zone rejects the atomic bootstrap'
);
select is(
  (select count(*) from public.user_profiles where user_id = '10000000-0000-4000-8000-000000000008'),
  0::bigint,
  'a failed group insert rolls back the profile created earlier in the transaction'
);
select throws_ok(
  $$
    select * from public.bootstrap_group(
      '10000000-0000-4000-8000-000000000009',
      '   ',
      'UTC',
      '20000000-0000-4000-8000-000000000009',
      '30000000-0000-4000-8000-000000000009'
    )
  $$,
  '23514',
  null,
  'a blank group name rejects the atomic bootstrap'
);
select throws_ok(
  $$
    select * from public.bootstrap_group(
      '10000000-0000-4000-8000-000000000010',
      'Unverified Group',
      'UTC',
      '20000000-0000-4000-8000-000000000010',
      '30000000-0000-4000-8000-000000000010'
    )
  $$,
  'P0002',
  'administrator_identity_unavailable',
  'an unverified account cannot become the initial administrator'
);
select is(
  (select count(*) from public.user_profiles where user_id = '10000000-0000-4000-8000-000000000010'),
  0::bigint,
  'rejected unverified identity leaves no profile behind'
);

grant select on bootstrap_a, bootstrap_b to authenticated;

insert into public.user_profiles (user_id, disabled_at)
values
  ('10000000-0000-4000-8000-000000000003', null),
  ('10000000-0000-4000-8000-000000000004', null),
  ('10000000-0000-4000-8000-000000000005', null),
  ('10000000-0000-4000-8000-000000000006', now()),
  ('10000000-0000-4000-8000-000000000007', null),
  ('10000000-0000-4000-8000-000000000011', null);

insert into public.memberships (group_id, user_id, role, status, activated_at, inactivated_at)
values
  ((select created_group_id from bootstrap_a), '10000000-0000-4000-8000-000000000003', 'member', 'active', now(), null),
  ((select created_group_id from bootstrap_a), '10000000-0000-4000-8000-000000000004', 'coordinator', 'active', now(), null),
  ((select created_group_id from bootstrap_a), '10000000-0000-4000-8000-000000000005', 'member', 'inactive', null, now()),
  ((select created_group_id from bootstrap_a), '10000000-0000-4000-8000-000000000006', 'coordinator', 'active', now(), null),
  ((select created_group_id from bootstrap_a), '10000000-0000-4000-8000-000000000011', 'member', 'active', now(), null);

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select is((select count(*) from public.groups), 1::bigint, 'administrator reads only the active membership group');
select is(
  (select count(*) from public.groups where id = (select created_group_id from bootstrap_b)),
  0::bigint,
  'administrator cannot infer a guessed cross-group identifier'
);
select throws_ok(
  $$ select * from public.memberships $$,
  '42501',
  null,
  'administrator cannot read raw membership rows outside a server-filtered projection'
);
select is((select count(*) from public.audit_events), 1::bigint, 'administrator reads audit events only inside the active group');
select results_eq(
  $$ select group_id, role from public.resolve_identity_context() $$,
  $$ select created_group_id, 'administrator'::public.membership_role from bootstrap_a $$,
  'identity context derives the administrator group and role without client input'
);

select pg_catalog.set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select is((select count(*) from public.groups), 1::bigint, 'member reads only the active membership group');
select is((select count(*) from public.audit_events), 0::bigint, 'member cannot read administrator audit records');
select is(
  (select role from public.resolve_identity_context()),
  'member'::public.membership_role,
  'member role is resolved from current stored membership'
);

select pg_catalog.set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
select is((select count(*) from public.groups), 1::bigint, 'coordinator reads only the active membership group');
select is((select count(*) from public.audit_events), 0::bigint, 'coordinator has no unfiltered audit access');
select is(
  (select role from public.resolve_identity_context()),
  'coordinator'::public.membership_role,
  'coordinator role is resolved from current stored membership'
);

select pg_catalog.set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', true);
select is((select count(*) from public.groups), 0::bigint, 'inactive membership loses tenant reads immediately');
select is((select count(*) from public.resolve_identity_context()), 0::bigint, 'inactive membership has no protected identity context');

select pg_catalog.set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000006', true);
select is((select count(*) from public.groups), 0::bigint, 'disabled profile loses tenant reads immediately');
select is((select count(*) from public.resolve_identity_context()), 0::bigint, 'disabled profile has no protected identity context');

select pg_catalog.set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000011', true);
select is((select count(*) from public.groups), 0::bigint, 'Auth-banned identity loses tenant reads on the next request');
select is((select count(*) from public.resolve_identity_context()), 0::bigint, 'Auth-banned identity has no protected identity context');

select pg_catalog.set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$ insert into public.groups (name, time_zone) values ('Forbidden', 'UTC') $$,
  '42501',
  null,
  'member cannot bypass server mutations with a direct group insert'
);

select pg_catalog.set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$ update public.audit_events set reason = 'tampered' $$,
  '42501',
  null,
  'administrator cannot edit audit events'
);
select throws_ok(
  $$ delete from public.audit_events $$,
  '42501',
  null,
  'administrator cannot delete audit events'
);

reset role;
select pg_catalog.set_config('request.jwt.claim.sub', '', true);
set local role anon;
select throws_ok(
  $$ select * from public.groups $$,
  '42501',
  null,
  'unauthenticated users cannot read tenant groups'
);

reset role;
select throws_ok(
  $$ update public.audit_events set reason = 'privileged tamper' $$,
  'P0001',
  'audit_events_append_only',
  'audit events remain append-only even for a privileged application connection'
);
select throws_ok(
  $$ delete from public.audit_events $$,
  'P0001',
  'audit_events_append_only',
  'audit events reject privileged deletion as well as application-user deletion'
);
select throws_ok(
  $$ update public.groups set id = pg_catalog.gen_random_uuid() where id = (select created_group_id from bootstrap_a) $$,
  '22000',
  null,
  'persisted group identifiers are immutable'
);
select throws_ok(
  $$ update public.user_profiles set user_id = pg_catalog.gen_random_uuid() where user_id = '10000000-0000-4000-8000-000000000003' $$,
  '22000',
  null,
  'persisted profile identifiers are immutable'
);
select throws_ok(
  $$ update public.memberships set id = pg_catalog.gen_random_uuid() where user_id = '10000000-0000-4000-8000-000000000003' $$,
  '22000',
  null,
  'persisted membership identifiers are immutable'
);
select throws_ok(
  $$ update public.audit_events set id = pg_catalog.gen_random_uuid() $$,
  'P0001',
  'audit_events_append_only',
  'append-only audit records make their identifiers immutable'
);
select throws_ok(
  $$ update public.memberships set group_id = (select created_group_id from bootstrap_b) where user_id = '10000000-0000-4000-8000-000000000003' $$,
  '22000',
  null,
  'an existing membership cannot move between tenant groups'
);
select throws_ok(
  $$ update public.memberships set user_id = '10000000-0000-4000-8000-000000000007' where user_id = '10000000-0000-4000-8000-000000000003' $$,
  '22000',
  null,
  'an attached membership cannot be reassigned to another identity'
);
select throws_ok(
  $$
    insert into public.memberships (group_id, user_id, role, status, activated_at)
    values (
      (select created_group_id from bootstrap_b),
      '10000000-0000-4000-8000-000000000003',
      'member',
      'active',
      now()
    )
  $$,
  '23505',
  null,
  'database uniqueness independently rejects a second attached identity membership'
);
select throws_ok(
  $$
    insert into public.memberships (group_id, user_id, role, status, inactivated_at)
    values (
      (select created_group_id from bootstrap_b),
      '10000000-0000-4000-8000-000000000005',
      'member',
      'inactive',
      now()
    )
  $$,
  '23505',
  null,
  'v1 keeps an inactive identity attached to its one historical membership'
);
select throws_ok(
  $$
    insert into public.memberships (group_id, role, status, activated_at)
    values ((select created_group_id from bootstrap_a), 'member', 'active', now())
  $$,
  '23514',
  null,
  'an active membership always has an attached Auth identity'
);
select throws_ok(
  $$
    insert into public.memberships (
      group_id, role, status, uses_initial_quota, initial_quota, initial_quota_provenance
    ) values (
      (select created_group_id from bootstrap_a), 'member', 'pending', true, null, 'manual seed'
    )
  $$,
  '23514',
  null,
  'initial quota state cannot claim a missing value'
);
select throws_ok(
  $$
    insert into public.memberships (
      group_id, role, status, uses_initial_quota, initial_quota
    ) values (
      (select created_group_id from bootstrap_a), 'member', 'pending', false, 24.00
    )
  $$,
  '23514',
  null,
  'a retained initial quota always keeps its provenance'
);
select lives_ok(
  $$
    insert into public.memberships (
      group_id, role, status, uses_initial_quota, initial_quota, initial_quota_provenance
    ) values (
      (select created_group_id from bootstrap_a), 'member', 'pending', false, 24.00, 'manual seed'
    )
  $$,
  'turning off initial quota use retains its historical value and provenance'
);
select throws_ok(
  $$
    update public.memberships
    set role = 'coordinator'
    where id = (select administrator_membership_id from bootstrap_a)
  $$,
  'P0001',
  'last_active_administrator',
  'the last active administrator cannot be demoted'
);
select throws_ok(
  $$ delete from public.memberships where id = (select administrator_membership_id from bootstrap_a) $$,
  'P0001',
  'last_active_administrator',
  'the last active administrator cannot be deleted'
);
select lives_ok(
  $$
    insert into public.memberships (group_id, user_id, role, status, activated_at)
    values (
      (select created_group_id from bootstrap_a),
      '10000000-0000-4000-8000-000000000007',
      'administrator',
      'active',
      now()
    )
  $$,
  'an accepted replacement administrator can be activated first'
);
select lives_ok(
  $$
    update public.memberships
    set role = 'coordinator'
    where id = (select administrator_membership_id from bootstrap_a)
  $$,
  'the original administrator can be demoted after a replacement is active'
);
select lives_ok(
  $$
    update public.memberships
    set role = 'administrator'
    where id = (select administrator_membership_id from bootstrap_a)
  $$,
  'the original administrator can be restored'
);
select lives_ok(
  $$ delete from public.memberships where user_id = '10000000-0000-4000-8000-000000000007' $$,
  'a non-last administrator can be removed by a future authorized server mutation'
);
select ok(
  (select updated_at >= created_at from public.memberships where id = (select administrator_membership_id from bootstrap_a)),
  'membership updates use the server clock'
);

select * from finish();

rollback;
