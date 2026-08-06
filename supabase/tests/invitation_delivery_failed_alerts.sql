begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

select ok(
  has_function_privilege(
    'service_role',
    'public.claim_invitation_delivery_failed_email(uuid,timestamp with time zone)',
    'execute'
  ),
  'service role can claim invitation delivery failure e-mails'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.claim_invitation_delivery_failed_email(uuid,timestamp with time zone)',
    'execute'
  ),
  'authenticated clients cannot claim invitation delivery failure e-mails'
);

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at
)
values
  ('76000000-0000-4000-8000-000000000001', 'admin-alert@example.test', now(), false, false, now(), now()),
  ('76000000-0000-4000-8000-000000000002', 'coordinator-alert@example.test', now(), false, false, now(), now()),
  ('76000000-0000-4000-8000-000000000003', 'member-alert@example.test', now(), false, false, now(), now()),
  ('76000000-0000-4000-8000-000000000004', 'unverified-alert@example.test', null, false, false, now(), now()),
  ('76000000-0000-4000-8000-000000000005', 'disabled-alert@example.test', now(), false, false, now(), now());

insert into public.user_profiles (user_id, first_name, last_name)
values
  ('76000000-0000-4000-8000-000000000001', 'Alert', 'Admin'),
  ('76000000-0000-4000-8000-000000000002', 'Alert', 'Coordinator'),
  ('76000000-0000-4000-8000-000000000003', 'Alert', 'Member'),
  ('76000000-0000-4000-8000-000000000004', 'Alert', 'Unverified'),
  ('76000000-0000-4000-8000-000000000005', 'Alert', 'Disabled');

update public.user_profiles
set disabled_at = now()
where user_id = '76000000-0000-4000-8000-000000000005';

insert into public.groups (id, name, time_zone)
values ('76100000-0000-4000-8000-000000000001', 'Invitation Alert Group', 'UTC');

insert into public.memberships (
  id, group_id, user_id, role, status, activated_at, inactivated_at
)
values
  ('76200000-0000-4000-8000-000000000001', '76100000-0000-4000-8000-000000000001', '76000000-0000-4000-8000-000000000001', 'administrator', 'active', now(), null),
  ('76200000-0000-4000-8000-000000000002', '76100000-0000-4000-8000-000000000001', '76000000-0000-4000-8000-000000000002', 'coordinator', 'active', now(), null),
  ('76200000-0000-4000-8000-000000000003', '76100000-0000-4000-8000-000000000001', '76000000-0000-4000-8000-000000000003', 'member', 'active', now(), null),
  ('76200000-0000-4000-8000-000000000004', '76100000-0000-4000-8000-000000000001', '76000000-0000-4000-8000-000000000004', 'administrator', 'active', now(), null),
  ('76200000-0000-4000-8000-000000000005', '76100000-0000-4000-8000-000000000001', '76000000-0000-4000-8000-000000000005', 'administrator', 'active', now(), null),
  ('76200000-0000-4000-8000-000000000006', '76100000-0000-4000-8000-000000000001', null, 'member', 'pending', null, null);

insert into public.membership_golfer_profiles (membership_id, group_id, first_name, last_name)
values ('76200000-0000-4000-8000-000000000006', '76100000-0000-4000-8000-000000000001', 'Invited', 'Golfer');

insert into public.membership_invitations (
  id, group_id, membership_id, invited_email, invited_email_normalized, role,
  token_digest_sha256, token_key_version, status, issued_at, expires_at, inviter_user_id
)
values (
  '76300000-0000-4000-8000-000000000001',
  '76100000-0000-4000-8000-000000000001',
  '76200000-0000-4000-8000-000000000006',
  'bounced-invite@example.test',
  'bounced-invite@example.test',
  'member', repeat('b', 64), 1, 'pending', now(), now() + interval '2 days',
  '76000000-0000-4000-8000-000000000001'
);

insert into public.notification_outbox_jobs (
  id, group_id, event_type, aggregate_type, aggregate_id, aggregate_version,
  idempotency_key, state, attempts, next_attempt_at, finished_at
)
values (
  '76400000-0000-4000-8000-000000000001',
  '76100000-0000-4000-8000-000000000001',
  'membership.invitation', 'membership_invitation', '76300000-0000-4000-8000-000000000001',
  1, 'membership.invitation:76300000-0000-4000-8000-000000000001',
  'succeeded', 1, now(), now()
);

