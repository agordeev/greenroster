begin;

create extension if not exists pgtap with schema extensions;

select plan(18);

select has_function(
  'app',
  'round_competition_ranking',
  array['app.entity_id', 'app.entity_id'],
  'the private round ranking helper exists'
);
select ok(
  has_function_privilege(
    'service_role',
    'app.round_competition_ranking(app.entity_id,app.entity_id)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'app.round_competition_ranking(app.entity_id,app.entity_id)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'app.round_competition_ranking(app.entity_id,app.entity_id)',
    'execute'
  ),
  'only the trusted server can execute the ranking helper'
);

insert into auth.users (
  id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at
)
values
  ('4a000000-0000-4000-8000-000000000001', 'ranking-admin-a@example.test', now(), false, false, now(), now()),
  ('4a000000-0000-4000-8000-000000000002', 'ranking-admin-b@example.test', now(), false, false, now(), now());

insert into public.groups (id, name, time_zone)
values
  ('4b000000-0000-4000-8000-000000000001', 'Ranking Group A', 'UTC'),
  ('4b000000-0000-4000-8000-000000000002', 'Ranking Group B', 'UTC');

insert into public.memberships (id, group_id, user_id, role, status, activated_at)
values
  ('4c000000-0000-4000-8000-000000000001', '4b000000-0000-4000-8000-000000000001', '4a000000-0000-4000-8000-000000000001', 'administrator', 'active', now()),
  ('4c000000-0000-4000-8000-000000000002', '4b000000-0000-4000-8000-000000000001', null, 'member', 'pending', null),
  ('4c000000-0000-4000-8000-000000000003', '4b000000-0000-4000-8000-000000000001', null, 'member', 'pending', null),
  ('4c000000-0000-4000-8000-000000000004', '4b000000-0000-4000-8000-000000000001', null, 'member', 'pending', null),
  ('4c000000-0000-4000-8000-000000000005', '4b000000-0000-4000-8000-000000000001', null, 'member', 'pending', null),
  ('4c000000-0000-4000-8000-000000000006', '4b000000-0000-4000-8000-000000000002', '4a000000-0000-4000-8000-000000000002', 'administrator', 'active', now());

insert into public.rounds (
  id, group_id, description, scheduled_at, group_time_zone, format, state,
  published_at, created_by
)
values
  ('4d000000-0000-4000-8000-000000000001', '4b000000-0000-4000-8000-000000000001', 'Net ranking', now(), 'UTC', 'individual_net', 'live', now(), '4a000000-0000-4000-8000-000000000001'),
  ('4d000000-0000-4000-8000-000000000002', '4b000000-0000-4000-8000-000000000001', 'Gross ranking', now(), 'UTC', 'individual_gross', 'live', now(), '4a000000-0000-4000-8000-000000000001'),
  ('4d000000-0000-4000-8000-000000000003', '4b000000-0000-4000-8000-000000000001', 'Snapshot format wins', now(), 'UTC', 'individual_gross', 'live', now(), '4a000000-0000-4000-8000-000000000001');

insert into public.round_rule_snapshots (round_id, group_id, format, settings_version)
values
  ('4d000000-0000-4000-8000-000000000001', '4b000000-0000-4000-8000-000000000001', 'individual_net', 0),
  ('4d000000-0000-4000-8000-000000000002', '4b000000-0000-4000-8000-000000000001', 'individual_gross', 0),
  ('4d000000-0000-4000-8000-000000000003', '4b000000-0000-4000-8000-000000000001', 'individual_net', 0);

insert into public.round_participants (
  id, round_id, group_id, membership_id, participant_kind, rsvp_status, quota_snapshot
)
values
  ('4e000000-0000-4000-8000-000000000001', '4d000000-0000-4000-8000-000000000001', '4b000000-0000-4000-8000-000000000001', '4c000000-0000-4000-8000-000000000002', 'member', 'playing', 12),
  ('4e000000-0000-4000-8000-000000000002', '4d000000-0000-4000-8000-000000000001', '4b000000-0000-4000-8000-000000000001', '4c000000-0000-4000-8000-000000000003', 'member', 'playing', 10),
  ('4e000000-0000-4000-8000-000000000003', '4d000000-0000-4000-8000-000000000001', '4b000000-0000-4000-8000-000000000001', '4c000000-0000-4000-8000-000000000004', 'member', 'playing', 8),
  ('4e000000-0000-4000-8000-000000000004', '4d000000-0000-4000-8000-000000000001', '4b000000-0000-4000-8000-000000000001', '4c000000-0000-4000-8000-000000000005', 'member', 'playing', 8),
  ('4e000000-0000-4000-8000-000000000005', '4d000000-0000-4000-8000-000000000001', '4b000000-0000-4000-8000-000000000001', '4c000000-0000-4000-8000-000000000001', 'member', 'not_playing', 8);

