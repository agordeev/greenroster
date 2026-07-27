begin;

create extension if not exists pgtap with schema extensions;

select plan(25);

select ok(
  has_schema_privilege('service_role', 'app', 'usage'),
  'the trusted service can resolve private domain types in RPC signatures'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.resolve_membership_quota_bootstrap_context(uuid,uuid)',
    'execute'
  ),
  'the trusted server can execute the quota context read boundary'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.resolve_membership_quota_bootstrap_context(uuid,uuid)',
    'execute'
  ),
  'authenticated clients cannot execute the quota context read boundary'
);
select ok(
  not has_table_privilege(
    'authenticated',
    'public.membership_quota_seed_totals',
    'select'
  ),
  'authenticated clients cannot read ordered seed rows directly'
);

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at
)
values
  ('16000000-0000-4000-8000-000000000001', 'context-admin-a@example.test', now(), false, false, now(), now()),
  ('16000000-0000-4000-8000-000000000002', 'context-coordinator-a@example.test', now(), false, false, now(), now()),
  ('16000000-0000-4000-8000-000000000003', 'context-admin-b@example.test', now(), false, false, now(), now()),
  ('16000000-0000-4000-8000-000000000004', 'context-inactive@example.test', now(), false, false, now(), now()),
  ('16000000-0000-4000-8000-000000000005', 'context-disabled@example.test', now(), false, false, now(), now()),
  ('16000000-0000-4000-8000-000000000006', 'context-banned@example.test', now(), false, false, now(), now()),
  ('16000000-0000-4000-8000-000000000007', 'context-unverified@example.test', null, false, false, now(), now());

insert into public.user_profiles (user_id)
values
  ('16000000-0000-4000-8000-000000000001'),
  ('16000000-0000-4000-8000-000000000002'),
  ('16000000-0000-4000-8000-000000000003'),
  ('16000000-0000-4000-8000-000000000004'),
  ('16000000-0000-4000-8000-000000000005'),
  ('16000000-0000-4000-8000-000000000006'),
  ('16000000-0000-4000-8000-000000000007');

update public.user_profiles
set disabled_at = now()
where user_id = '16000000-0000-4000-8000-000000000005';

update auth.users
set banned_until = now() + interval '1 day'
where id = '16000000-0000-4000-8000-000000000006';

insert into public.groups (id, name, time_zone)
values
  ('56000000-0000-4000-8000-000000000001', 'Quota context group A', 'UTC'),
  ('56000000-0000-4000-8000-000000000002', 'Quota context group B', 'UTC');

insert into public.memberships (
  id, group_id, user_id, role, status, activated_at
)
values
  ('66000000-0000-4000-8000-000000000001', '56000000-0000-4000-8000-000000000001', '16000000-0000-4000-8000-000000000001', 'administrator', 'active', now()),
  ('66000000-0000-4000-8000-000000000002', '56000000-0000-4000-8000-000000000001', '16000000-0000-4000-8000-000000000002', 'coordinator', 'active', now()),
  ('66000000-0000-4000-8000-000000000003', '56000000-0000-4000-8000-000000000002', '16000000-0000-4000-8000-000000000003', 'administrator', 'active', now()),
  ('66000000-0000-4000-8000-000000000004', '56000000-0000-4000-8000-000000000001', null, 'member', 'pending', null),
  ('66000000-0000-4000-8000-000000000005', '56000000-0000-4000-8000-000000000001', null, 'member', 'pending', null),
  ('66000000-0000-4000-8000-000000000006', '56000000-0000-4000-8000-000000000002', null, 'member', 'pending', null),
  ('66000000-0000-4000-8000-000000000007', '56000000-0000-4000-8000-000000000001', '16000000-0000-4000-8000-000000000004', 'administrator', 'active', now()),
  ('66000000-0000-4000-8000-000000000008', '56000000-0000-4000-8000-000000000001', '16000000-0000-4000-8000-000000000005', 'administrator', 'active', now()),
  ('66000000-0000-4000-8000-000000000009', '56000000-0000-4000-8000-000000000001', '16000000-0000-4000-8000-000000000006', 'administrator', 'active', now()),
  ('66000000-0000-4000-8000-000000000010', '56000000-0000-4000-8000-000000000001', '16000000-0000-4000-8000-000000000007', 'administrator', 'active', now());

update public.memberships
set status = 'inactive', inactivated_at = now()
where id = '66000000-0000-4000-8000-000000000007';

insert into public.membership_quota_seed_totals (
  membership_id, group_id, position, point_total, source, source_metadata
)
values
  ('66000000-0000-4000-8000-000000000004', '56000000-0000-4000-8000-000000000001', 1, 10.00, 'member_bootstrap', '{"position":1}'),
  ('66000000-0000-4000-8000-000000000004', '56000000-0000-4000-8000-000000000001', 2, 20.50, 'member_bootstrap', '{"position":2}');