insert into public.notification_deliveries (
  id, group_id, outbox_job_id, recipient_membership_id, recipient_address,
  recipient_address_normalized, channel, provider_message_id, state, attempts, sent_at
)
values (
  '76500000-0000-4000-8000-000000000001',
  '76100000-0000-4000-8000-000000000001',
  '76400000-0000-4000-8000-000000000001',
  '76200000-0000-4000-8000-000000000006',
  'bounced-invite@example.test', 'bounced-invite@example.test', 'email',
  'resend-bounced-invite-1', 'sent', 1, now()
);

select public.record_resend_email_feedback(
  '76600000-0000-4000-8000-000000000001',
  'email.bounced',
  'resend-bounced-invite-1',
  now(),
  'bounced-invite@example.test',
  'permanent'
);

select is(
  (select count(*) from public.notification_outbox_jobs
   where event_type = 'invitation_delivery_failed'
     and group_id = '76100000-0000-4000-8000-000000000001'),
  2::bigint,
  'one failure alert parent is queued for each active verified coordinator and administrator'
);
select is(
  (select count(*) from public.notification_deliveries as delivery
   join public.notification_outbox_jobs as outbox on outbox.id = delivery.outbox_job_id
   where outbox.event_type = 'invitation_delivery_failed'
     and delivery.group_id = '76100000-0000-4000-8000-000000000001'),
  2::bigint,
  'failure alert fan-out has exactly one e-mail child per eligible recipient'
);
select is(
  (select count(*) from public.notification_deliveries as delivery
   join public.notification_outbox_jobs as outbox on outbox.id = delivery.outbox_job_id
   where outbox.event_type = 'invitation_delivery_failed'
     and delivery.recipient_membership_id in (
       '76200000-0000-4000-8000-000000000003',
       '76200000-0000-4000-8000-000000000004',
       '76200000-0000-4000-8000-000000000005'
     )),
  0::bigint,
  'members, unverified identities, and disabled profiles are excluded from the alert fan-out'
);
select is(
  (select count(*) from public.notification_deliveries as delivery
   join public.notification_outbox_jobs as outbox on outbox.id = delivery.outbox_job_id
   where outbox.event_type = 'invitation_delivery_failed'
     and delivery.recipient_address in ('admin-alert@example.test', 'coordinator-alert@example.test')),
  2::bigint,
  'alert children target current coordinator and administrator addresses'
);

select public.record_resend_email_feedback(
  '76600000-0000-4000-8000-000000000001',
  'email.bounced',
  'resend-bounced-invite-1',
  (select occurred_at from public.notification_provider_events where event_id = '76600000-0000-4000-8000-000000000001'),
  'bounced-invite@example.test',
  'permanent'
);
select is(
  (select count(*) from public.notification_outbox_jobs where event_type = 'invitation_delivery_failed'),
  2::bigint,
  'replaying the provider event does not duplicate failure alert parents'
);

select public.record_resend_email_feedback(
  '76600000-0000-4000-8000-000000000002',
  'email.bounced',
  'resend-bounced-invite-1',
  now(),
  'bounced-invite@example.test',
  'transient'
);
select is(
  (select count(*) from public.notification_outbox_jobs where event_type = 'invitation_delivery_failed'),
  2::bigint,
  'transient bounces do not queue a mandatory hard-bounce alert'
);

update auth.users
set email = case
  when id = '76000000-0000-4000-8000-000000000001' then 'admin-alert-current@example.test'
  else 'coordinator-alert-current@example.test'
end
where id in (
  '76000000-0000-4000-8000-000000000001',
  '76000000-0000-4000-8000-000000000002'
);

create temporary table alert_claim_one as
select * from public.claim_invitation_delivery_failed_email(
  '76700000-0000-4000-8000-000000000001', now() - interval '5 minutes'
);
select is((select count(*) from alert_claim_one), 1::bigint, 'first failure alert is claimable');
select is((select invited_address from alert_claim_one), 'bounced-invite@example.test', 'claim returns the bounced invitation address');
select ok(
  (select recipient_address in ('admin-alert-current@example.test', 'coordinator-alert-current@example.test') from alert_claim_one),
  'claim resolves the current verified Auth e-mail at send time'
);
select is((select attempt_number from alert_claim_one), 1, 'first alert claim starts at attempt one');

