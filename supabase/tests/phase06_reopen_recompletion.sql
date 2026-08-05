begin;

create extension if not exists pgtap with schema extensions;

select plan(61);

select has_function(
  'public',
  'reopen_completed_round',
  array['uuid', 'uuid', 'text', 'bigint', 'boolean', 'uuid', 'uuid'],
  'the service-only reopen transaction exists'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.reopen_completed_round(uuid,uuid,text,bigint,boolean,uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.reopen_completed_round(uuid,uuid,text,bigint,boolean,uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.reopen_completed_round(uuid,uuid,text,bigint,boolean,uuid,uuid)',
    'execute'
  ),
  'only the trusted server can reopen a round'
);

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at
)
values
  ('e1000000-0000-4000-8000-000000000001', 'reopen-admin@example.test', now(), false, false, now(), now()),
  ('e1000000-0000-4000-8000-000000000002', 'reopen-member@example.test', now(), false, false, now(), now());

insert into public.user_profiles (user_id, display_name, first_name, last_name)
values
  ('e1000000-0000-4000-8000-000000000001', 'Reopen Admin', 'Reopen', 'Admin'),
  ('e1000000-0000-4000-8000-000000000002', 'Reopen Member', 'Reopen', 'Member');

insert into public.groups (id, name, time_zone)
values
  ('e2000000-0000-4000-8000-000000000001', 'Reopen Group', 'UTC'),
  ('e2000000-0000-4000-8000-000000000002', 'Other Reopen Group', 'UTC');

