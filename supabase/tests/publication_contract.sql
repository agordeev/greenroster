begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

select has_type('public', 'round_rsvp_status', 'publication defines explicit RSVP states');
select has_table('public', 'round_rule_snapshots', 'published rounds retain rule snapshots');
select has_table('public', 'round_participants', 'published rounds retain member participants');
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class where oid = 'public.round_rule_snapshots'::regclass),
  'rule snapshots force RLS'
);
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class where oid = 'public.round_participants'::regclass),
  'participants force RLS'
);
select ok(
  not has_table_privilege('service_role', 'public.round_rule_snapshots', 'select,insert,update,delete')
  and not has_table_privilege('service_role', 'public.round_participants', 'select,insert,update,delete'),
  'trusted server has no direct snapshot or participant table grants'
);
select ok(
  has_function_privilege('service_role', 'public.preview_round_publication(uuid,uuid,uuid[])', 'execute')
  and has_function_privilege('service_role', 'public.publish_round(uuid,uuid,uuid[],bigint,text,uuid,uuid)', 'execute')
  and has_function_privilege('service_role', 'public.claim_round_published_email(uuid,timestamptz)', 'execute')
  and has_function_privilege('service_role', 'public.read_round_participants(uuid,uuid)', 'execute'),
  'trusted server receives only the publication RPC boundaries'
);
select ok(
  not has_function_privilege('authenticated', 'public.publish_round(uuid,uuid,uuid[],bigint,text,uuid,uuid)', 'execute')
  and not has_function_privilege('anon', 'public.publish_round(uuid,uuid,uuid[],bigint,text,uuid,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.claim_round_published_email(uuid,timestamptz)', 'execute')
  and not has_function_privilege('anon', 'public.claim_round_published_email(uuid,timestamptz)', 'execute'),
  'client roles cannot call publication'
);
select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc
    where oid = 'public.preview_round_publication(uuid,uuid,uuid[])'::regprocedure
      and 'email' = any(proargnames)
  ),
  'preview result has no raw account-email output column'
);

insert into auth.users (id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at)
values
  ('18000000-0000-4000-8000-000000000001', 'publication-admin-a@example.test', now(), false, false, now(), now()),
  ('18000000-0000-4000-8000-000000000002', 'publication-member-a@example.test', now(), false, false, now(), now()),
  ('18000000-0000-4000-8000-000000000003', 'publication-member-missing@example.test', now(), false, false, now(), now()),
  ('18000000-0000-4000-8000-000000000004', 'publication-admin-b@example.test', now(), false, false, now(), now());

insert into public.user_profiles (user_id, first_name, last_name)
values
  ('18000000-0000-4000-8000-000000000001', 'Admin', 'A'),
  ('18000000-0000-4000-8000-000000000002', 'Member', 'Ready'),
  ('18000000-0000-4000-8000-000000000003', 'Member', 'Missing'),
  ('18000000-0000-4000-8000-000000000004', 'Admin', 'B');

insert into public.groups (id, name, time_zone)
values
  ('58000000-0000-4000-8000-000000000001', 'Publication Group A', 'UTC'),
  ('58000000-0000-4000-8000-000000000002', 'Publication Group B', 'UTC');

insert into public.memberships (id, group_id, user_id, role, status, activated_at)
values
  ('68000000-0000-4000-8000-000000000001', '58000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000001', 'administrator', 'active', now()),
  ('68000000-0000-4000-8000-000000000002', '58000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000002', 'member', 'active', now()),
  ('68000000-0000-4000-8000-000000000003', '58000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000003', 'member', 'active', now()),
  ('68000000-0000-4000-8000-000000000004', '58000000-0000-4000-8000-000000000002', '18000000-0000-4000-8000-000000000004', 'administrator', 'active', now());

insert into public.membership_golfer_profiles (membership_id, group_id, first_name, last_name, tee_location)
values
  ('68000000-0000-4000-8000-000000000001', '58000000-0000-4000-8000-000000000001', 'Admin', 'A', 'middle'),
  ('68000000-0000-4000-8000-000000000002', '58000000-0000-4000-8000-000000000001', 'Member', 'Ready', 'back'),
  ('68000000-0000-4000-8000-000000000003', '58000000-0000-4000-8000-000000000001', 'Member', 'Missing', 'front'),
  ('68000000-0000-4000-8000-000000000004', '58000000-0000-4000-8000-000000000002', 'Admin', 'B', 'middle');

