begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

select has_type('public', 'round_state', 'round lifecycle has an explicit database enum');
select has_type('public', 'round_format', 'round formats have an explicit database enum');
select ok(
  (select enum_range(null::public.round_format)::text[] =
    array['individual_net', 'individual_gross']),
  'v1 round formats remain limited to Individual Net and Individual Gross'
);
select has_table('public', 'rounds', 'round configuration exists');
select has_pk('public', 'rounds', 'rounds have immutable identities');
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class where oid = 'public.rounds'::regclass),
  'rounds enable and force RLS'
);
select ok(
  not has_table_privilege(
    'public', 'public.rounds', 'insert,update,delete'
  )
  and not has_table_privilege(
    'anon', 'public.rounds', 'insert,update,delete'
  )
  and not has_table_privilege(
    'authenticated', 'public.rounds', 'insert,update,delete'
  )
  and not has_table_privilege(
    'service_role', 'public.rounds', 'insert,update,delete'
  ),
  'rounds have no direct write path'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.create_round_draft(uuid,text,text,text,text,text,boolean,text,public.round_format,uuid,uuid)',
    'execute'
  ),
  'authenticated clients cannot bypass the draft boundary'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.create_round_draft(uuid,text,text,text,text,text,boolean,text,public.round_format,uuid,uuid)',
    'execute'
  ),
  'anonymous clients cannot call draft creation'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.create_round_draft(uuid,text,text,text,text,text,boolean,text,public.round_format,uuid,uuid)',
    'execute'
  ),
  'the trusted server can create drafts'
);
select ok(
  (select prosecdef from pg_catalog.pg_proc where oid =
    'public.create_round_draft(uuid,text,text,text,text,text,boolean,text,public.round_format,uuid,uuid)'::regprocedure),
  'draft creation is a security definer'
);
select ok(
  (select proconfig = array['search_path=""'] from pg_catalog.pg_proc where oid =
    'public.create_round_draft(uuid,text,text,text,text,text,boolean,text,public.round_format,uuid,uuid)'::regprocedure),
  'draft creation pins an empty search path'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.update_round_draft(uuid,uuid,text,text,text,text,text,boolean,text,public.round_format,bigint,uuid,uuid)',
    'execute'
  ),
  'the trusted server can edit drafts'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.update_round_draft(uuid,uuid,text,text,text,text,text,boolean,text,public.round_format,bigint,uuid,uuid)',
    'execute'
  ),
  'anonymous clients cannot call draft editing'
);
select ok(
  has_function_privilege('service_role', 'public.list_rounds(uuid)', 'execute'),
  'the trusted server can list coordinator rounds'
);
select ok(
  not has_function_privilege('anon', 'public.list_rounds(uuid)', 'execute'),
  'anonymous clients cannot list rounds'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.rounds'::regclass
      and contype = 'u'
      and conkey = array[
        (select attnum from pg_catalog.pg_attribute where attrelid = 'public.rounds'::regclass and attname = 'id'),
        (select attnum from pg_catalog.pg_attribute where attrelid = 'public.rounds'::regclass and attname = 'group_id')
      ]::smallint[]
  ),
  'rounds expose a composite tenant key for future child snapshots'
);

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at
)
values
  ('17000000-0000-4000-8000-000000000001', 'round-admin-a@example.test', now(), false, false, now(), now()),
  ('17000000-0000-4000-8000-000000000002', 'round-coordinator-a@example.test', now(), false, false, now(), now()),
  ('17000000-0000-4000-8000-000000000003', 'round-member-a@example.test', now(), false, false, now(), now()),
  ('17000000-0000-4000-8000-000000000004', 'round-admin-b@example.test', now(), false, false, now(), now());

insert into public.user_profiles (user_id)
values
  ('17000000-0000-4000-8000-000000000001'),
  ('17000000-0000-4000-8000-000000000002'),
  ('17000000-0000-4000-8000-000000000003'),
  ('17000000-0000-4000-8000-000000000004');

insert into public.groups (id, name, time_zone)
values
  ('57000000-0000-4000-8000-000000000001', 'Round Group A', 'America/New_York'),
  ('57000000-0000-4000-8000-000000000002', 'Round Group B', 'UTC');

