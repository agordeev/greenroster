begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

select has_table('public', 'notification_provider_events', 'provider event ledger exists');
select has_column('public', 'notification_deliveries', 'claim_token', 'delivery claim token exists');
select has_column('public', 'notification_deliveries', 'claimed_at', 'delivery claimed timestamp exists');
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class
   where oid = 'public.notification_provider_events'::regclass),
  'provider event ledger forces RLS'
);
select ok(
  not has_table_privilege('anon', 'public.notification_provider_events', 'select,insert,update,delete'),
  'anonymous clients cannot read or mutate provider events'
);
select ok(
  not has_table_privilege('authenticated', 'public.notification_provider_events', 'select,insert,update,delete'),
  'authenticated clients cannot read or mutate provider events'
);
select ok(
  has_table_privilege('service_role', 'public.notification_provider_events', 'select'),
  'trusted server can inspect provider event metadata'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.claim_membership_invitation_email(uuid,timestamp with time zone)',
    'execute'
  ),
  'trusted server can claim invitation e-mails'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.claim_membership_invitation_email(uuid,timestamp with time zone)',
    'execute'
  ),
  'authenticated clients cannot claim invitation e-mails'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.record_email_send_success(uuid,uuid,text)',
    'execute'
  ),
  'trusted server can record e-mail success'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.record_email_send_success(uuid,uuid,text)',
    'execute'
  ),
  'authenticated clients cannot record e-mail success'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.record_email_send_failure(uuid,uuid,text,timestamptz)',
    'execute'
  ),
  'trusted server can record e-mail failure'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.record_resend_email_feedback(text,text,text,timestamptz,text,text)',
    'execute'
  ),
  'trusted server can record verified Resend feedback'
);

select ok(
  not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'notification_provider_events'
      and column_name in ('recipient_address', 'recipient_email', 'payload', 'raw_payload', 'token', 'invitation_token')
  ),
  'provider event ledger has no recipient, payload, or token column'
);

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at
)
values
  ('91000000-0000-4000-8000-000000000001', 'delivery-admin@example.test', now(), false, false, now(), now()),
  ('91000000-0000-4000-8000-000000000002', 'delivery-other@example.test', now(), false, false, now(), now());

insert into public.user_profiles (user_id)
values
  ('91000000-0000-4000-8000-000000000001'),
  ('91000000-0000-4000-8000-000000000002');

insert into public.groups (id, name, time_zone)
values
  ('92000000-0000-4000-8000-000000000001', 'Delivery Group A', 'UTC'),
  ('92000000-0000-4000-8000-000000000002', 'Delivery Group B', 'UTC');