insert into public.group_quota_settings (
  group_id, method, moving_average_history_length, precision, rounding_rule, version, updated_by
)
values (
  '58000000-0000-4000-8000-000000000001', 'moving_average', 10, 1,
  'half_away_from_zero', 4, '18000000-0000-4000-8000-000000000001'
);

insert into public.membership_quota_projections (
  membership_id, group_id, projection_version, settings_version, projection_ready,
  projected_quota, projection_source
)
values
  ('68000000-0000-4000-8000-000000000001', '58000000-0000-4000-8000-000000000001', 1, 4, true, 10.5, '{"source":"seed"}'),
  ('68000000-0000-4000-8000-000000000002', '58000000-0000-4000-8000-000000000001', 1, 4, true, 12.3, '{"source":"history"}'),
  ('68000000-0000-4000-8000-000000000003', '58000000-0000-4000-8000-000000000001', 1, 4, false, null, '{}');

insert into public.membership_handicap_records (membership_id, group_id, handicap_id, handicap, source, as_of)
values ('68000000-0000-4000-8000-000000000002', '58000000-0000-4000-8000-000000000001', 'H-1', 8.5, 'manual', '2026-08-01');

insert into public.membership_quota_projections (
  membership_id, group_id, projection_version, settings_version, projection_ready,
  projected_quota, projection_source
)
values (
  '68000000-0000-4000-8000-000000000004', '58000000-0000-4000-8000-000000000002',
  1, 0, true, 9.0, '{"source":"initial"}'
);
create temporary table no_settings_net_draft as
select * from public.create_round_draft(
  '18000000-0000-4000-8000-000000000004', 'Net without quota settings', '2026-08-14T09:00',
  null, null, null, true, null, 'individual_net',
  '28000000-0000-4000-8000-000000000010', '38000000-0000-4000-8000-000000000010'
);
create temporary table no_settings_net_preview as
select * from public.preview_round_publication(
  '18000000-0000-4000-8000-000000000004',
  (select round_id from no_settings_net_draft), '{}'
);
select ok(
  not (select projection_ready from no_settings_net_preview),
  'Net preview is not ready when no quota-settings version is locked'
);
select is(
  (select ineligibility_reason from no_settings_net_preview),
  'quota_not_ready', 'Net preview explains the missing quota-settings version'
);
delete from public.membership_quota_projections
where membership_id = '68000000-0000-4000-8000-000000000004';

create temporary table publication_draft as
select * from public.create_round_draft(
  '18000000-0000-4000-8000-000000000001', 'August publication', '2026-08-15T09:00',
  'North Course', null, 'Member-visible notes', true, '2026-08-14T09:00', 'individual_net',
  '28000000-0000-4000-8000-000000000001', '38000000-0000-4000-8000-000000000001'
);
update public.rounds
set group_time_zone = 'America/New_York'
where id = (select round_id from publication_draft);

create temporary table publication_preview as
select * from public.preview_round_publication(
  '18000000-0000-4000-8000-000000000001',
  (select round_id from publication_draft),
  array['68000000-0000-4000-8000-000000000003']::uuid[]
);

select is((select count(*) from publication_preview), 3::bigint, 'preview includes every active member');
select is((select count(distinct format) from publication_preview), 1::bigint, 'preview emits the authoritative round format');
select is((select format from publication_preview limit 1), 'individual_net'::public.round_format, 'preview format matches the Draft');
select is((select count(distinct review_version) from publication_preview), 1::bigint, 'preview emits one server review version');
select is((select count(distinct review_fingerprint) from publication_preview), 1::bigint, 'preview emits one server review fingerprint');
select ok(
  (select email_ready from publication_preview where membership_id = '68000000-0000-4000-8000-000000000002'),
  'preview reports e-mail readiness without returning the address'
);
select is(
  (select eligibility_state from publication_preview where membership_id = '68000000-0000-4000-8000-000000000003'),
  'excluded', 'preview records an explicit exclusion'
);
select is(
  (select ineligibility_reason from publication_preview where membership_id = '68000000-0000-4000-8000-000000000003'),
  'explicitly_excluded', 'preview explains the exclusion'
);
select is(
  (select projected_quota::numeric from publication_preview where membership_id = '68000000-0000-4000-8000-000000000002'),
  12.3::numeric, 'preview exposes exact quota values'
);
select is(
  (select handicap_snapshot::numeric from publication_preview where membership_id = '68000000-0000-4000-8000-000000000002'),
  8.5::numeric, 'preview exposes the latest handicap snapshot'
);