insert into public.memberships (id, group_id, user_id, role, status, activated_at)
values
  ('67000000-0000-4000-8000-000000000001', '57000000-0000-4000-8000-000000000001', '17000000-0000-4000-8000-000000000001', 'administrator', 'active', now()),
  ('67000000-0000-4000-8000-000000000002', '57000000-0000-4000-8000-000000000001', '17000000-0000-4000-8000-000000000002', 'coordinator', 'active', now()),
  ('67000000-0000-4000-8000-000000000003', '57000000-0000-4000-8000-000000000001', '17000000-0000-4000-8000-000000000003', 'member', 'active', now()),
  ('67000000-0000-4000-8000-000000000004', '57000000-0000-4000-8000-000000000002', '17000000-0000-4000-8000-000000000004', 'administrator', 'active', now());

select throws_ok(
  $$ select * from public.create_round_draft(
    '17000000-0000-4000-8000-000000000003', null, null, null, null, null, true, null,
    'individual_net', '27000000-0000-4000-8000-000000000001', '37000000-0000-4000-8000-000000000001'
  ) $$,
  'P0003', 'actor_not_authorized', 'members cannot create private drafts'
);
select throws_ok(
  $$ select * from public.create_round_draft(
    '17000000-0000-4000-8000-000000000002', 'Invalid URL', '2026-08-15T09:30', null,
    'http://example.com', null, true, null, 'individual_gross',
    '27000000-0000-4000-8000-000000000002', '37000000-0000-4000-8000-000000000002'
  ) $$,
  '22023', 'round_url_invalid', 'round URLs must use HTTPS'
);
select throws_ok(
  $$ select * from public.create_round_draft(
    '17000000-0000-4000-8000-000000000002', 'Invalid URL', '2026-08-15T09:30', null,
    'https://', null, true, null, 'individual_gross',
    '27000000-0000-4000-8000-000000000003', '37000000-0000-4000-8000-000000000003'
  ) $$,
  '22023', 'round_url_invalid', 'hostless HTTPS URLs are rejected'
);
select throws_ok(
  $$ select * from public.create_round_draft(
    '17000000-0000-4000-8000-000000000002', 'Invalid time', 'not-a-local-time', null,
    null, null, true, null, 'individual_gross',
    '27000000-0000-4000-8000-000000000004', '37000000-0000-4000-8000-000000000004'
  ) $$,
  '22023', 'round_scheduled_at_invalid', 'local schedule input is validated on the server'
);
select throws_ok(
  $$ select * from public.create_round_draft(
    '17000000-0000-4000-8000-000000000002', 'Invalid deadline', '2026-08-15T09:30', null,
    null, null, true, '2026-08-15T09:30', 'individual_gross',
    '27000000-0000-4000-8000-000000000005', '37000000-0000-4000-8000-000000000005'
  ) $$,
  '22023', 'round_rsvp_deadline_invalid', 'RSVP deadline must precede the round start'
);
select throws_ok(
  $$ select * from public.create_round_draft(
    '17000000-0000-4000-8000-000000000002', 'Invalid deadline', null, null,
    null, null, true, '2026-08-14T09:30', 'individual_gross',
    '27000000-0000-4000-8000-000000000105', '37000000-0000-4000-8000-000000000105'
  ) $$,
  '22023', 'round_rsvp_deadline_invalid', 'a deadline cannot be saved without a start time'
);
select throws_ok(
  $$ select * from public.create_round_draft(
    '17000000-0000-4000-8000-000000000002', 'Invalid notes', '2026-08-15T09:30', null,
    null, repeat('x', 501), true, null, 'individual_gross',
    '27000000-0000-4000-8000-000000000006', '37000000-0000-4000-8000-000000000006'
  ) $$,
  '22023', 'round_notes_invalid', 'notes are capped at 500 characters'
);

create temporary table incomplete_draft as
select * from public.create_round_draft(
  '17000000-0000-4000-8000-000000000002', null, null, null, null, null, true, null, null,
  '27000000-0000-4000-8000-000000000007', '37000000-0000-4000-8000-000000000007'
);
select is((select state from incomplete_draft), 'draft'::public.round_state, 'a draft can be saved before all fields are filled');
select is((select version from incomplete_draft), 1::bigint, 'a new draft starts at version one');
select is((select group_time_zone from incomplete_draft), 'America/New_York'::app.iana_time_zone, 'the group time zone is actor-derived');