insert into public.memberships (
  id, group_id, user_id, role, status, activated_at,
  initial_quota, uses_initial_quota, initial_quota_provenance
)
values
  ('e3000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'administrator', 'active', now(), null, false, null),
  ('e3000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002', 'member', 'active', now(), 20, true, 'member_bootstrap');

insert into public.push_devices (
  device_id, user_id, expo_push_token, platform, last_seen_at
)
values (
  'e3100000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000002',
  'ExponentPushToken[reopen-member-device]',
  'ios', now()
);

insert into public.group_quota_settings (
  group_id, method, moving_average_history_length, precision, rounding_rule,
  version, updated_by, participation_merit
)
values (
  'e2000000-0000-4000-8000-000000000001', 'moving_average', 4, 2,
  'half_away_from_zero', 1, 'e1000000-0000-4000-8000-000000000001', 2
);

insert into public.placement_merit_rows (group_id, rank, merit_points)
values ('e2000000-0000-4000-8000-000000000001', 1, 10);

insert into public.membership_quota_seed_totals (membership_id, group_id, position, point_total)
values
  ('e3000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000001', 1, 10),
  ('e3000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000001', 2, 20),
  ('e3000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000001', 3, 30);

insert into public.rounds (
  id, group_id, description, scheduled_at, group_time_zone, format, state,
  published_at, created_by
)
values
  ('e4000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'Reopen round', now(), 'UTC', 'individual_net', 'live', now(), 'e1000000-0000-4000-8000-000000000001'),
  ('e4000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000002', 'Other tenant round', now(), 'UTC', 'individual_net', 'completed', now(), 'e1000000-0000-4000-8000-000000000001');

insert into public.round_rule_snapshots (
  round_id, group_id, format, quota_method, moving_average_history_length,
  quota_precision, quota_rounding_rule, adjustment_bands, settings_version
)
values
  ('e4000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'individual_net', 'moving_average', 4, 2, 'half_away_from_zero', '[]', 1);

insert into public.round_participants (
  id, round_id, group_id, membership_id, participant_kind, sponsor_membership_id,
  rsvp_status, quota_snapshot
)
values
  ('e5000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000002', 'member', null, 'playing', 20);

insert into public.score_revisions (
  id, group_id, round_id, participant_id, revision_number, base_version,
  device_operation_id, actor_user_id, source, client_changed_at, correlation_id,
  operation_id, changed_fields, golf_points, manual_merit, plus_minus, ranking_value,
  request_fingerprint
)
values (
  'e6000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000001', 1, 0,
  'e7000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'portal', now(), 'e8000000-0000-4000-8000-000000000001',
  'e9000000-0000-4000-8000-000000000001', '{"golf_points": true}', 40, 1, 20, 20,
  repeat('1', 64)
);

insert into public.participant_score_projections (
  participant_id, group_id, round_id, golf_points, manual_merit,
  plus_minus, ranking_value, version, last_revision_id
)
values (
  'e5000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001', 40, 1, 20, 20, 1,
  'e6000000-0000-4000-8000-000000000001'
);

create temporary table first_completion as
select *
from public.complete_live_round(
  'e1000000-0000-4000-8000-000000000001',
  'e4000000-0000-4000-8000-000000000001',
  1,
  true,
  'ea000000-0000-4000-8000-000000000001',
  'eb000000-0000-4000-8000-000000000001'
);

select is((select state from first_completion), 'completed'::public.round_state, 'fixture completion creates a completed round');
select is((select projected_quota::numeric from public.membership_quota_projections where membership_id = 'e3000000-0000-4000-8000-000000000002'), 25::numeric, 'fixture completion creates the derived quota projection');
select is((select total_merit from public.round_official_results where participant_id = 'e5000000-0000-4000-8000-000000000001'), 13::numeric, 'fixture result contains generated and manual merit');
select is((select count(*) from public.score_revisions where participant_id = 'e5000000-0000-4000-8000-000000000001'), 1::bigint, 'fixture starts with one immutable score revision');

-- Claim one result push before Reopen so the lifecycle test exercises an
-- in-flight provider lease rather than only queued cancellation.
update public.rounds
set group_time_zone = case
  when extract(hour from (now() at time zone 'UTC')) < 7 then 'Etc/GMT+12'
  when extract(hour from (now() at time zone 'UTC')) >= 21 then 'Etc/GMT-12'
  else 'UTC'
end
where id = 'e4000000-0000-4000-8000-000000000001';
update public.notification_push_deliveries
set next_attempt_at = now()
where outbox_job_id = (
  select id
  from public.notification_outbox_jobs
  where event_type = 'results_published'
    and aggregate_type = 'round_completion'
    and aggregate_id = (
      select id
      from public.round_completion_runs
      where round_id = 'e4000000-0000-4000-8000-000000000001'
        and state = 'official'
    )
);
update public.notification_outbox_jobs
set next_attempt_at = now()
where event_type = 'results_published'
  and aggregate_type = 'round_completion'
  and aggregate_id = (
    select id
    from public.round_completion_runs
    where round_id = 'e4000000-0000-4000-8000-000000000001'
      and state = 'official'
  );
create temporary table inflight_push as
select *
from public.claim_results_published_push(
  'e7100000-0000-4000-8000-000000000001',
  now() - interval '1 hour'
);
select is((select count(*) from inflight_push), 1::bigint, 'reopen fixture leases one result push before withdrawal');
select is((select state from public.notification_push_deliveries where id = (select delivery_id from inflight_push)), 'sending'::public.notification_delivery_state, 'reopen fixture push is in flight before withdrawal');

create temporary table reopened as
select *
from public.reopen_completed_round(
  'e1000000-0000-4000-8000-000000000001',
  'e4000000-0000-4000-8000-000000000001',
  'Correct a published score',
  2,
  true,
  'ec000000-0000-4000-8000-000000000001',
  'ed000000-0000-4000-8000-000000000001'
);

select is((select state from reopened), 'live'::public.round_state, 'reopen returns a Live round');
select is((select version from reopened), 3::bigint, 'reopen advances the round version');
select is((select state from public.rounds where id = 'e4000000-0000-4000-8000-000000000001'), 'live'::public.round_state, 'reopen restores Live scoring');
select is((select version from public.rounds where id = 'e4000000-0000-4000-8000-000000000001'), 3::bigint, 'reopened round version is durable');
select is((select state from public.round_completion_runs where id = (select completion_id from reopened)), 'reopened'::public.round_completion_run_state, 'the prior official run is withdrawn');
select is((select reopen_reason from public.round_completion_runs where id = (select completion_id from reopened)), 'Correct a published score', 'the reason is retained on the completion run');
select is((select count(*) from public.round_completion_runs where round_id = 'e4000000-0000-4000-8000-000000000001' and state = 'official'), 0::bigint, 'no official run remains while the round is reopened');
select is((select state from public.notification_outbox_jobs where event_type = 'results_published' and aggregate_type = 'round_completion' and aggregate_id = (select completion_id from reopened)), 'cancelled'::public.notification_outbox_job_state, 'withdrawn results outbox work is terminalized');
select is((select state from public.notification_push_deliveries where outbox_job_id = (select id from public.notification_outbox_jobs where event_type = 'results_published' and aggregate_type = 'round_completion' and aggregate_id = (select completion_id from reopened))), 'sending'::public.notification_delivery_state, 'withdrawn result push lease remains in flight until the provider callback or lease expiry');
select lives_ok(
  $$ select public.record_results_push_send_failure(
       (select delivery_id from inflight_push),
       'e7100000-0000-4000-8000-000000000001',
       'provider_unavailable',
       now() + interval '5 minutes'
     ) $$,
  'withdrawn result push failure callback terminalizes the in-flight child'
);
select is((select state from public.notification_push_deliveries where id = (select delivery_id from inflight_push)), 'cancelled'::public.notification_delivery_state, 'withdrawn in-flight result push is cancelled after a failure callback');
select is((select failure_reason from public.notification_push_deliveries where outbox_job_id = (select id from public.notification_outbox_jobs where event_type = 'results_published' and aggregate_type = 'round_completion' and aggregate_id = (select completion_id from reopened))), 'round_reopened', 'withdrawn push work records the safe reopen reason');
select is((select count(*) from public.round_official_results where completion_id = (select completion_id from reopened)), 1::bigint, 'the prior result snapshot remains for investigation');
select is((select generated_merit::numeric from public.round_official_results where completion_id = (select completion_id from reopened)), 12::numeric, 'generated merit is retained as historical evidence');
select is((select manual_merit::numeric from public.round_official_results where completion_id = (select completion_id from reopened)), 1::numeric, 'manual merit survives the reopen');
select is((select count(*) from public.membership_quota_history where membership_id = 'e3000000-0000-4000-8000-000000000002'), 1::bigint, 'quota history remains append-only after reopen');
select is((select projected_quota::numeric from public.membership_quota_projections where membership_id = 'e3000000-0000-4000-8000-000000000002'), 20::numeric, 'quota projection recomputes from the remaining official history');
select is((select merit_total from public.membership_standings_projections where membership_id = 'e3000000-0000-4000-8000-000000000002'), 0::numeric, 'reopen removes generated merit from current standings');
select is((select rounds_played from public.membership_standings_projections where membership_id = 'e3000000-0000-4000-8000-000000000002'), 0::bigint, 'reopen removes the round from current rounds played');
select ok((select standing_rank is null from public.membership_standings_projections where membership_id = 'e3000000-0000-4000-8000-000000000002'), 'reopen removes the current standing rank');
select is((select count(*) from public.score_revisions where participant_id = 'e5000000-0000-4000-8000-000000000001'), 1::bigint, 'reopen preserves score revision history');
select is((select count(*) from public.audit_events where action = 'round.reopened' and target_id = 'e4000000-0000-4000-8000-000000000001'), 1::bigint, 'reopen writes one audited lifecycle event');

create temporary table reopen_replay as
select *
from public.reopen_completed_round(
  'e1000000-0000-4000-8000-000000000001',
  'e4000000-0000-4000-8000-000000000001',
  'Correct a published score',
  2,
  true,
  'ec000000-0000-4000-8000-000000000001',
  'ed000000-0000-4000-8000-000000000001'
);

select is((select completion_id from reopen_replay), (select completion_id from reopened), 'same reopen operation replays its committed receipt');
select is((select count(*) from public.audit_events where action = 'round.reopened' and target_id = 'e4000000-0000-4000-8000-000000000001'), 1::bigint, 'exact reopen replay does not duplicate the audit');
select throws_ok(
  $$ select * from public.reopen_completed_round(
    'e1000000-0000-4000-8000-000000000001',
    'e4000000-0000-4000-8000-000000000001',
    'Different reason', 2, true,
    'ec000000-0000-4000-8000-000000000001',
    'ed000000-0000-4000-8000-000000000001'
  ) $$,
  '23505',
  'operation_id_reused',
  'same reopen operation cannot be replayed with changed inputs'
);
select throws_ok(
  $$ select * from public.reopen_completed_round(
    'e1000000-0000-4000-8000-000000000001',
    'e4000000-0000-4000-8000-000000000001',
    'Another correction', 3, false,
    'ee000000-0000-4000-8000-000000000001',
    'ef000000-0000-4000-8000-000000000001'
  ) $$,
  '22023',
  'round_reopen_confirmation_required',
  'reopen requires explicit confirmation'
);
select throws_ok(
  $$ select * from public.reopen_completed_round(
    'e1000000-0000-4000-8000-000000000001',
    'e4000000-0000-4000-8000-000000000001',
    '   ', 3, true,
    'f0000000-0000-4000-8000-000000000001',
    'f1000000-0000-4000-8000-000000000001'
  ) $$,
  '22023',
  'round_reopen_reason_required',
  'reopen requires a nonblank reason'
);
select throws_ok(
  $$ select * from public.reopen_completed_round(
    'e1000000-0000-4000-8000-000000000002',
    'e4000000-0000-4000-8000-000000000001',
    'Member cannot reopen', 3, true,
    'f2000000-0000-4000-8000-000000000001',
    'f3000000-0000-4000-8000-000000000001'
  ) $$,
  'P0003',
  'actor_not_authorized',
  'members cannot reopen a round'
);
select throws_ok(
  $$ select * from public.reopen_completed_round(
    'e1000000-0000-4000-8000-000000000001',
    'e4000000-0000-4000-8000-000000000002',
    'Cross tenant', 1, true,
    'f4000000-0000-4000-8000-000000000001',
    'f5000000-0000-4000-8000-000000000001'
  ) $$,
  'P0002',
  'round_not_found',
  'cross-tenant rounds are indistinguishable from missing rounds'
);

select *
from public.set_round_participant_score(
  'e1000000-0000-4000-8000-000000000001',
  'e5000000-0000-4000-8000-000000000001',
  '{"golf_points": 42}',
  1,
  'f6000000-0000-4000-8000-000000000001',
  'portal',
  'Corrected total after review',
  now(),
  'f7000000-0000-4000-8000-000000000001',
  'f8000000-0000-4000-8000-000000000001'
);

create temporary table recompleted as
select *
from public.complete_live_round(
  'e1000000-0000-4000-8000-000000000001',
  'e4000000-0000-4000-8000-000000000001',
  3,
  true,
  'f9000000-0000-4000-8000-000000000001',
  'fa000000-0000-4000-8000-000000000001'
);

select is((select state from recompleted), 'completed'::public.round_state, 'recompletion publishes the corrected result');
select is((select version from recompleted), 4::bigint, 'recompletion advances the round version again');
select is((select count(*) from public.round_completion_runs where round_id = 'e4000000-0000-4000-8000-000000000001'), 2::bigint, 'recompletion retains both completion attempts');
select is((select count(*) from public.round_completion_runs where round_id = 'e4000000-0000-4000-8000-000000000001' and state = 'official'), 1::bigint, 'recompletion creates one current official run');
select is((select count(*) from public.round_completion_runs where round_id = 'e4000000-0000-4000-8000-000000000001' and state = 'reopened'), 1::bigint, 'the prior run remains reopened');
select is((select count(*) from public.round_official_results where round_id = 'e4000000-0000-4000-8000-000000000001'), 2::bigint, 'recompletion retains a second immutable result snapshot');
select is((select golf_points::numeric from public.round_official_results where completion_id = (select completion_id from recompleted)), 42::numeric, 'recompletion reads the latest authoritative score');
select is((select manual_merit::numeric from public.round_official_results where completion_id = (select completion_id from recompleted)), 1::numeric, 'recompletion preserves manual merit in the new snapshot');
select is((select count(*) from public.membership_quota_history where membership_id = 'e3000000-0000-4000-8000-000000000002'), 2::bigint, 'recompletion appends a new eligible quota history row');
select is((select projected_quota::numeric from public.membership_quota_projections where membership_id = 'e3000000-0000-4000-8000-000000000002'), 25.5::numeric, 'recompletion recomputes the current quota from active history');
select is((select merit_total from public.membership_standings_projections where membership_id = 'e3000000-0000-4000-8000-000000000002'), 13::numeric, 'recompletion reapplies generated merit to standings');
select is((select rounds_played from public.membership_standings_projections where membership_id = 'e3000000-0000-4000-8000-000000000002'), 1::bigint, 'recompletion restores one eligible round');
select is((select count(*) from public.notification_outbox_jobs where event_type = 'results_published'), 2::bigint, 'recompletion queues a second results notification');
select is((select count(distinct idempotency_key) from public.notification_outbox_jobs where event_type = 'results_published'), 2::bigint, 'recompletion notification is keyed to its new completion run');
select is((select count(*) from public.notification_push_deliveries where outbox_job_id = (select id from public.notification_outbox_jobs where event_type = 'results_published' and aggregate_id = (select completion_id from recompleted))), 1::bigint, 'recompletion creates a fresh push delivery for the new official run');
select is((select count(*) from public.notification_deliveries where outbox_job_id = (select id from public.notification_outbox_jobs where event_type = 'results_published' and aggregate_id = (select completion_id from recompleted)) and recipient_membership_id = 'e3000000-0000-4000-8000-000000000002' and channel = 'email'), 1::bigint, 'recompletion creates exactly one results e-mail child for the fixture member');
select is((select count(*) from public.notification_deliveries where outbox_job_id = (select id from public.notification_outbox_jobs where event_type = 'results_published' and aggregate_id = (select completion_id from reopened)) and recipient_membership_id = 'e3000000-0000-4000-8000-000000000002' and channel = 'email'), 1::bigint, 'prior results outbox retains exactly one e-mail child without replay duplication');
select is((select count(*) from public.audit_events where action = 'round.completed' and target_id = 'e4000000-0000-4000-8000-000000000001'), 2::bigint, 'recompletion writes a second completion audit');
select is((select count(*) from public.score_revisions where participant_id = 'e5000000-0000-4000-8000-000000000001'), 2::bigint, 'recompletion preserves both score revisions');

-- A missed provider callback must not strand the fresh child after a second
-- Reopen. The stale lease pass terminalizes it as cancelled and returns no
-- provider-visible work.
update public.rounds
set group_time_zone = case
  when extract(hour from (now() at time zone 'UTC')) < 7 then 'Etc/GMT+12'
  when extract(hour from (now() at time zone 'UTC')) >= 21 then 'Etc/GMT-12'
  else 'UTC'
end
where id = 'e4000000-0000-4000-8000-000000000001';
update public.notification_push_deliveries
set next_attempt_at = now()
where outbox_job_id = (
  select id
  from public.notification_outbox_jobs
  where event_type = 'results_published'
    and aggregate_type = 'round_completion'
    and aggregate_id = (select completion_id from recompleted)
);
update public.notification_outbox_jobs
set next_attempt_at = now()
where event_type = 'results_published'
  and aggregate_type = 'round_completion'
  and aggregate_id = (select completion_id from recompleted);
create temporary table stale_push as
select *
from public.claim_results_published_push(
  'e7200000-0000-4000-8000-000000000001',
  now() - interval '1 hour'
);
select is((select count(*) from stale_push), 1::bigint, 'recompletion push can be leased before the second withdrawal');
update public.notification_push_deliveries
set claimed_at = now() - interval '2 hours'
where id = (select delivery_id from stale_push);
select lives_ok(
  $$ select * from public.reopen_completed_round(
       'e1000000-0000-4000-8000-000000000001',
       'e4000000-0000-4000-8000-000000000001',
       'Withdraw second published result',
       4,
       true,
       'e7300000-0000-4000-8000-000000000001',
       'e7400000-0000-4000-8000-000000000001'
     ) $$,
  'second Reopen succeeds while a push lease is stale'
);
create temporary table stale_recovery as
select *
from public.claim_results_published_push(
  'e7500000-0000-4000-8000-000000000001',
  now() - interval '1 hour'
);
select is((select count(*) from stale_recovery), 0::bigint, 'stale withdrawn push is not re-exposed to a provider worker');
select is((select state from public.notification_push_deliveries where id = (select delivery_id from stale_push)), 'cancelled'::public.notification_delivery_state, 'stale withdrawn result push is terminalized');
select is((select failure_reason from public.notification_push_deliveries where id = (select delivery_id from stale_push)), 'round_reopened', 'stale withdrawn push records the reopen reason');

select * from finish();

rollback;
