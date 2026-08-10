begin;

create extension if not exists pgtap with schema extensions;
select plan(25);

select ok(
  not has_table_privilege('anon', 'public.billing_accounts', 'select'),
  'anonymous clients cannot read billing accounts'
);
select ok(
  not has_table_privilege('authenticated', 'public.billing_accounts', 'update'),
  'authenticated clients cannot mutate billing accounts'
);
select ok(
  has_function_privilege('service_role', 'public.process_stripe_billing_event(text,text,timestamptz,jsonb)', 'execute'),
  'only the trusted server receives Stripe reconciliation authority'
);
select ok(
  not has_function_privilege('authenticated', 'public.process_stripe_billing_event(text,text,timestamptz,jsonb)', 'execute'),
  'browser roles cannot submit subscription state'
);
select ok(
  (select relforcerowsecurity from pg_class where oid = 'public.billing_accounts'::regclass),
  'billing account reads are force-RLS protected'
);
select ok(
  (select relforcerowsecurity from pg_class where oid = 'public.membership_billing_entitlements'::regclass),
  'member entitlement reads are force-RLS protected'
);

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at
)
values
  ('91000000-0000-4000-8000-000000000001', 'billing-admin-a@example.test', now(), false, false, now(), now()),
  ('91000000-0000-4000-8000-000000000002', 'billing-member-a@example.test', now(), false, false, now(), now()),
  ('91000000-0000-4000-8000-000000000003', 'billing-admin-b@example.test', now(), false, false, now(), now());

insert into public.user_profiles (user_id)
values
  ('91000000-0000-4000-8000-000000000001'),
  ('91000000-0000-4000-8000-000000000002'),
  ('91000000-0000-4000-8000-000000000003');

insert into public.groups (id, name, time_zone)
values
  ('92000000-0000-4000-8000-000000000001', 'Billing Group A', 'UTC'),
  ('92000000-0000-4000-8000-000000000002', 'Billing Group B', 'UTC');

insert into public.memberships (id, group_id, user_id, role, status, activated_at)
values
  ('93000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'administrator', 'active', now()),
  ('93000000-0000-4000-8000-000000000002', '92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000002', 'member', 'active', now()),
  ('93000000-0000-4000-8000-000000000003', '92000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000003', 'administrator', 'active', now());

select is(
  (select subscription_status::text from public.billing_accounts where group_id = '92000000-0000-4000-8000-000000000001'),
  'trialing',
  'new groups start in a thirty-day trial'
);
select ok(
  (select expires_at > starts_at from public.membership_billing_entitlements where membership_id = '93000000-0000-4000-8000-000000000002'),
  'active members receive a trial entitlement'
);
select ok(
  app.billing_membership_is_entitled(
    '93000000-0000-4000-8000-000000000002',
    '92000000-0000-4000-8000-000000000001',
    now()
  ),
  'trial entitlement is usable before expiry'
);

update public.billing_accounts
set stripe_customer_id = 'cus_billing_a', stripe_subscription_id = 'sub_billing_a'
where group_id = '92000000-0000-4000-8000-000000000001';

set local role service_role;
select * from public.process_stripe_billing_event(
  'evt_billing_active_001',
  'customer.subscription.updated',
  now(),
  '{"id":"sub_billing_a","object":"subscription","customer":"cus_billing_a","status":"active","current_period_start":1893456000,"current_period_end":1924992000,"items":{"data":[{"price":{"id":"price_annual","nickname":"Annual group","unit_amount":1000,"currency":"usd","recurring":{"interval":"year"}}}]}}'::jsonb
);
reset role;

select is(
  (select state::text from public.billing_events where stripe_event_id = 'evt_billing_active_001'),
  'processed',
  'a verified subscription event is retained as processed'
);
select is(
  (select subscription_status::text from public.billing_accounts where group_id = '92000000-0000-4000-8000-000000000001'),
  'active',
  'the newest subscription event updates the normalized account'
);
select is(
  (select plan_amount_minor from public.billing_accounts where group_id = '92000000-0000-4000-8000-000000000001'),
  1000::bigint,
  'price metadata comes from Stripe rather than a client constant'
);
select ok(
  app.billing_membership_is_entitled(
    '93000000-0000-4000-8000-000000000002',
    '92000000-0000-4000-8000-000000000001',
    now()
  ),
  'active subscription keeps member entitlement active'
);

set local role service_role;
select * from public.process_stripe_billing_event(
  'evt_billing_active_001',
  'customer.subscription.updated',
  now(),
  '{"id":"sub_billing_a","customer":"cus_billing_a","status":"canceled"}'::jsonb
);
select * from public.process_stripe_billing_event(
  'evt_billing_old_001',
  'customer.subscription.updated',
  now() - interval '1 day',
  '{"id":"sub_billing_a","customer":"cus_billing_a","status":"past_due"}'::jsonb
);
reset role;

select is(
  (select count(*) from public.billing_events where stripe_event_id = 'evt_billing_active_001'),
  1::bigint,
  'duplicate delivery remains one event row'
);
select is(
  (select state::text from public.billing_events where stripe_event_id = 'evt_billing_old_001'),
  'ignored',
  'out-of-order delivery is retained and ignored'
);
select is(
  (select safe_error from public.billing_events where stripe_event_id = 'evt_billing_old_001'),
  'out_of_order_event',
  'out-of-order reason remains visible to administrators'
);

select throws_ok(
  $$ select * from public.grant_billing_entitlement(
    '91000000-0000-4000-8000-000000000003',
    '93000000-0000-4000-8000-000000000002',
    now() + interval '30 days',
    'Cross-group attempt',
    '94000000-0000-4000-8000-000000000001',
    '95000000-0000-4000-8000-000000000001'
  ) $$,
  'P0002',
  'membership_not_found',
  'an administrator cannot grant another group an entitlement'
);

set local role service_role;
select * from public.grant_billing_entitlement(
  '91000000-0000-4000-8000-000000000001',
  '93000000-0000-4000-8000-000000000002',
  now() + interval '45 days',
  'Support approved temporary access',
  '94000000-0000-4000-8000-000000000002',
  '95000000-0000-4000-8000-000000000002'
);
reset role;
select is(
  (select source from public.membership_billing_entitlements where membership_id = '93000000-0000-4000-8000-000000000002'),
  'manual',
  'manual entitlement records their approved source'
);
select is(
  (select count(*) from public.audit_events where action = 'billing.entitlement_granted' and operation_id = '95000000-0000-4000-8000-000000000002'),
  1::bigint,
  'manual entitlement writes one audit event'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
select is((select count(*) from public.billing_accounts), 1::bigint, 'an administrator reads only the active group billing account');
select is((select count(*) from public.billing_invoices), 0::bigint, 'invoice history is tenant scoped');
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000003', true);
select is((select count(*) from public.billing_accounts), 1::bigint, 'a second administrator reads only their own group billing account');
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000002', true);
select is((select count(*) from public.billing_accounts), 0::bigint, 'a member cannot read the billing account');
select is((select count(*) from public.membership_billing_entitlements), 1::bigint, 'a member can see only their own restriction state');
reset role;

update public.membership_billing_entitlements
set expires_at = now() - interval '1 minute', status = 'active'
where membership_id = '93000000-0000-4000-8000-000000000002';
select ok(
  not app.billing_membership_is_entitled(
    '93000000-0000-4000-8000-000000000002',
    '92000000-0000-4000-8000-000000000001',
    now()
  ),
  'server time expiry immediately removes member entitlement'
);

select * from finish();
rollback;