update auth.users
set banned_until = pg_catalog.clock_timestamp() + interval '1 second'
where id = '18000000-0000-4000-8000-000000000002';
create temporary table ban_expiring_preview as
select * from public.preview_round_publication(
  '18000000-0000-4000-8000-000000000001',
  (select round_id from publication_draft),
  array['68000000-0000-4000-8000-000000000003']::uuid[]
);
select is(
  (select eligibility_state from ban_expiring_preview where membership_id = '68000000-0000-4000-8000-000000000002'),
  'ineligible', 'preview blocks a member while the account ban is active'
);
select pg_catalog.pg_sleep(1.2);
create temporary table ban_expired_preview as
select * from public.preview_round_publication(
  '18000000-0000-4000-8000-000000000001',
  (select round_id from publication_draft),
  array['68000000-0000-4000-8000-000000000003']::uuid[]
);
select is(
  (select eligibility_state from ban_expired_preview where membership_id = '68000000-0000-4000-8000-000000000002'),
  'eligible', 'preview re-evaluates an expired account ban'
);
select isnt(
  (select review_fingerprint from ban_expiring_preview limit 1),
  (select review_fingerprint from ban_expired_preview limit 1),
  'account-ban expiry invalidates the reviewed fingerprint'
);
update auth.users set banned_until = null where id = '18000000-0000-4000-8000-000000000002';

select throws_ok(
  $$ select * from public.publish_round(
    '18000000-0000-4000-8000-000000000001',
    (select round_id from publication_draft),
    array['68000000-0000-4000-8000-000000000003']::uuid[],
    (select review_version from publication_preview limit 1),
    repeat('0', 64),
    '28000000-0000-4000-8000-000000000001',
    '38000000-0000-4000-8000-000000000001'
  ) $$,
  '40001', 'publication_review_stale', 'publish rejects a stale review fingerprint'
);

create temporary table stale_draft as
select * from public.create_round_draft(
  '18000000-0000-4000-8000-000000000001', 'Stale draft review', '2026-08-19T09:00',
  null, null, null, true, null, 'individual_gross',
  '28000000-0000-4000-8000-000000000009', '38000000-0000-4000-8000-000000000009'
);
create temporary table stale_preview as
select * from public.preview_round_publication(
  '18000000-0000-4000-8000-000000000001',
  (select round_id from stale_draft), '{}'
);
update public.rounds
set description = 'Draft changed after review'
where id = (select round_id from stale_draft);
select throws_ok(
  $$ select * from public.publish_round(
    '18000000-0000-4000-8000-000000000001',
    (select round_id from stale_draft), '{}',
    (select review_version from stale_preview limit 1),
    (select review_fingerprint from stale_preview limit 1),
    '28000000-0000-4000-8000-000000000010',
    '38000000-0000-4000-8000-000000000010'
  ) $$,
  '40001', 'publication_review_stale', 'publish rejects a draft changed after review'
);

create temporary table published_round as
select * from public.publish_round(
  '18000000-0000-4000-8000-000000000001',
  (select round_id from publication_draft),
  array['68000000-0000-4000-8000-000000000003']::uuid[],
  (select review_version from publication_preview limit 1),
  (select review_fingerprint from publication_preview limit 1),
  '28000000-0000-4000-8000-000000000002',
  '38000000-0000-4000-8000-000000000002'
);