insert into public.round_participants (
  id, round_id, group_id, participant_kind, sponsor_membership_id,
  guest_first_name, guest_last_name, rsvp_status, quota_snapshot
)
values
  ('4e000000-0000-4000-8000-000000000006', '4d000000-0000-4000-8000-000000000001', '4b000000-0000-4000-8000-000000000001', 'guest', '4c000000-0000-4000-8000-000000000002', 'Net', 'Guest', 'playing', 5);

insert into public.round_participants (
  id, round_id, group_id, membership_id, participant_kind, rsvp_status, quota_snapshot
)
values
  ('4e000000-0000-4000-8000-000000000011', '4d000000-0000-4000-8000-000000000002', '4b000000-0000-4000-8000-000000000001', '4c000000-0000-4000-8000-000000000002', 'member', 'playing', 12),
  ('4e000000-0000-4000-8000-000000000012', '4d000000-0000-4000-8000-000000000002', '4b000000-0000-4000-8000-000000000001', '4c000000-0000-4000-8000-000000000003', 'member', 'playing', 20),
  ('4e000000-0000-4000-8000-000000000013', '4d000000-0000-4000-8000-000000000002', '4b000000-0000-4000-8000-000000000001', '4c000000-0000-4000-8000-000000000004', 'member', 'playing', 10),
  ('4e000000-0000-4000-8000-000000000014', '4d000000-0000-4000-8000-000000000002', '4b000000-0000-4000-8000-000000000001', '4c000000-0000-4000-8000-000000000005', 'member', 'playing', 10);

insert into public.round_participants (
  id, round_id, group_id, participant_kind, sponsor_membership_id,
  guest_first_name, guest_last_name, rsvp_status, quota_snapshot
)
values
  ('4e000000-0000-4000-8000-000000000015', '4d000000-0000-4000-8000-000000000002', '4b000000-0000-4000-8000-000000000001', 'guest', '4c000000-0000-4000-8000-000000000002', 'Gross', 'Guest', 'playing', 10);

insert into public.round_participants (
  id, round_id, group_id, membership_id, participant_kind, rsvp_status, quota_snapshot
)
values
  ('4e000000-0000-4000-8000-000000000016', '4d000000-0000-4000-8000-000000000002', '4b000000-0000-4000-8000-000000000001', '4c000000-0000-4000-8000-000000000001', 'member', 'playing', 12);

insert into public.round_participants (
  id, round_id, group_id, membership_id, participant_kind, rsvp_status, quota_snapshot
)
values
  ('4e000000-0000-4000-8000-000000000017', '4d000000-0000-4000-8000-000000000003', '4b000000-0000-4000-8000-000000000001', '4c000000-0000-4000-8000-000000000001', 'member', 'playing', 12);

-- Net ranking must use the server-derived plus/minus, not golf points or the
-- projection's denormalized ranking_value.  The final member has no score
-- projection and therefore remains unranked.
insert into public.participant_score_projections (
  participant_id, group_id, round_id, golf_points, plus_minus, ranking_value
)
values
  ('4e000000-0000-4000-8000-000000000001', '4b000000-0000-4000-8000-000000000001', '4d000000-0000-4000-8000-000000000001', 20, 8, 1),
  ('4e000000-0000-4000-8000-000000000002', '4b000000-0000-4000-8000-000000000001', '4d000000-0000-4000-8000-000000000001', 30, 8, 2),
  ('4e000000-0000-4000-8000-000000000003', '4b000000-0000-4000-8000-000000000001', '4d000000-0000-4000-8000-000000000001', 10, 3, 3),
  ('4e000000-0000-4000-8000-000000000006', '4b000000-0000-4000-8000-000000000001', '4d000000-0000-4000-8000-000000000001', 40, 1, 4);

create temporary table net_results as
select *
from app.round_competition_ranking(
  '4d000000-0000-4000-8000-000000000001',
  '4b000000-0000-4000-8000-000000000001'
);