create temporary table first_draft as
select * from public.create_round_draft(
  '17000000-0000-4000-8000-000000000002',
  '  August Club Round  ',
  '2026-08-15T09:30',
  '  North Course  ',
  'https://example.com/rounds/august',
  '  Bring a cart.  ',
  true,
  '2026-08-14T09:30',
  'individual_net',
  '27000000-0000-4000-8000-000000000008',
  '37000000-0000-4000-8000-000000000008'
);

select is((select description from first_draft), 'August Club Round'::text, 'draft descriptions are normalized');
select is((select venue from first_draft), 'North Course'::text, 'draft venues are normalized');
select is((select group_time_zone::text from first_draft), 'America/New_York'::text, 'the draft stores the inherited IANA zone');
select is((select scheduled_at::timestamptz from first_draft), '2026-08-15 13:30:00+00'::timestamptz, 'local start time is converted to an absolute UTC instant');
select is((select rsvp_deadline_at::timestamptz from first_draft), '2026-08-14 13:30:00+00'::timestamptz, 'local RSVP deadline uses the same group zone');
select is((select format from first_draft), 'individual_net'::public.round_format, 'Individual Net is stored as the selected format');
select is((select state from first_draft), 'draft'::public.round_state, 'created rounds remain private Drafts');
select is((select count(*) from public.audit_events where action = 'round.draft_created'), 2::bigint, 'each create writes one audit event');
select is((select source from public.audit_events where action = 'round.draft_created' and target_id = (select round_id from first_draft)), 'portal'::text, 'draft audit records its source');

update public.groups
set time_zone = 'America/Chicago'
where id = '57000000-0000-4000-8000-000000000001';
select is(
  (select group_time_zone::text from public.rounds where id = (select round_id from first_draft)),
  'America/New_York'::text,
  'a draft keeps its inherited zone when the group profile later changes'
);

select * from public.create_round_draft(
  '17000000-0000-4000-8000-000000000002',
  'August Club Round', '2026-08-15T09:30', 'North Course',
  'https://example.com/rounds/august', 'Bring a cart.', true, '2026-08-14T09:30',
  'individual_net', '27000000-0000-4000-8000-000000000099', '37000000-0000-4000-8000-000000000008'
);
select is((select count(*) from public.rounds), 2::bigint, 'an exact create retry does not create a second round');
select is((select count(*) from public.audit_events where action = 'round.draft_created'), 2::bigint, 'an exact create retry does not duplicate audit');
select throws_ok(
  $$ select * from public.create_round_draft(
    '17000000-0000-4000-8000-000000000002', 'Different payload', '2026-08-15T09:30', null,
    null, null, true, null, 'individual_net',
    '27000000-0000-4000-8000-000000000100', '37000000-0000-4000-8000-000000000008'
  ) $$,
  '23505', 'operation_id_reused', 'an operation id cannot be reused with a different draft payload'
);

create temporary table updated_draft as
select * from public.update_round_draft(
  '17000000-0000-4000-8000-000000000002',
  (select round_id::uuid from first_draft),
  '  Updated August Round ',
  '2026-08-16T10:00',
  'South Course',
  'https://example.com/rounds/updated',
  'Updated notes',
  false,
  '2026-08-15T10:00',
  'individual_gross',
  1,
  '27000000-0000-4000-8000-000000000009',
  '37000000-0000-4000-8000-000000000009'
);
select is((select version from updated_draft), 2::bigint, 'a successful draft edit advances the version once');
select is((select format from updated_draft), 'individual_gross'::public.round_format, 'draft edits can switch between the two supported formats');
select is((select scheduled_at::timestamptz from updated_draft), '2026-08-16 14:00:00+00'::timestamptz, 'draft edits continue to use the inherited zone');
select is((select after_state -> 'changed_fields' ->> 0 from public.audit_events where action = 'round.draft_updated'), 'description'::text, 'draft audit records changed fields');
select is((select count(*) from public.audit_events where action = 'round.draft_updated'), 1::bigint, 'a successful draft edit writes one audit event');
select throws_ok(
  $$ update public.rounds set id = '87000000-0000-4000-8000-000000000001'
     where id = (select round_id from first_draft) $$,
  '22000', 'immutable identifier id cannot be changed', 'round identifiers are immutable'
);
select throws_ok(
  $$ update public.rounds set group_id = '57000000-0000-4000-8000-000000000002'
     where id = (select round_id from first_draft) $$,
  '22000', 'immutable identifier group_id cannot be changed', 'round tenant scope is immutable'
);

