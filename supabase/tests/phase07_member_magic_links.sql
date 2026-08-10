begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

select has_column(
  'public',
  'notification_deliveries',
  'member_magic_link_token_hash',
  'results deliveries have a retry-stable service-only magic-link hash'
);
select has_column(
  'public',
  'notification_deliveries',
  'member_magic_link_token_issued_at',
  'results deliveries retain the member-link issuance time'
);
select has_column(
  'public',
  'notification_deliveries',
  'member_magic_link_token_expires_at',
  'results deliveries retain the member-link expiry time'
);
select has_function(
  'public',
  'read_results_member_magic_link',
  array['uuid', 'uuid'],
  'the member-link read is claim-token scoped'
);
select has_function(
  'public',
  'store_results_member_magic_link',
  array['uuid', 'uuid', 'uuid', 'text', 'timestamp with time zone', 'timestamp with time zone'],
  'the member-link write is claim-token, recipient, and expiry scoped'
);
select ok(
  not has_function_privilege('anon', 'public.read_results_member_magic_link(uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.read_results_member_magic_link(uuid, uuid)', 'execute')
  and has_function_privilege('service_role', 'public.read_results_member_magic_link(uuid, uuid)', 'execute'),
  'member-link reads are service-only'
);
select ok(
  not has_function_privilege('anon', 'public.store_results_member_magic_link(uuid, uuid, uuid, text, timestamptz, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'public.store_results_member_magic_link(uuid, uuid, uuid, text, timestamptz, timestamptz)', 'execute')
  and has_function_privilege('service_role', 'public.store_results_member_magic_link(uuid, uuid, uuid, text, timestamptz, timestamptz)', 'execute'),
  'member-link writes are service-only'
);
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class
   where oid = 'public.notification_deliveries'::regclass),
  'delivery rows remain force-RLS protected'
);
select ok(
  (select pg_catalog.strpos(pg_catalog.pg_get_constraintdef(oid), 'member_magic_link_token_expires_at') > 0
   from pg_catalog.pg_constraint
   where conrelid = 'public.notification_deliveries'::regclass
     and conname = 'notification_deliveries_member_magic_link_expiry_valid'),
  'member-link issuance and expiry must form a bounded interval'
);
select ok(
  (select pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.store_results_member_magic_link(uuid, uuid, uuid, text, timestamptz, timestamptz)'::regprocedure), 'member_magic_link_token_expires_at <= pg_catalog.clock_timestamp()') > 0),
  'expired member-link material may be rotated on a retry'
);
select has_trigger(
  'public',
  'notification_deliveries',
  'notification_deliveries_clear_member_magic_link',
  'terminal delivery transitions clear the token hash'
);
select ok(
  (select column_default is null
   from information_schema.columns
   where table_schema = 'public'
     and table_name = 'notification_deliveries'
     and column_name = 'member_magic_link_token_hash'),
  'new delivery rows start without a member-link hash'
);
select ok(
  (select pg_catalog.strpos(pg_catalog.pg_get_constraintdef(oid), 'member_magic_link_token_hash') > 0
   from pg_catalog.pg_constraint
   where conrelid = 'public.notification_deliveries'::regclass
     and conname = 'notification_deliveries_member_magic_link_hash_valid'),
  'member-link hashes have a bounded non-whitespace constraint'
);
select ok(
  not has_function_privilege('public', 'public.read_results_member_magic_link(uuid, uuid)', 'execute'),
  'public role cannot inspect member-link material'
);

rollback;