select is((select state from published_round), 'published'::public.round_state, 'publish transitions Draft to Published');
select is((select participant_count from published_round), 2::bigint, 'publish creates one participant per included member');
select is((select notification_count from published_round), 2::bigint, 'publish queues one e-mail delivery per included member');
select is((select count(*) from public.round_rule_snapshots), 1::bigint, 'publish writes one rule snapshot');
select is((select format from public.round_rule_snapshots), 'individual_net'::public.round_format, 'snapshot stores the selected format');
select is((select quota_method from public.round_rule_snapshots), 'moving_average'::public.quota_method, 'snapshot stores the quota method');
select is((select moving_average_history_length from public.round_rule_snapshots), 10::smallint, 'snapshot stores the history length');
select is((select quota_precision from public.round_rule_snapshots), 1::smallint, 'rule snapshot stores exact settings values');
select is((select quota_rounding_rule from public.round_rule_snapshots), 'half_away_from_zero'::public.quota_rounding_rule, 'snapshot stores the rounding rule');
select is((select adjustment_bands from public.round_rule_snapshots), '[]'::jsonb, 'snapshot stores the current adjustment bands');
select is((select settings_version from public.round_rule_snapshots), 4::bigint, 'snapshot stores the exact settings version');
select is((select count(*) from public.round_participants), 2::bigint, 'excluded members receive no participant row');
select is((select count(*) from public.notification_outbox_jobs where event_type = 'round.published'), 2::bigint, 'publication creates one outbox job per member');
select is((select count(*) from public.notification_deliveries where channel = 'email'), 2::bigint, 'publication creates one e-mail delivery per member');
select is((select count(*) from public.round_participants where rsvp_status = 'no_response'), 2::bigint, 'new participants begin No response');

create temporary table claimed_publication_email as
select * from public.claim_round_published_email(
  'a8000000-0000-4000-8000-000000000001', now() - interval '5 minutes'
);
select is((select count(*) from claimed_publication_email), 1::bigint, 'round publication worker claims one due e-mail');
select is((select format from claimed_publication_email), 'individual_net'::public.round_format, 'claim returns the round format');
select is((select group_time_zone from claimed_publication_email), 'America/New_York', 'claim returns the round time zone for e-mail formatting');
select is((select round_description from claimed_publication_email), 'August publication', 'claim returns the round description');
select is((select state::text from public.notification_deliveries where id = (select delivery_id from claimed_publication_email)), 'sending', 'claim marks delivery sending');
insert into public.email_suppressions (
  normalized_address, reason, first_occurred_at, last_occurred_at
)
select pg_catalog.lower(pg_catalog.btrim(delivery.recipient_address)), 'complaint', now(), now()
from public.notification_deliveries as delivery
where delivery.state = 'queued'
limit 1;
create temporary table suppressed_publication_claim as
select * from public.claim_round_published_email(
  'a8000000-0000-4000-8000-000000000002', now() - interval '5 minutes'
);
select is((select count(*) from suppressed_publication_claim), 0::bigint, 'suppressed publication e-mail is not claimed');
select is((select count(*) from public.notification_deliveries where state = 'cancelled' and failure_reason = 'email_suppressed'), 1::bigint, 'suppressed publication e-mail is cancelled with a safe reason');

update public.membership_quota_projections
set settings_version = 3
where membership_id = '68000000-0000-4000-8000-000000000002';
create temporary table mismatched_settings_draft as
select * from public.create_round_draft(
  '18000000-0000-4000-8000-000000000001', 'Mismatched quota publication', '2026-08-18T09:00',
  null, null, null, true, null, 'individual_net',
  '28000000-0000-4000-8000-000000000007', '38000000-0000-4000-8000-000000000007'
);
create temporary table mismatched_settings_preview as
select * from public.preview_round_publication(
  '18000000-0000-4000-8000-000000000001',
  (select round_id from mismatched_settings_draft), '{}'
);
select ok(
  not (select projection_ready from mismatched_settings_preview where membership_id = '68000000-0000-4000-8000-000000000002'),
  'Net preview rejects a projection from a mismatched settings version'
);
select throws_ok(
  $$ select * from public.publish_round(
    '18000000-0000-4000-8000-000000000001',
    (select round_id from mismatched_settings_draft), '{}',
    (select review_version from mismatched_settings_preview limit 1),
    (select review_fingerprint from mismatched_settings_preview limit 1),
    '28000000-0000-4000-8000-000000000008',
    '38000000-0000-4000-8000-000000000008'
  ) $$,
  '22023', 'publication_quota_not_ready', 'publish rejects a projection whose settings version is stale'
);
update public.membership_quota_projections
set settings_version = 4
where membership_id = '68000000-0000-4000-8000-000000000002';

