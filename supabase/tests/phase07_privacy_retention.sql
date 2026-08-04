begin;

create extension if not exists pgtap with schema extensions;

select plan(28);

select has_function(
  'public',
  'prune_privacy_retention',
  array[]::text[],
  'privacy retention operation exists'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.prune_privacy_retention()',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.prune_privacy_retention()',
    'execute'
  ),
  'privacy retention is callable only by the trusted service'
);
select ok(
  (select prosecdef and proconfig = array['search_path=""']
   from pg_catalog.pg_proc
   where oid = 'public.prune_privacy_retention()'::regprocedure),
  'privacy retention pins a security-definer search path'
);

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at
)
values
  ('b9000000-0000-4000-8000-000000000001', 'retention-admin@example.test', now(), false, false, now(), now());

insert into public.user_profiles (user_id, display_name, first_name, last_name)
values ('b9000000-0000-4000-8000-000000000001', 'Retention Admin', 'Retention', 'Admin');

insert into public.groups (id, name, time_zone)
values ('b9100000-0000-4000-8000-000000000001', 'Retention Group', 'UTC');

insert into public.memberships (id, group_id, user_id, role, status, activated_at)
values (
  'b9200000-0000-4000-8000-000000000001',
  'b9100000-0000-4000-8000-000000000001',
  'b9000000-0000-4000-8000-000000000001',
  'administrator',
  'active',
  now()
);

insert into public.membership_invitations (
  id, group_id, membership_id, invited_email, invited_email_normalized,
  role, token_digest_sha256, token_key_version, status, issued_at, expires_at,
  expired_at, inviter_user_id
)
values
  (
    'b9300000-0000-4000-8000-000000000001',
    'b9100000-0000-4000-8000-000000000001',
    'b9200000-0000-4000-8000-000000000001',
    'expired-old@example.test', 'expired-old@example.test', 'member', repeat('a', 64), 1,
    'expired', now() - interval '40 days', now() - interval '39 days', now() - interval '35 days',
    'b9000000-0000-4000-8000-000000000001'
  ),
  (
    'b9300000-0000-4000-8000-000000000002',
    'b9100000-0000-4000-8000-000000000001',
    'b9200000-0000-4000-8000-000000000001',
    'expired-recent@example.test', 'expired-recent@example.test', 'member', repeat('b', 64), 1,
    'expired', now() - interval '10 days', now() - interval '9 days', now() - interval '5 days',
    'b9000000-0000-4000-8000-000000000001'
  ),
  (
    'b9300000-0000-4000-8000-000000000003',
    'b9100000-0000-4000-8000-000000000001',
    'b9200000-0000-4000-8000-000000000001',
    'pending-naturally-expired@example.test', 'pending-naturally-expired@example.test',
    'member', repeat('c', 64), 1,
    'pending', now() - interval '40 days', now() - interval '35 days', null,
    'b9000000-0000-4000-8000-000000000001'
  );