select is(
  (select count(*) from public.resolve_membership_quota_bootstrap_context(
    '16000000-0000-4000-8000-000000000001',
    '66000000-0000-4000-8000-000000000004'
  )),
  1::bigint,
  'an administrator receives one target context row'
);
select is(
  (select context_group_id::uuid from public.resolve_membership_quota_bootstrap_context(
    '16000000-0000-4000-8000-000000000001',
    '66000000-0000-4000-8000-000000000004'
  )),
  '56000000-0000-4000-8000-000000000001'::uuid,
  'the context group is derived from the administrator membership'
);
select is(
  (select seed_totals from public.resolve_membership_quota_bootstrap_context(
    '16000000-0000-4000-8000-000000000001',
    '66000000-0000-4000-8000-000000000004'
  )),
  '[{"position":1,"point_total":"10.00"},{"position":2,"point_total":"20.50"}]'::jsonb,
  'seed values retain exact decimal strings and oldest-first positions'
);
select is(
  (select jsonb_array_length(seed_totals) from public.resolve_membership_quota_bootstrap_context(
    '16000000-0000-4000-8000-000000000001',
    '66000000-0000-4000-8000-000000000004'
  )),
  2,
  'the context exposes all ordered seed entries'
);
select is(
  (select seed_totals from public.resolve_membership_quota_bootstrap_context(
    '16000000-0000-4000-8000-000000000001',
    '66000000-0000-4000-8000-000000000005'
  )),
  '[]'::jsonb,
  'a member without seeds receives an empty ordered seed array'
);
select throws_ok(
  $$ select * from public.resolve_membership_quota_bootstrap_context(
    '16000000-0000-4000-8000-000000000002',
    '66000000-0000-4000-8000-000000000004'
  ) $$,
  'P0003',
  'actor_not_authorized',
  'a coordinator cannot read administrator-only quota bootstrap context'
);
select throws_ok(
  $$ select * from public.resolve_membership_quota_bootstrap_context(
    '16000000-0000-4000-8000-000000000002',
    '77000000-0000-4000-8000-000000000001'
  ) $$,
  'P0003',
  'actor_not_authorized',
  'a coordinator gets the same denial for a nonexistent target'
);
select throws_ok(
  $$ select * from public.resolve_membership_quota_bootstrap_context(
    '16000000-0000-4000-8000-000000000004',
    '66000000-0000-4000-8000-000000000004'
  ) $$,
  'P0003',
  'actor_not_authorized',
  'an inactive member gets a uniform denial for an existing target'
);
select throws_ok(
  $$ select * from public.resolve_membership_quota_bootstrap_context(
    '16000000-0000-4000-8000-000000000004',
    '77000000-0000-4000-8000-000000000001'
  ) $$,
  'P0003',
  'actor_not_authorized',
  'an inactive member gets a uniform denial for a nonexistent target'
);
select throws_ok(
  $$ select * from public.resolve_membership_quota_bootstrap_context(
    '16000000-0000-4000-8000-000000000005',
    '66000000-0000-4000-8000-000000000004'
  ) $$,
  'P0003',
  'actor_not_authorized',
  'a disabled identity gets a uniform denial for an existing target'
);
select throws_ok(
  $$ select * from public.resolve_membership_quota_bootstrap_context(
    '16000000-0000-4000-8000-000000000005',
    '77000000-0000-4000-8000-000000000001'
  ) $$,
  'P0003',
  'actor_not_authorized',
  'a disabled identity gets a uniform denial for a nonexistent target'
);
select throws_ok(
  $$ select * from public.resolve_membership_quota_bootstrap_context(
    '16000000-0000-4000-8000-000000000006',
    '66000000-0000-4000-8000-000000000004'
  ) $$,
  'P0003',
  'actor_not_authorized',
  'a banned identity gets a uniform denial for an existing target'
);
select throws_ok(
  $$ select * from public.resolve_membership_quota_bootstrap_context(
    '16000000-0000-4000-8000-000000000006',
    '77000000-0000-4000-8000-000000000001'
  ) $$,
  'P0003',
  'actor_not_authorized',
  'a banned identity gets a uniform denial for a nonexistent target'
);
select throws_ok(
  $$ select * from public.resolve_membership_quota_bootstrap_context(
    '16000000-0000-4000-8000-000000000007',
    '66000000-0000-4000-8000-000000000004'
  ) $$,
  'P0003',
  'actor_not_authorized',
  'an unverified identity gets a uniform denial for an existing target'
);
select throws_ok(
  $$ select * from public.resolve_membership_quota_bootstrap_context(
    '16000000-0000-4000-8000-000000000007',
    '77000000-0000-4000-8000-000000000001'
  ) $$,
  'P0003',
  'actor_not_authorized',
  'an unverified identity gets a uniform denial for a nonexistent target'
);
select throws_ok(
  $$ select * from public.resolve_membership_quota_bootstrap_context(
    '16000000-0000-4000-8000-000000000001',
    '66000000-0000-4000-8000-000000000003'
  ) $$,
  'P0002',
  'membership_unavailable',
  'an administrator cannot read a cross-group target'
);
select is(
  (select context_group_id::uuid from public.resolve_membership_quota_bootstrap_context(
    '16000000-0000-4000-8000-000000000003',
    '66000000-0000-4000-8000-000000000006'
  )),
  '56000000-0000-4000-8000-000000000002'::uuid,
  'a second administrator can read only their own tenant context'
);
select is(
  (select seed_totals from public.resolve_membership_quota_bootstrap_context(
    '16000000-0000-4000-8000-000000000003',
    '66000000-0000-4000-8000-000000000006'
  )),
  '[]'::jsonb,
  'the second tenant receives no seed values from group A'
);
select throws_ok(
  $$ select * from public.resolve_membership_quota_bootstrap_context(
    '16000000-0000-4000-8000-000000000003',
    '66000000-0000-4000-8000-000000000004'
  ) $$,
  'P0002',
  'membership_unavailable',
  'the second administrator cannot cross-read group A seed values'
);
select throws_ok(
  $$ select * from public.resolve_membership_quota_bootstrap_context(
    null,
    '66000000-0000-4000-8000-000000000004'
  ) $$,
  '22004',
  'quota_bootstrap_context_input_invalid',
  'a null actor is rejected before tenant resolution'
);
select throws_ok(
  $$ select * from public.resolve_membership_quota_bootstrap_context(
    '16000000-0000-4000-8000-000000000001',
    null
  ) $$,
  '22004',
  'quota_bootstrap_context_input_invalid',
  'a null target is rejected before tenant resolution'
);

select * from finish();

rollback;