create temporary table blocked_net_draft as
select * from public.create_round_draft(
  '18000000-0000-4000-8000-000000000001', 'Blocked net publication', '2026-08-16T09:00',
  null, null, null, true, null, 'individual_net',
  '28000000-0000-4000-8000-000000000003', '38000000-0000-4000-8000-000000000003'
);
create temporary table blocked_net_preview as
select * from public.preview_round_publication(
  '18000000-0000-4000-8000-000000000001',
  (select round_id from blocked_net_draft), '{}'
);
select throws_ok(
  $$ select * from public.publish_round(
    '18000000-0000-4000-8000-000000000001',
    (select round_id from blocked_net_draft), '{}',
    (select review_version from blocked_net_preview limit 1),
    (select review_fingerprint from blocked_net_preview limit 1),
    '28000000-0000-4000-8000-000000000004',
    '38000000-0000-4000-8000-000000000004'
  ) $$,
  '22023', 'publication_quota_not_ready', 'Individual Net blocks an included member without a ready projection'
);

create temporary table gross_draft as
select * from public.create_round_draft(
  '18000000-0000-4000-8000-000000000004', 'Gross without quota', '2026-08-17T09:00',
  null, null, null, true, null, 'individual_gross',
  '28000000-0000-4000-8000-000000000005', '38000000-0000-4000-8000-000000000005'
);
create temporary table gross_preview as
select * from public.preview_round_publication(
  '18000000-0000-4000-8000-000000000004',
  (select round_id from gross_draft), '{}'
);
create temporary table gross_publication as
select * from public.publish_round(
  '18000000-0000-4000-8000-000000000004',
  (select round_id from gross_draft), '{}',
  (select review_version from gross_preview limit 1),
  (select review_fingerprint from gross_preview limit 1),
  '28000000-0000-4000-8000-000000000006',
  '38000000-0000-4000-8000-000000000006'
);
select is((select participant_count from gross_publication), 1::bigint, 'Individual Gross permits a member without quota settings');
select is(
  (select quota_snapshot from public.round_participants where round_id = (select round_id from gross_draft)),
  null::app.quota_value, 'Gross stores a null quota snapshot when no projection exists'
);

select * from public.publish_round(
  '18000000-0000-4000-8000-000000000001',
  (select round_id from publication_draft),
  array['68000000-0000-4000-8000-000000000003']::uuid[],
  (select review_version from publication_preview limit 1),
  (select review_fingerprint from publication_preview limit 1),
  '28000000-0000-4000-8000-000000000099',
  '38000000-0000-4000-8000-000000000002'
);
select is((select count(*) from public.round_participants where round_id = (select round_id from publication_draft)), 2::bigint, 'exact publish replay does not duplicate participants');
select is((select count(*) from public.notification_outbox_jobs where event_type = 'round.published' and aggregate_id = (select round_id from publication_draft)), 2::bigint, 'exact publish replay does not duplicate outbox jobs');
select is((select count(*) from public.audit_events where action = 'round.published' and target_id = (select round_id from publication_draft)), 1::bigint, 'exact publish replay does not duplicate audit');

select throws_ok(
  $$ update public.round_rule_snapshots set quota_precision = 2 $$,
  'P0001', 'round_rule_snapshot_immutable', 'rule snapshots cannot be edited'
);
select throws_ok(
  $$ update public.round_participants set quota_snapshot = quota_snapshot $$,
  'P0001', 'round_participant_snapshot_immutable', 'participant snapshots cannot be edited'
);

create temporary table member_read as
select * from public.read_round_participants(
  '18000000-0000-4000-8000-000000000002', (select round_id from publication_draft)
);
select is((select count(*) from member_read), 1::bigint, 'a member reads only their own participant');
select is((select quota_snapshot::numeric from member_read), 12.3::numeric, 'member read returns the immutable quota snapshot');
select throws_ok(
  $$ select * from public.read_round_participants(
    '18000000-0000-4000-8000-000000000004', (select round_id from publication_draft)
  ) $$,
  'P0002', 'round_not_found', 'a different tenant cannot read the round'
);

select * from finish();

rollback;