insert into public.notification_outbox_jobs (
  id, group_id, event_type, aggregate_type, aggregate_id,
  aggregate_version, idempotency_key, state, created_at, updated_at
)
select
  ('b9400000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid,
  'b9100000-0000-4000-8000-000000000001',
  'retention', 'test', gen_random_uuid(), 1,
  'retention:' || value::text,
  'succeeded', now() - interval '100 days', now() - interval '100 days'
from generate_series(1, 8) as value;

update public.notification_outbox_jobs
set event_type = 'membership.invitation',
    aggregate_type = 'membership_invitation',
    aggregate_id = 'b9300000-0000-4000-8000-000000000003',
    state = 'processing',
    claimed_at = now() - interval '100 days'
where id = 'b9400000-0000-4000-8000-000000000008';

insert into public.notification_deliveries (
  id, group_id, outbox_job_id, recipient_membership_id, recipient_address,
  recipient_address_normalized, channel, state, provider_message_id,
  created_at, updated_at, sent_at
)
values
  (
    'b9500000-0000-4000-8000-000000000001', 'b9100000-0000-4000-8000-000000000001',
    'b9400000-0000-4000-8000-000000000001', 'b9200000-0000-4000-8000-000000000001',
    'old-sent@example.test', 'old-sent@example.test', 'email', 'sent', 'old-provider-1',
    now() - interval '100 days', now() - interval '100 days', now() - interval '100 days'
  ),
  (
    'b9500000-0000-4000-8000-000000000002', 'b9100000-0000-4000-8000-000000000001',
    'b9400000-0000-4000-8000-000000000002', 'b9200000-0000-4000-8000-000000000001',
    'old-cancelled@example.test', 'old-cancelled@example.test', 'email', 'cancelled', null,
    now() - interval '100 days', now() - interval '100 days', null
  ),
  (
    'b9500000-0000-4000-8000-000000000003', 'b9100000-0000-4000-8000-000000000001',
    'b9400000-0000-4000-8000-000000000003', 'b9200000-0000-4000-8000-000000000001',
    'recent-sent@example.test', 'recent-sent@example.test', 'email', 'sent', 'recent-provider-1',
    now() - interval '10 days', now() - interval '10 days', now() - interval '10 days'
  ),
  (
    'b9500000-0000-4000-8000-000000000004', 'b9100000-0000-4000-8000-000000000001',
    'b9400000-0000-4000-8000-000000000004', 'b9200000-0000-4000-8000-000000000001',
    'queued-old@example.test', 'queued-old@example.test', 'email', 'queued', null,
    now() - interval '100 days', now() - interval '100 days', null
  ),
  (
    'b9500000-0000-4000-8000-000000000005', 'b9100000-0000-4000-8000-000000000001',
    'b9400000-0000-4000-8000-000000000008', 'b9200000-0000-4000-8000-000000000001',
    'pending-naturally-expired@example.test', 'pending-naturally-expired@example.test',
    'email', 'queued', null,
    now() - interval '100 days', now() - interval '100 days', null
  );

update public.notification_deliveries
set state = 'sending',
    claim_token = 'b9550000-0000-4000-8000-000000000005',
    claimed_at = now() - interval '100 days'
where id = 'b9500000-0000-4000-8000-000000000005';

insert into public.notification_provider_events (
  event_id, event_type, provider_message_id, group_id, delivery_id, occurred_at
)
values (
  'retention-provider-event-old', 'email.delivered', 'old-provider-1',
  'b9100000-0000-4000-8000-000000000001', 'b9500000-0000-4000-8000-000000000001',
  now() - interval '100 days'
);

insert into public.push_devices (device_id, user_id, expo_push_token, platform, last_seen_at)
select
  ('b9600000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid,
  'b9000000-0000-4000-8000-000000000001',
  'ExponentPushToken[retention-' || value::text || ']',
  'ios', now()
from generate_series(1, 3) as value;

insert into public.notification_push_deliveries (
  id, group_id, outbox_job_id, recipient_membership_id, recipient_user_id,
  device_id, state, provider_message_id, created_at, updated_at, sent_at
)
values
  (
    'b9700000-0000-4000-8000-000000000001', 'b9100000-0000-4000-8000-000000000001',
    'b9400000-0000-4000-8000-000000000005', 'b9200000-0000-4000-8000-000000000001',
    'b9000000-0000-4000-8000-000000000001', 'b9600000-0000-4000-8000-000000000001',
    'sent', 'old-push-ticket-1', now() - interval '100 days', now() - interval '100 days', now() - interval '100 days'
  ),
  (
    'b9700000-0000-4000-8000-000000000002', 'b9100000-0000-4000-8000-000000000001',
    'b9400000-0000-4000-8000-000000000006', 'b9200000-0000-4000-8000-000000000001',
    'b9000000-0000-4000-8000-000000000001', 'b9600000-0000-4000-8000-000000000002',
    'cancelled', null, now() - interval '100 days', now() - interval '100 days', null
  ),
  (
    'b9700000-0000-4000-8000-000000000003', 'b9100000-0000-4000-8000-000000000001',
    'b9400000-0000-4000-8000-000000000007', 'b9200000-0000-4000-8000-000000000001',
    'b9000000-0000-4000-8000-000000000001', 'b9600000-0000-4000-8000-000000000003',
    'queued', null, now() - interval '100 days', now() - interval '100 days', null
  );

-- The sent push row creates a receipt through the production trigger.
update public.notification_push_receipts
set state = 'succeeded', resolved_at = now() - interval '100 days',
    created_at = now() - interval '100 days', updated_at = now() - interval '100 days'
where delivery_id = 'b9700000-0000-4000-8000-000000000001';

set local role service_role;
select *
into temporary table pruned
from public.prune_privacy_retention();
reset role;

select is((select expired_invitation_count from pruned), 2::bigint, 'persisted and naturally expired invitations over 30 days are removed');
select is((select email_provider_event_count from pruned), 1::bigint, 'provider events for old e-mail deliveries are removed');
select is((select email_delivery_count from pruned), 2::bigint, 'old terminal e-mail deliveries are removed');
select is((select push_receipt_count from pruned), 1::bigint, 'receipts for old push deliveries are removed');
select is((select push_delivery_count from pruned), 2::bigint, 'old terminal push deliveries are removed');
select ok((select pruned_at is not null from pruned), 'result includes server prune time');
select ok(not exists (select 1 from public.membership_invitations where id = 'b9300000-0000-4000-8000-000000000001'), 'old expired invitation is deleted');
select ok(exists (select 1 from public.membership_invitations where id = 'b9300000-0000-4000-8000-000000000002'), 'recent expired invitation is retained');
select ok(not exists (select 1 from public.membership_invitations where id = 'b9300000-0000-4000-8000-000000000003'), 'naturally expired pending invitation is deleted');
select ok(
  (select state = 'cancelled'::public.notification_delivery_state
      and claim_token is null
      and claimed_at is null
      and failure_reason = 'invitation_expired'
      and recipient_address like 'deleted+%@invalid.greenroster.local'
   from public.notification_deliveries
   where id = 'b9500000-0000-4000-8000-000000000005'),
  'expired invitation delivery is terminalized, unclaimed, and redacted before invitation deletion'
);
select ok(
  (select state = 'cancelled'::public.notification_outbox_job_state
      and claimed_at is null
      and safe_error = 'invitation_expired'
      and finished_at is not null
   from public.notification_outbox_jobs
   where id = 'b9400000-0000-4000-8000-000000000008'),
  'expired invitation outbox work is terminalized before invitation deletion'
);
select ok(not exists (select 1 from public.notification_provider_events where event_id = 'retention-provider-event-old'), 'old provider event is deleted');
select ok(not exists (select 1 from public.notification_deliveries where id in ('b9500000-0000-4000-8000-000000000001', 'b9500000-0000-4000-8000-000000000002')), 'old terminal e-mail deliveries are deleted');
select ok(exists (select 1 from public.notification_deliveries where id = 'b9500000-0000-4000-8000-000000000003'), 'recent terminal e-mail delivery is retained');
select ok(exists (select 1 from public.notification_deliveries where id = 'b9500000-0000-4000-8000-000000000004'), 'old queued e-mail work is retained');
select ok(not exists (select 1 from public.notification_push_receipts where delivery_id = 'b9700000-0000-4000-8000-000000000001'), 'old push receipt is deleted');
select ok(not exists (select 1 from public.notification_push_deliveries where id in ('b9700000-0000-4000-8000-000000000001', 'b9700000-0000-4000-8000-000000000002')), 'old terminal push deliveries are deleted');
select ok(exists (select 1 from public.notification_push_deliveries where id = 'b9700000-0000-4000-8000-000000000003'), 'old queued push work is retained');
select is((select count(*) from public.notification_outbox_jobs where group_id = 'b9100000-0000-4000-8000-000000000001'), 8::bigint, 'outbox history is retained for idempotency and audit correlation');
select ok(
  exists (
    select 1
    from public.notification_deliveries
    where state in ('queued', 'sending', 'retryable')
      and coalesce(sent_at, updated_at, created_at) < now() - interval '90 days'
      and id in ('b9500000-0000-4000-8000-000000000004')
  ),
  'retention does not delete sendable e-mail work'
);
select ok(
  exists (
    select 1
    from public.notification_push_deliveries
    where state in ('queued', 'sending', 'retryable')
      and coalesce(sent_at, updated_at, created_at) < now() - interval '90 days'
      and id in ('b9700000-0000-4000-8000-000000000003')
  ),
  'retention does not delete sendable push work'
);
select ok(
  (select proparallel = 'u' from pg_catalog.pg_proc where oid = 'public.prune_privacy_retention()'::regprocedure),
  'retention remains transactionally serialized'
);
select ok(
  not has_function_privilege('anon', 'public.prune_privacy_retention()', 'execute')
  and not has_function_privilege('public', 'public.prune_privacy_retention()', 'execute'),
  'anonymous and public callers cannot invoke retention'
);
select ok(
  (select pg_catalog.obj_description('public.prune_privacy_retention()'::regprocedure) like '%30 days%90 days%'),
  'retention documents both policy windows'
);
select ok(
  (select provolatile = 'v' from pg_catalog.pg_proc where oid = 'public.prune_privacy_retention()'::regprocedure),
  'retention is marked volatile because it deletes rows'
);

select * from finish();

rollback;