select public.record_email_send_failure(
  (select delivery_id from alert_claim_one),
  '76700000-0000-4000-8000-000000000001',
  'provider_unavailable', now() + interval '1 hour'
);
select is(
  (select state from public.notification_deliveries where id = (select delivery_id from alert_claim_one)),
  'retryable'::public.notification_delivery_state,
  'provider outage releases an alert child for retry'
);
select is(
  (select state from public.notification_outbox_jobs where id = (select outbox_job_id from alert_claim_one)),
  'retryable'::public.notification_outbox_job_state,
  'provider outage releases an alert parent for retry'
);
update public.notification_deliveries
set next_attempt_at = now()
where id = (select delivery_id from alert_claim_one);
update public.notification_outbox_jobs
set next_attempt_at = now()
where id = (select outbox_job_id from alert_claim_one);

create temporary table alert_reclaim_one as
select * from public.claim_invitation_delivery_failed_email(
  '76700000-0000-4000-8000-000000000002', now() - interval '5 minutes'
);
select is((select attempt_number from alert_reclaim_one), 2, 'alert retry increments the attempt number');
select public.record_email_send_success(
  (select delivery_id from alert_reclaim_one),
  '76700000-0000-4000-8000-000000000002',
  'resend-alert-recovered-1'
);
select is(
  (select state from public.notification_outbox_jobs where id = (select outbox_job_id from alert_reclaim_one)),
  'succeeded'::public.notification_outbox_job_state,
  'recovered alert parent terminalizes successfully'
);

update public.memberships
set status = 'inactive', inactivated_at = now()
where id = (
  select delivery.recipient_membership_id
  from public.notification_deliveries as delivery
  join public.notification_outbox_jobs as outbox
    on outbox.id = delivery.outbox_job_id
  where outbox.event_type = 'invitation_delivery_failed'
    and delivery.state = 'queued'
  order by delivery.id
  limit 1
);
create temporary table alert_claim_two as
select * from public.claim_invitation_delivery_failed_email(
  '76700000-0000-4000-8000-000000000003', now() - interval '5 minutes'
);
select is((select count(*) from alert_claim_two), 0::bigint, 'send-time role and membership revalidation prevents an inactive recipient claim');
select is(
  (select count(*) from public.notification_deliveries as delivery
   join public.notification_outbox_jobs as outbox on outbox.id = delivery.outbox_job_id
   where outbox.event_type = 'invitation_delivery_failed'
     and delivery.state = 'cancelled'::public.notification_delivery_state),
  1::bigint,
  'ineligible alert child is cancelled at claim time'
);

update public.notification_deliveries as delivery
set state = 'queued',
    sent_at = null,
    provider_message_id = null,
    next_attempt_at = now()
from public.notification_outbox_jobs as outbox
where outbox.id = delivery.outbox_job_id
  and outbox.event_type = 'invitation_delivery_failed'
  and delivery.state = 'sent';
update public.notification_outbox_jobs as outbox
set state = 'queued',
    finished_at = null,
    next_attempt_at = now()
where outbox.event_type = 'invitation_delivery_failed'
  and outbox.state = 'succeeded';
update public.membership_invitations
set status = 'expired',
    issued_at = now() - interval '32 days',
    expires_at = now() - interval '31 days',
    expired_at = now() - interval '31 days'
where id = '76300000-0000-4000-8000-000000000001';
select * from public.prune_privacy_retention();
select is(
  (select count(*) from public.notification_deliveries as delivery
   join public.notification_outbox_jobs as outbox on outbox.id = delivery.outbox_job_id
   where outbox.event_type = 'invitation_delivery_failed'
     and outbox.aggregate_id = '76300000-0000-4000-8000-000000000001'
     and delivery.state in ('queued', 'retryable', 'sending')),
  0::bigint,
  'retention leaves no sendable alert after deleting the invitation aggregate'
);

select * from finish();

rollback;