select is((select count(*) from net_results), 5::bigint, 'net results include every Playing member and guest, but exclude Not Playing');
select is((select count(*) from net_results where participant_kind = 'guest'), 1::bigint, 'net results include the round-scoped guest');
select is((select ranking_value::numeric from net_results where participant_id = '4e000000-0000-4000-8000-000000000001'), 8::numeric, 'Individual Net ranking value is server-derived plus/minus');
select is((select competition_rank from net_results where participant_id = '4e000000-0000-4000-8000-000000000001'), 1::bigint, 'first tied net player receives rank one');
select is((select competition_rank from net_results where participant_id = '4e000000-0000-4000-8000-000000000002'), 1::bigint, 'second tied net player receives the same full rank');
select is((select competition_rank from net_results where participant_id = '4e000000-0000-4000-8000-000000000003'), 3::bigint, 'next distinct net player uses competition numbering');
select is((select competition_rank from net_results where participant_id = '4e000000-0000-4000-8000-000000000004'), null::bigint, 'missing net ranking input remains rank null');

set local role service_role;
select is(
  (select count(*) from app.round_competition_ranking(
    '4d000000-0000-4000-8000-000000000001',
    '4b000000-0000-4000-8000-000000000001'
  )),
  5::bigint,
  'trusted service role can execute the tenant-scoped helper'
);
reset role;

-- Gross ranking must use golf points, independently of quota and plus/minus.
insert into public.participant_score_projections (
  participant_id, group_id, round_id, golf_points, plus_minus, ranking_value
)
values
  ('4e000000-0000-4000-8000-000000000011', '4b000000-0000-4000-8000-000000000001', '4d000000-0000-4000-8000-000000000002', 30, -5, -5),
  ('4e000000-0000-4000-8000-000000000012', '4b000000-0000-4000-8000-000000000001', '4d000000-0000-4000-8000-000000000002', 30, -10, -10),
  ('4e000000-0000-4000-8000-000000000013', '4b000000-0000-4000-8000-000000000001', '4d000000-0000-4000-8000-000000000002', 30, 99, 99),
  ('4e000000-0000-4000-8000-000000000014', '4b000000-0000-4000-8000-000000000001', '4d000000-0000-4000-8000-000000000002', 10, 0, 0),
  ('4e000000-0000-4000-8000-000000000015', '4b000000-0000-4000-8000-000000000001', '4d000000-0000-4000-8000-000000000002', 20, 0, 0);

insert into public.participant_score_projections (
  participant_id, group_id, round_id, golf_points, plus_minus, ranking_value
)
values
  ('4e000000-0000-4000-8000-000000000017', '4b000000-0000-4000-8000-000000000001', '4d000000-0000-4000-8000-000000000003', 20, 8, 1);

create temporary table gross_results as
select *
from app.round_competition_ranking(
  '4d000000-0000-4000-8000-000000000002',
  '4b000000-0000-4000-8000-000000000001'
);

select is((select ranking_value::numeric from gross_results where participant_id = '4e000000-0000-4000-8000-000000000011'), 30::numeric, 'Individual Gross ranking value is golf points');
select is((select competition_rank from gross_results where participant_id = '4e000000-0000-4000-8000-000000000011'), 1::bigint, 'gross tie starts at rank one');
select is((select competition_rank from gross_results where participant_id = '4e000000-0000-4000-8000-000000000012'), 1::bigint, 'gross ties share the full competition rank');
select is((select competition_rank from gross_results where participant_id = '4e000000-0000-4000-8000-000000000015'), 4::bigint, 'gross competition numbering follows the two-player tie');
select is((select ranking_value::numeric from gross_results where participant_id = '4e000000-0000-4000-8000-000000000016'), null::numeric, 'gross participant without points remains unranked');
select is((select competition_rank from gross_results where participant_id = '4e000000-0000-4000-8000-000000000016'), null::bigint, 'gross participant without points has no competition rank');

select is(
  (select ranking_value::numeric from app.round_competition_ranking(
    '4d000000-0000-4000-8000-000000000003',
    '4b000000-0000-4000-8000-000000000001'
  )),
  8::numeric,
  'immutable snapshot format controls ranking when it differs from the mutable round row'
);

select is(
  (select count(*) from app.round_competition_ranking(
    '4d000000-0000-4000-8000-000000000001',
    '4b000000-0000-4000-8000-000000000002'
  )),
  0::bigint,
  'a group key from another tenant cannot read this round ranking'
);

select * from finish();

rollback;
