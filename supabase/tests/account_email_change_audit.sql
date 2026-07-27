begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

select has_function(
  'app',
  'audit_account_email_change',
  array[]::text[],
  'account e-mail audit trigger function exists'
);
select has_trigger(
  'auth',
  'users',
  'auth_user_account_email_audit',
  'Auth e-mail changes have a database audit boundary'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'app.audit_account_email_change()',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'app.audit_account_email_change()',
    'execute'
  ),
  'application roles cannot call the Auth trigger function directly'
);
select has_function(
  'app',
  'enforce_attached_membership_invitation_email',
  array[]::text[],
  'membership attachment e-mail guard exists'
);
select has_trigger(
  'public',
  'memberships',
  'memberships_attached_identity_invitation_email',
  'membership attachment checks pending invitation e-mails'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'app.enforce_attached_membership_invitation_email()',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'app.enforce_attached_membership_invitation_email()',
    'execute'
  ),
  'application roles cannot call the membership attachment guard directly'
);

insert into auth.users (
  id,
  email,
  email_confirmed_at,
  is_sso_user,
  is_anonymous,
  created_at,
  updated_at
)
values
  ('b2000000-0000-4000-8000-000000000001', 'email-admin@example.test', now(), false, false, now(), now()),
  ('b2000000-0000-4000-8000-000000000002', 'member-old@example.test', now(), false, false, now(), now()),
  ('b2000000-0000-4000-8000-000000000003', 'unattached-old@example.test', now(), false, false, now(), now()),
  ('b2000000-0000-4000-8000-000000000004', 'email-collision@example.test', now(), false, false, now(), now()),
  ('b2000000-0000-4000-8000-000000000005', 'unverified-old@example.test', null, false, false, now(), now());

insert into public.user_profiles (user_id)
values
  ('b2000000-0000-4000-8000-000000000001'),
  ('b2000000-0000-4000-8000-000000000002');

insert into public.groups (id, name, time_zone)
values ('c2000000-0000-4000-8000-000000000001', 'Account E-mail Group', 'UTC');