insert into public.memberships (
  id, group_id, user_id, role, status, activated_at
)
values
  ('93000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'administrator', 'active', now()),
  ('93000000-0000-4000-8000-000000000002', '92000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000002', 'administrator', 'active', now()),
  ('93000000-0000-4000-8000-000000000003', '92000000-0000-4000-8000-000000000001', null, 'member', 'pending', null),
  ('93000000-0000-4000-8000-000000000004', '92000000-0000-4000-8000-000000000001', null, 'member', 'pending', null),
  ('93000000-0000-4000-8000-000000000005', '92000000-0000-4000-8000-000000000001', null, 'member', 'pending', null),
  ('93000000-0000-4000-8000-000000000006', '92000000-0000-4000-8000-000000000001', null, 'member', 'pending', null),
  ('93000000-0000-4000-8000-000000000007', '92000000-0000-4000-8000-000000000001', null, 'member', 'pending', null),
  ('93000000-0000-4000-8000-000000000008', '92000000-0000-4000-8000-000000000001', null, 'member', 'pending', null);

insert into public.membership_golfer_profiles (membership_id, group_id, first_name, last_name)
values
  ('93000000-0000-4000-8000-000000000003', '92000000-0000-4000-8000-000000000001', 'Delivery', 'One'),
  ('93000000-0000-4000-8000-000000000004', '92000000-0000-4000-8000-000000000001', 'Delivery', 'Two'),
  ('93000000-0000-4000-8000-000000000005', '92000000-0000-4000-8000-000000000001', 'Delivery', 'Three'),
  ('93000000-0000-4000-8000-000000000006', '92000000-0000-4000-8000-000000000001', 'Delivery', 'Four'),
  ('93000000-0000-4000-8000-000000000007', '92000000-0000-4000-8000-000000000001', 'Delivery', 'Five'),
  ('93000000-0000-4000-8000-000000000008', '92000000-0000-4000-8000-000000000001', 'Delivery', 'Six');

create temporary table issued_one as
select * from public.issue_membership_invitation(
  '91000000-0000-4000-8000-000000000001',
  '93000000-0000-4000-8000-000000000003',
  '94000000-0000-4000-8000-000000000001',
  '  Recipient.One@Example.test ',
  repeat('a', 64), 1, now() + interval '2 days',
  '95000000-0000-4000-8000-000000000001',
  '95000000-0000-4000-8000-000000000002'
);

create temporary table claimed_one as
select * from public.claim_membership_invitation_email(
  '96000000-0000-4000-8000-000000000001', now() - interval '5 minutes'
);

select is((select count(*) from claimed_one), 1::bigint, 'one due invitation is claimed');
select is((select group_name from claimed_one), 'Delivery Group A', 'claim returns derived group name');
select is((select recipient_address from claimed_one), 'Recipient.One@Example.test', 'claim returns private recipient display address');
select is((select member_first_name from claimed_one), 'Delivery', 'claim returns profile first name');
select is((select token_key_version from claimed_one), 1, 'claim returns token key version');
select is((select attempt_number from claimed_one), 1, 'first claim increments attempt number');
select is(
  (select state from public.notification_deliveries where id = (select delivery_id from claimed_one)),
  'sending'::public.notification_delivery_state,
  'claim moves delivery to sending'
);
select is(
  (select state from public.notification_outbox_jobs where id = (select outbox_job_id from claimed_one)),
  'processing'::public.notification_outbox_job_state,
  'claim moves outbox to processing'
);
select ok(
  (select claim_token = '96000000-0000-4000-8000-000000000001'::uuid and claimed_at is not null
   from public.notification_deliveries where id = (select delivery_id from claimed_one)),
  'claim token and timestamp are persisted together'
);

select is(
  (select count(*) from public.claim_membership_invitation_email('96000000-0000-4000-8000-000000000002', now() - interval '5 minutes')),
  0::bigint,
  'a second claim cannot take a sending delivery'
);

update public.notification_deliveries
set claimed_at = now() - interval '10 minutes'
where id = (select delivery_id from claimed_one);
update public.notification_outbox_jobs
set claimed_at = now() - interval '10 minutes'
where id = (select outbox_job_id from claimed_one);
create temporary table reclaimed_one as
select * from public.claim_membership_invitation_email(
  '96000000-0000-4000-8000-000000000008', now() - interval '5 minutes'
);
select is((select count(*) from reclaimed_one), 1::bigint, 'an expired invitation claim is recovered');
select is((select delivery_id from reclaimed_one), (select delivery_id from claimed_one), 'invitation claim recovery preserves delivery idempotency');
select is((select attempt_number from reclaimed_one), 2, 'invitation claim recovery advances the attempt count');

select throws_ok(
  $$ select public.record_email_send_success(
    (select delivery_id from claimed_one),
    '96000000-0000-4000-8000-000000000099',
    'provider-message-wrong-claim'
  ) $$,
  'P0002',
  'delivery_claim_invalid',
  'wrong claim token cannot record success'
);

select public.record_email_send_success(
  (select delivery_id from claimed_one),
  '96000000-0000-4000-8000-000000000008',
  'resend-message-one'
);

select is(
  (select state from public.notification_deliveries where id = (select delivery_id from claimed_one)),
  'sent'::public.notification_delivery_state,
  'successful provider send marks delivery sent'
);
select is(
  (select state from public.notification_outbox_jobs where id = (select outbox_job_id from claimed_one)),
  'succeeded'::public.notification_outbox_job_state,
  'successful provider send finishes outbox'
);
select ok(
  (select claim_token is null and claimed_at is null and sent_at is not null
   from public.notification_deliveries where id = (select delivery_id from claimed_one)),
  'successful provider send clears the claim'
);

select throws_ok(
  $$ select public.record_email_send_failure(
    (select delivery_id from claimed_one),
    '96000000-0000-4000-8000-000000000099',
    'provider_failed', now() + interval '1 hour'
  ) $$,
  'P0002',
  'delivery_claim_invalid',
  'stale claim cannot record failure'
);

create temporary table issued_retry as
select * from public.issue_membership_invitation(
  '91000000-0000-4000-8000-000000000001',
  '93000000-0000-4000-8000-000000000004',
  '94000000-0000-4000-8000-000000000002',
  'retry-recipient@example.test', repeat('b', 64), 1, now() + interval '2 days',
  '95000000-0000-4000-8000-000000000003',
  '95000000-0000-4000-8000-000000000004'
);
create temporary table claimed_retry as
select * from public.claim_membership_invitation_email('96000000-0000-4000-8000-000000000003', now() - interval '5 minutes');

select public.record_email_send_failure(
  (select delivery_id from claimed_retry),
  '96000000-0000-4000-8000-000000000003',
  'provider_rate_limited', now() + interval '1 hour'
);
select is(
  (select state from public.notification_deliveries where id = (select delivery_id from claimed_retry)),
  'retryable'::public.notification_delivery_state,
  'future retry time keeps delivery retryable'
);
select is(
  (select state from public.notification_outbox_jobs where id = (select outbox_job_id from claimed_retry)),
  'retryable'::public.notification_outbox_job_state,
  'future retry time keeps outbox retryable'
);
select ok(
  (select claim_token is null and claimed_at is null and next_attempt_at > now()
   from public.notification_deliveries where id = (select delivery_id from claimed_retry)),
  'retryable failure clears claim and schedules future attempt'
);

select throws_ok(
  $$ select public.record_email_send_failure(
    (select delivery_id from claimed_retry),
    '96000000-0000-4000-8000-000000000003',
    'provider failure with unsafe payload', null
  ) $$,
  '22023',
  'safe_error_invalid',
  'provider payload text is rejected as an unsafe error'
);
select throws_ok(
  $$ select public.record_email_send_failure(
    (select delivery_id from claimed_retry),
    '96000000-0000-4000-8000-000000000003',
    'provider_failed', null
  ) $$,
  'P0002',
  'delivery_claim_invalid',
  'a completed retryable claim cannot be completed twice'
);

create temporary table issued_permanent as
select * from public.issue_membership_invitation(
  '91000000-0000-4000-8000-000000000001',
  '93000000-0000-4000-8000-000000000005',
  '94000000-0000-4000-8000-000000000003',
  'permanent-recipient@example.test', repeat('c', 64), 1, now() + interval '2 days',
  '95000000-0000-4000-8000-000000000005',
  '95000000-0000-4000-8000-000000000006'
);
create temporary table claimed_permanent as
select * from public.claim_membership_invitation_email('96000000-0000-4000-8000-000000000004', now() - interval '5 minutes');

select public.record_email_send_failure(
  (select delivery_id from claimed_permanent),
  '96000000-0000-4000-8000-000000000004',
  'provider_permanent_failure', null
);
select is(
  (select state from public.notification_deliveries where id = (select delivery_id from claimed_permanent)),
  'failed_permanent'::public.notification_delivery_state,
  'null retry time permanently fails delivery'
);
select is(
  (select state from public.notification_outbox_jobs where id = (select outbox_job_id from claimed_permanent)),
  'abandoned'::public.notification_outbox_job_state,
  'null retry time abandons outbox'
);

create temporary table issued_expired as
select * from public.issue_membership_invitation(
  '91000000-0000-4000-8000-000000000001',
  '93000000-0000-4000-8000-000000000007',
  '94000000-0000-4000-8000-000000000005',
  'expired-recipient@example.test', repeat('e', 64), 1, now() + interval '2 days',
  '95000000-0000-4000-8000-000000000009',
  '95000000-0000-4000-8000-000000000010'
);
update public.membership_invitations
set issued_at = now() - interval '2 days',
    expires_at = now() - interval '1 second'
where id = (select issued_invitation_id from issued_expired);
select is(
  (select count(*) from public.claim_membership_invitation_email('96000000-0000-4000-8000-000000000006', now() - interval '5 minutes')),
  0::bigint,
  'expired queued invitations are not claimed'
);
select is(
  (select state from public.notification_deliveries where id = (select queued_delivery_id from issued_expired)),
  'cancelled'::public.notification_delivery_state,
  'expired queued delivery is cancelled'
);
select is(
  (select failure_reason from public.notification_deliveries where id = (select queued_delivery_id from issued_expired)),
  'invitation_expired',
  'expired delivery has a safe bounded reason'
);
select is(
  (select state from public.notification_outbox_jobs where id = (select queued_outbox_id from issued_expired)),
  'cancelled'::public.notification_outbox_job_state,
  'expired invitation outbox is cancelled'
);

create temporary table issued_inactive as
select * from public.issue_membership_invitation(
  '91000000-0000-4000-8000-000000000001',
  '93000000-0000-4000-8000-000000000008',
  '94000000-0000-4000-8000-000000000006',
  'inactive-recipient@example.test', repeat('f', 64), 1, now() + interval '2 days',
  '95000000-0000-4000-8000-000000000011',
  '95000000-0000-4000-8000-000000000012'
);
update public.memberships
set status = 'inactive', inactivated_at = now()
where id = '93000000-0000-4000-8000-000000000008';
select is(
  (select count(*) from public.claim_membership_invitation_email('96000000-0000-4000-8000-000000000007', now() - interval '5 minutes')),
  0::bigint,
  'ineligible pending membership invitations are not claimed'
);
select is(
  (select state from public.notification_deliveries where id = (select queued_delivery_id from issued_inactive)),
  'cancelled'::public.notification_delivery_state,
  'inactive membership delivery is cancelled'
);
select is(
  (select failure_reason from public.notification_deliveries where id = (select queued_delivery_id from issued_inactive)),
  'invitation_inactive',
  'inactive membership has an explicit safe cancellation reason'
);

select public.record_resend_email_feedback(
  'svix-delivered-one', 'email.delivered', 'resend-message-one',
  '2026-07-26 10:00:00+00', 'recipient.one@example.test'
);
select is(
  (select count(*) from public.notification_provider_events where event_id = 'svix-delivered-one'),
  1::bigint,
  'verified delivered event is recorded once'
);
select is(
  (select provider from public.notification_provider_events where event_id = 'svix-delivered-one'),
  'resend',
  'provider is recorded as metadata'
);
select is(
  (select group_id from public.notification_provider_events where event_id = 'svix-delivered-one'),
  '92000000-0000-4000-8000-000000000001'::app.entity_id,
  'feedback derives group from the delivery'
);

select public.record_resend_email_feedback(
  'svix-delivered-one', 'email.delivered', 'resend-message-one',
  '2026-07-26 10:00:00+00', '  RECIPIENT.ONE@EXAMPLE.TEST '
);
select is(
  (select count(*) from public.notification_provider_events where event_id = 'svix-delivered-one'),
  1::bigint,
  'replaying an identical event is idempotent'
);

select throws_ok(
  $$ select public.record_resend_email_feedback(
    'svix-delivered-one', 'email.failed', 'resend-message-one',
    '2026-07-26 10:00:00+00', 'recipient.one@example.test'
  ) $$,
  '23505',
  'provider_event_replay_mismatch',
  'reusing an event id with different semantics is rejected'
);
select throws_ok(
  $$ select public.record_resend_email_feedback(
    'svix-address-mismatch', 'email.delivered', 'resend-message-one',
    '2026-07-26 10:00:00+00', 'wrong@example.test'
  ) $$,
  'P0002',
  'provider_delivery_not_found',
  'provider message and address must identify the same delivery'
);

select public.record_resend_email_feedback(
  'svix-temporary-one', 'email.bounced', 'resend-message-one',
  '2026-07-26 10:30:00+00', 'recipient.one@example.test', 'Temporary'
);
select is(
  (select bounce_type from public.notification_provider_events where event_id = 'svix-temporary-one'),
  'transient',
  'provider Temporary bounce is normalized to the internal transient value'
);
select is(
  (select state from public.notification_deliveries where id = (select delivery_id from claimed_one)),
  'sent'::public.notification_delivery_state,
  'temporary bounce does not permanently fail the delivery'
);

select public.record_resend_email_feedback(
  'svix-bounce-one', 'email.bounced', 'resend-message-one',
  '2026-07-26 11:00:00+00', 'recipient.one@example.test', 'permanent'
);
select is(
  (select state from public.notification_deliveries where id = (select delivery_id from claimed_one)),
  'failed_permanent'::public.notification_delivery_state,
  'hard bounce permanently fails the sent delivery'
);
select is(
  (select reason from public.email_suppressions where normalized_address = 'recipient.one@example.test'),
  'bounce'::public.email_suppression_reason,
  'hard bounce creates bounce suppression'
);
select is(
  (select first_occurred_at from public.email_suppressions where normalized_address = 'recipient.one@example.test'),
  '2026-07-26 11:00:00+00'::app.utc_instant,
  'first bounce occurrence is retained'
);
select public.record_resend_email_feedback(
  'svix-bounce-two', 'email.bounced', 'resend-message-one',
  '2026-07-26 12:00:00+00', 'recipient.one@example.test', 'permanent'
);
select is(
  (select last_occurred_at from public.email_suppressions where normalized_address = 'recipient.one@example.test'),
  '2026-07-26 12:00:00+00'::app.utc_instant,
  'later bounce advances suppression last occurrence'
);
select public.record_resend_email_feedback(
  'svix-bounce-two', 'email.bounced', 'resend-message-one',
  '2026-07-26 12:00:00+00', 'recipient.one@example.test', 'permanent'
);
select is(
  (select last_occurred_at from public.email_suppressions where normalized_address = 'recipient.one@example.test'),
  '2026-07-26 12:00:00+00'::app.utc_instant,
  'replaying a bounce does not advance suppression time'
);

create temporary table issued_complaint as
select * from public.issue_membership_invitation(
  '91000000-0000-4000-8000-000000000001',
  '93000000-0000-4000-8000-000000000006',
  '94000000-0000-4000-8000-000000000004',
  'complaint-recipient@example.test', repeat('d', 64), 1, now() + interval '2 days',
  '95000000-0000-4000-8000-000000000007',
  '95000000-0000-4000-8000-000000000008'
);
create temporary table claimed_complaint as
select * from public.claim_membership_invitation_email('96000000-0000-4000-8000-000000000005', now() - interval '5 minutes');
select public.record_email_send_success(
  (select delivery_id from claimed_complaint),
  '96000000-0000-4000-8000-000000000005',
  'resend-message-complaint'
);
select public.record_resend_email_feedback(
  'svix-complaint-one', 'email.complained', 'resend-message-complaint',
  '2026-07-26 13:00:00+00', 'complaint-recipient@example.test'
);
select is(
  (select state from public.notification_deliveries where id = (select delivery_id from claimed_complaint)),
  'sent'::public.notification_delivery_state,
  'complaint retains sent delivery state'
);
select is(
  (select reason from public.email_suppressions where normalized_address = 'complaint-recipient@example.test'),
  'complaint'::public.email_suppression_reason,
  'complaint creates complaint suppression'
);

select ok(
  (select event_id = 'svix-bounce-one'
     and event_type = 'email.bounced'
     and provider_message_id = 'resend-message-one'
   from public.notification_provider_events as event
   where event.event_id = 'svix-bounce-one'),
  'provider event stores only provider metadata'
);
select ok(
  (select pg_catalog.strpos(pg_catalog.row_to_json(event)::text, 'recipient.one@example.test') = 0
   from public.notification_provider_events as event
   where event.event_id = 'svix-bounce-one'),
  'provider event row contains no recipient PII'
);

select * from finish();

rollback;