select * from public.update_round_draft(
  '17000000-0000-4000-8000-000000000002',
  (select round_id::uuid from first_draft),
  'Updated August Round', '2026-08-16T10:00', 'South Course',
  'https://example.com/rounds/updated', 'Updated notes', false, '2026-08-15T10:00',
  'individual_gross', 1, '27000000-0000-0000-0000-000000000099',
  '37000000-0000-4000-8000-000000000009'
);
select is((select version from public.rounds where id = (select round_id from first_draft)), 2::bigint, 'an exact edit retry preserves the committed version');
select is((select count(*) from public.audit_events where action = 'round.draft_updated'), 1::bigint, 'an exact edit retry does not duplicate audit');
select throws_ok(
  $$ select * from public.update_round_draft(
    '17000000-0000-4000-8000-000000000002',
    (select round_id::uuid from first_draft),
    'Different retry payload', '2026-08-15T09:30', null, null, null, true, null,
    'individual_net', 1, '27000000-0000-0000-0000-000000000099',
    '37000000-0000-4000-8000-000000000009'
  ) $$,
  '23505', 'operation_id_reused', 'an edit operation id cannot be reused with a different payload'
);
select throws_ok(
  $$ select * from public.update_round_draft(
    '17000000-0000-4000-8000-000000000002',
    (select round_id::uuid from first_draft),
    'Stale edit', '2026-08-16T10:00', null, null, null, true, null,
    'individual_net', 1, '27000000-0000-4000-8000-000000000101',
    '37000000-0000-4000-8000-000000000101'
  ) $$,
  '40001', 'round_version_changed', 'stale draft versions are rejected'
);
select throws_ok(
  $$ select * from public.update_round_draft(
    '17000000-0000-4000-8000-000000000004',
    (select round_id::uuid from first_draft),
    'Cross group edit', null, null, null, null, true, null, null, 2,
    '27000000-0000-4000-8000-000000000102', '37000000-0000-4000-8000-000000000102'
  ) $$,
  'P0002', 'round_not_found', 'cross-tenant draft identifiers are unavailable'
);

create temporary table listed_rounds as
select * from public.list_rounds('17000000-0000-4000-8000-000000000002');
select is((select count(*) from listed_rounds), 2::bigint, 'coordinators can list their tenant drafts');
select is((select count(*) from listed_rounds where state = 'draft'), 2::bigint, 'the coordinator projection includes private drafts');
select is((select group_name from listed_rounds order by scheduled_at desc nulls last limit 1), 'Round Group A'::text, 'the round list carries the actor-derived group context');
select is((select count(*) from public.list_rounds('17000000-0000-4000-8000-000000000001')), 2::bigint, 'administrators can list their tenant drafts');
update auth.users
set banned_until = pg_catalog.statement_timestamp() + interval '1 hour'
where id = '17000000-0000-4000-8000-000000000001';
select throws_ok(
  $$ select * from public.list_rounds('17000000-0000-4000-8000-000000000001') $$,
  'P0003', 'actor_not_authorized', 'banned administrators cannot list rounds'
);
update auth.users set banned_until = null where id = '17000000-0000-4000-8000-000000000001';
update public.memberships
set status = 'inactive', inactivated_at = pg_catalog.statement_timestamp()
where user_id = '17000000-0000-4000-8000-000000000002';
select throws_ok(
  $$ select * from public.list_rounds('17000000-0000-4000-8000-000000000002') $$,
  'P0003', 'actor_not_authorized', 'inactive coordinators cannot list rounds'
);
update public.memberships
set status = 'active', inactivated_at = null
where user_id = '17000000-0000-4000-8000-000000000002';
select throws_ok(
  $$ select * from public.list_rounds('17000000-0000-4000-8000-000000000003') $$,
  'P0003', 'actor_not_authorized', 'members cannot list private drafts'
);

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '17000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$ select count(*) from public.rounds $$,
  '42501', 'permission denied for table rounds',
  'members have no direct round read path'
);
reset role;
select pg_catalog.set_config('request.jwt.claim.sub', '', true);

select * from finish();

rollback;