insert into public.memberships (
  id,
  group_id,
  user_id,
  role,
  status,
  activated_at
)
values
  ('d2000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 'administrator', 'active', now()),
  ('d2000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000002', 'member', 'active', now()),
  ('d2000000-0000-4000-8000-000000000003', 'c2000000-0000-4000-8000-000000000001', null, 'member', 'pending', null),
  ('d2000000-0000-4000-8000-000000000004', 'c2000000-0000-4000-8000-000000000001', null, 'member', 'pending', null),
  ('d2000000-0000-4000-8000-000000000005', 'c2000000-0000-4000-8000-000000000001', null, 'member', 'pending', null),
  ('d2000000-0000-4000-8000-000000000006', 'c2000000-0000-4000-8000-000000000001', null, 'member', 'pending', null),
  ('d2000000-0000-4000-8000-000000000007', 'c2000000-0000-4000-8000-000000000001', null, 'member', 'pending', null);

insert into public.membership_golfer_profiles (
  membership_id,
  group_id,
  first_name,
  last_name
)
values
  ('d2000000-0000-4000-8000-000000000003', 'c2000000-0000-4000-8000-000000000001', 'Historical', 'Invite'),
  ('d2000000-0000-4000-8000-000000000004', 'c2000000-0000-4000-8000-000000000001', 'Current', 'Collision'),
  ('d2000000-0000-4000-8000-000000000005', 'c2000000-0000-4000-8000-000000000001', 'Reverse', 'Conflict'),
  ('d2000000-0000-4000-8000-000000000006', 'c2000000-0000-4000-8000-000000000001', 'Pending', 'Duplicate'),
  ('d2000000-0000-4000-8000-000000000007', 'c2000000-0000-4000-8000-000000000001', 'Current', 'Account');

select * from public.issue_membership_invitation(
  'b2000000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000003',
  'e2000000-0000-4000-8000-000000000001',
  'historical-address@example.test',
  repeat('a', 64),
  1,
  now() + interval '1 day',
  'f2000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000002'
);

select is(
  (select count(*) from public.audit_events where actor_user_id = 'b2000000-0000-4000-8000-000000000002' and action = 'account.email_changed'),
  0::bigint,
  'a pending Auth email_change does not append a committed e-mail audit'
);

update auth.users
set email_change = 'member-new@example.test',
    email_change_sent_at = now(),
    email_change_token_new = 'pending-email-token'
where id = 'b2000000-0000-4000-8000-000000000002';

select is(
  (select email::text from auth.users where id = 'b2000000-0000-4000-8000-000000000002'),
  'member-old@example.test'::text,
  'a pending e-mail change leaves the current sign-in address in Auth'
);
select is(
  (select invited_email::text from public.membership_invitations where id = 'e2000000-0000-4000-8000-000000000001'),
  'historical-address@example.test'::text,
  'the historical invited address remains unchanged while Auth e-mail is pending'
);

update auth.users
set email = 'member-new@example.test',
    email_change = null,
    email_change_sent_at = null,
    email_change_token_new = null,
    email_change_confirm_status = 0,
    email_confirmed_at = now(),
    updated_at = now()
where id = 'b2000000-0000-4000-8000-000000000002';

select is(
  (select email::text from auth.users where id = 'b2000000-0000-4000-8000-000000000002'),
  'member-new@example.test'::text,
  'the verified e-mail transition updates the Auth identity'
);
select is(
  (select user_id::uuid from public.memberships where id = 'd2000000-0000-4000-8000-000000000002'),
  'b2000000-0000-4000-8000-000000000002'::uuid,
  'the verified e-mail transition keeps the same membership identity'
);
select is(
  (select count(*) from public.memberships where user_id = 'b2000000-0000-4000-8000-000000000002'),
  1::bigint,
  'the verified e-mail transition does not create a second membership'
);
select is(
  (select count(*) from public.audit_events where actor_user_id = 'b2000000-0000-4000-8000-000000000002' and action = 'account.email_changed'),
  1::bigint,
  'the verified e-mail transition appends exactly one tenant audit'
);
select is(
  (select target_type::text from public.audit_events where actor_user_id = 'b2000000-0000-4000-8000-000000000002' and action = 'account.email_changed'),
  'membership'::text,
  'the tenant e-mail audit targets the membership history'
);
select is(
  (select target_id::uuid from public.audit_events where actor_user_id = 'b2000000-0000-4000-8000-000000000002' and action = 'account.email_changed'),
  'd2000000-0000-4000-8000-000000000002'::uuid,
  'the tenant e-mail audit resolves to the changed membership'
);
select ok(
  not exists (
    select 1
    from public.audit_events
    where actor_user_id = 'b2000000-0000-4000-8000-000000000002'
      and action = 'account.email_changed'
      and (
        coalesce(before_state::text, '') like '%member-old@example.test%'
        or coalesce(before_state::text, '') like '%member-new@example.test%'
        or coalesce(after_state::text, '') like '%member-old@example.test%'
        or coalesce(after_state::text, '') like '%member-new@example.test%'
      )
  ),
  'tenant e-mail audit state contains no raw address'
);

update auth.users
set email = 'member-new@example.test',
    updated_at = now()
where id = 'b2000000-0000-4000-8000-000000000002';

select is(
  (select count(*) from public.audit_events where actor_user_id = 'b2000000-0000-4000-8000-000000000002' and action = 'account.email_changed'),
  1::bigint,
  'rewriting the same e-mail does not append a duplicate audit'
);

select * from public.issue_membership_invitation(
  'b2000000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000005',
  'e2000000-0000-4000-8000-000000000003',
  'member-conflict@example.test',
  repeat('c', 64),
  1,
  now() + interval '1 day',
  'f2000000-0000-4000-8000-000000000005',
  'f2000000-0000-4000-8000-000000000006'
);

select throws_ok(
  $$
    update auth.users
    set email = 'member-conflict@example.test',
        email_change = null,
        email_change_sent_at = null,
        email_change_token_new = null,
        email_change_confirm_status = 0,
        email_confirmed_at = now(),
        updated_at = now()
    where id = 'b2000000-0000-4000-8000-000000000002'
  $$,
  '23505',
  'invitation_email_in_use',
  'a pending invitation wins when it exists before the Auth e-mail transition'
);
select is(
  (select email::text from auth.users where id = 'b2000000-0000-4000-8000-000000000002'),
  'member-new@example.test'::text,
  'a rejected reverse-order transition leaves the current Auth e-mail unchanged'
);
select is(
  (select count(*) from public.audit_events where actor_user_id = 'b2000000-0000-4000-8000-000000000002' and action = 'account.email_changed'),
  1::bigint,
  'a rejected reverse-order transition appends no audit'
);
select is(
  (select invited_email::text from public.membership_invitations where id = 'e2000000-0000-4000-8000-000000000003'),
  'member-conflict@example.test'::text,
  'the pending invitation remains intact after rejecting the Auth transition'
);

select throws_ok(
  $$
    update auth.users
    set email = 'member-new@example.test', updated_at = now()
    where id = 'b2000000-0000-4000-8000-000000000004'
  $$,
  '23505',
  null,
  'Auth global uniqueness rejects a duplicate canonical e-mail'
);
select throws_ok(
  $$
    update auth.users
    set email = 'MEMBER-NEW@example.test', updated_at = now()
    where id = 'b2000000-0000-4000-8000-000000000004'
  $$,
  '22023',
  'account_email_not_canonical',
  'the trigger rejects a non-lowercase e-mail before it can bypass canonical uniqueness'
);
select throws_ok(
  $$
    update auth.users
    set email = 'unverified-new@example.test', updated_at = now()
    where id = 'b2000000-0000-4000-8000-000000000005'
  $$,
  '22023',
  'account_email_unverified',
  'an unverified identity cannot commit an account e-mail transition'
);
select is(
  (select email::text from auth.users where id = 'b2000000-0000-4000-8000-000000000005'),
  'unverified-old@example.test'::text,
  'a rejected unverified transition leaves the Auth e-mail unchanged'
);

update auth.users
set email = 'unattached-new@example.test',
    updated_at = now()
where id = 'b2000000-0000-4000-8000-000000000003';

select is(
  (select count(*) from public.audit_events where actor_user_id = 'b2000000-0000-4000-8000-000000000003' and action = 'account.email_changed'),
  0::bigint,
  'an unattached identity does not write a tenant audit'
);
select is(
  (select count(*) from public.identity_security_audit_events where user_id = 'b2000000-0000-4000-8000-000000000003' and action = 'account.email_changed'),
  1::bigint,
  'an unattached identity writes the private security audit'
);
select is(
  (select target_type::text from public.identity_security_audit_events where user_id = 'b2000000-0000-4000-8000-000000000003' and action = 'account.email_changed'),
  'user'::text,
  'the unattached e-mail audit targets the Auth user'
);

select * from public.issue_membership_invitation(
  'b2000000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000006',
  'e2000000-0000-4000-8000-000000000004',
  'unattached-new@example.test',
  repeat('d', 64),
  1,
  now() + interval '1 day',
  'f2000000-0000-4000-8000-000000000007',
  'f2000000-0000-4000-8000-000000000008'
);
select * from public.issue_membership_invitation(
  'b2000000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000004',
  'e2000000-0000-4000-8000-000000000005',
  'different-invitation@example.test',
  repeat('e', 64),
  1,
  now() + interval '1 day',
  'f2000000-0000-4000-8000-000000000009',
  'f2000000-0000-4000-8000-000000000010'
);

select throws_ok(
  $$
    select * from public.accept_membership_invitation(
      'b2000000-0000-4000-8000-000000000003',
      'e2000000-0000-4000-8000-000000000005',
      repeat('e', 64),
      'f2000000-0000-4000-8000-000000000011',
      'f2000000-0000-4000-8000-000000000012'
    )
  $$,
  '23505',
  'invitation_email_in_use',
  'an unattached identity cannot accept a different invitation while its current e-mail has another pending invitation'
);
select is(
  (select user_id::uuid from public.memberships where id = 'd2000000-0000-4000-8000-000000000004'),
  null::uuid,
  'the rejected attachment leaves the accepted invitation membership unattached'
);
select is(
  (select status::text from public.membership_invitations where id = 'e2000000-0000-4000-8000-000000000005'),
  'pending'::text,
  'the rejected attachment leaves the different invitation pending'
);
select is(
  (select status::text from public.membership_invitations where id = 'e2000000-0000-4000-8000-000000000004'),
  'pending'::text,
  'the conflicting pending invitation remains pending'
);
select throws_ok(
  $$
    update public.memberships
    set user_id = 'b2000000-0000-4000-8000-000000000003',
        status = 'active',
        activated_at = now()
    where id = 'd2000000-0000-4000-8000-000000000004'
  $$,
  '23505',
  'invitation_email_in_use',
  'direct server-side attachment uses the same pending invitation guard'
);

select throws_ok(
  $$
    select * from public.issue_membership_invitation(
      'b2000000-0000-4000-8000-000000000001',
      'd2000000-0000-4000-8000-000000000007',
      'e2000000-0000-4000-8000-000000000002',
      'member-new@example.test',
      repeat('b', 64),
      1,
      now() + interval '1 day',
      'f2000000-0000-4000-8000-000000000003',
      'f2000000-0000-4000-8000-000000000004'
    )
  $$,
  '23505',
  'invitation_email_in_use',
  'invitation issue checks the current Auth e-mail after a verified change'
);
select is(
  (select invited_email::text from public.membership_invitations where id = 'e2000000-0000-4000-8000-000000000001'),
  'historical-address@example.test'::text,
  'invitation history retains its original invited address after account e-mail change'
);

select * from finish();
rollback;
