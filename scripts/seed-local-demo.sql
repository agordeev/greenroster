-- Local-only demo group for looking at real pages with real-looking data.
-- Run it with `pnpm db:demo` (which passes --local). It never belongs in a
-- migration or in supabase/seed.sql: the accounts below share a known password.
--
-- Everything a golfer would do is done through the same database functions
-- the app calls, so standings, quotas and results are computed, not typed in.
-- The only direct writes are (1) the sign-in accounts and (2) moving finished
-- rounds back in time so the group has six weeks of history.
--
-- Sign-ins (password: greenroster-demo)
--   organizer@example.test     runs "Fairview Saturday Group"
--   coordinator@example.test   helps run it
--   member@example.test        plays in it
--   newmember@example.test     accepted an invitation, has not finished joining
--   neworganizer@example.test  runs "Hillside Sunday Society", which is empty

do $seed$
declare
  c_password constant text := 'greenroster-demo';
  c_zone constant text := 'Europe/London';
  c_venues constant text[] := array['Fairview Golf Club', 'Kingsdown Park', 'Ashby Heath'];

  v_org uuid;
  v_org_membership uuid;
  v_group uuid;
  v_settings_version bigint;
  v_terms text;
  v_privacy text;
  v_source jsonb;

  v_today date;
  v_last_sat date;
  v_next_sat date;
  v_tee timestamptz;
  v_deadline timestamptz;
  v_deadline_local text;

  v_mid uuid;
  v_inv uuid;
  v_digest text;
  v_round uuid;
  v_ver bigint;
  v_fp text;
  v_status public.round_rsvp_status;
  v_points numeric;
  v_fields jsonb;
  v_pick integer;
  k integer;
  m record;
  part record;
begin
  if exists (select 1 from auth.users where email = 'organizer@example.test') then
    raise notice 'Demo data is already loaded. Run `pnpm db:reset` first to rebuild it.';
    return;
  end if;

  if exists (select 1 from auth.users where email !~ '@example\.(test|com)$') then
    raise exception 'This database holds real accounts. The demo seed only runs on a local database.';
  end if;

  select terms_version, privacy_version into v_terms, v_privacy
  from app.current_legal_documents;
  if not found then
    raise exception 'Run `pnpm db:local-legal` before the demo seed.';
  end if;

  v_today := (now() at time zone c_zone)::date;
  v_last_sat := v_today - (case when extract(dow from v_today)::int = 6 then 7 else extract(dow from v_today)::int + 1 end);
  v_next_sat := v_last_sat + 7;
  if v_next_sat <= v_today then
    v_next_sat := v_next_sat + 7;
  end if;

  ---------------------------------------------------------------------------
  -- People
  ---------------------------------------------------------------------------
  create temp table seed_member (
    ord integer primary key,
    key text not null unique,
    email text,
    first_name text not null,
    last_name text not null,
    quota numeric,
    tee text,
    handicap numeric,
    user_id uuid,
    membership_id uuid
  ) on commit drop;

  insert into seed_member (ord, key, email, first_name, last_name, quota, tee, handicap) values
    (1,  'organizer',   'organizer@example.test',     'Alex',   'Morgan',   30, 'middle', 9.4),
    (2,  'member',      'member@example.test',        'Sam',    'Carter',   28, 'middle', 12.1),
    (3,  'coordinator', 'coordinator@example.test',   'Priya',  'Shah',     33, 'front',  6.8),
    (4,  'dan',         'dan.whitlock@example.test',  'Dan',    'Whitlock', 25, 'middle', 15.3),
    (5,  'maria',       'maria.lopez@example.test',   'Maria',  'Lopez',    22, 'front',  18.0),
    (6,  'chris',       'chris.bennett@example.test', 'Chris',  'Bennett',  36, 'back',   2.5),
    (7,  'jo',          'jo.fraser@example.test',     'Jo',     'Fraser',   19, 'front',  22.7),
    (8,  'nick',        'nick.adeyemi@example.test',  'Nick',   'Adeyemi',  27, 'middle', null),
    (9,  'helen',       'helen.doyle@example.test',   'Helen',  'Doyle',    31, 'middle', 8.2),
    (10, 'tom',         'tom.becker@example.test',    'Tom',    'Becker',   24, 'back',   null),
    (11, 'rob',         'rob.ellis@example.test',     'Rob',    'Ellis',    29, 'back',   10.6),
    (12, 'grace',       'grace.kim@example.test',     'Grace',  'Kim',      21, 'front',  19.9),
    -- Joined after the last round was announced: no quota yet, not finished joining.
    (13, 'newmember',   'newmember@example.test',     'Ben',    'Okafor',   null, 'middle', null),
    -- Added by the organizer, no account yet.
    (14, 'liam',        'liam.parker@example.test',   'Liam',   'Parker',   null, 'middle', null),
    (15, 'olivia',      null,                         'Olivia', 'Reed',     null, 'front',  null),
    (16, 'marcus',      'marcus.hale@example.test',   'Marcus', 'Hale',     null, 'back',   null),
    -- Runs the second, empty group.
    (20, 'neworganizer', 'neworganizer@example.test', 'Jamie',  'Hart',     null, null,     null);

  update seed_member
  set user_id = ('d0000000-0000-4000-8000-' || lpad(ord::text, 12, '0'))::uuid
  where ord in (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 20);

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token
  )
  select
    '00000000-0000-0000-0000-000000000000', sm.user_id, 'authenticated', 'authenticated',
    sm.email, extensions.crypt(c_password, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
    '', '', '', '', '', '', '', ''
  from seed_member as sm
  where sm.user_id is not null;

  insert into auth.identities (
    id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
  )
  select
    gen_random_uuid(), sm.user_id, sm.user_id::text, 'email',
    jsonb_build_object('sub', sm.user_id::text, 'email', sm.email, 'email_verified', true),
    now(), now(), now()
  from seed_member as sm
  where sm.user_id is not null;

  ---------------------------------------------------------------------------
  -- The group, its quota rules and its members
  ---------------------------------------------------------------------------
  select user_id into v_org from seed_member where key = 'organizer';

  select created_group_id, administrator_membership_id into v_group, v_org_membership
  from public.bootstrap_organizer(
    v_org, 'Alex', 'Morgan', 'Fairview Saturday Group', c_zone,
    gen_random_uuid(), gen_random_uuid()
  );
  update seed_member set membership_id = v_org_membership where key = 'organizer';

  select settings_version into v_settings_version
  from public.configure_group_quota_rules(
    v_org, 'moving_average', 4, 1, 'half_away_from_zero', '[]'::jsonb, 0,
    'First set-up of the group', gen_random_uuid(), gen_random_uuid(),
    1, '[{"rank":1,"points":10},{"rank":2,"points":6},{"rank":3,"points":3}]'::jsonb, null
  );

  for m in select * from seed_member where ord between 2 and 12 order by ord loop
    select created_membership_id into v_mid
    from public.create_pending_member_profile(
      v_org, m.first_name, m.last_name, null, null, m.tee, true,
      null, null, null, '07700 900' || lpad(m.ord::text, 3, '0'),
      null, null, null, null, null, null,
      false, false, false, true, false,
      null, gen_random_uuid(), gen_random_uuid()
    );
    update seed_member set membership_id = v_mid where ord = m.ord;

    v_inv := gen_random_uuid();
    v_digest := encode(sha256(convert_to(v_inv::text, 'UTF8')), 'hex');
    perform public.issue_membership_invitation(
      v_org, v_mid, v_inv, m.email, v_digest, 1, now() + interval '7 days',
      gen_random_uuid(), gen_random_uuid()
    );
    perform public.accept_membership_invitation(
      m.user_id, v_inv, v_digest, gen_random_uuid(), gen_random_uuid()
    );

    -- Finish joining as the member would on their phone.
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', m.user_id::text, 'role', 'authenticated')::text,
      true
    );
    perform public.complete_mobile_first_run(
      m.first_name, m.last_name, v_terms, v_privacy, gen_random_uuid(), gen_random_uuid()
    );
    perform set_config('request.jwt.claims', '', true);
  end loop;

  v_source := jsonb_build_object(
    'kind', 'initial_quota',
    'method', 'moving_average',
    'precision', 1,
    'rounding_rule', 'half_away_from_zero',
    'history_length', 4,
    'seed_positions', '[]'::jsonb,
    'settings_version', v_settings_version
  );
  for m in select * from seed_member where ord between 1 and 12 order by ord loop
    perform public.configure_membership_quota_bootstrap(
      v_org, m.membership_id, m.quota, true, '[]'::jsonb, true, m.quota, v_source,
      0, v_settings_version, 'Starting quota', gen_random_uuid(), gen_random_uuid()
    );
    if m.handicap is not null then
      perform public.set_member_handicap(
        v_org, m.membership_id, '10' || lpad(m.ord::text, 8, '0'), m.handicap,
        v_today - 45,
        (select version from public.memberships where id = m.membership_id),
        true, 'Handicap at joining', gen_random_uuid(), gen_random_uuid()
      );
    end if;
  end loop;

  select membership_id into v_mid from seed_member where key = 'coordinator';
  perform public.change_member_role(
    v_org, v_mid, 'coordinator',
    (select version from public.memberships where id = v_mid),
    true, 'Helps run the Saturday rounds', gen_random_uuid(), gen_random_uuid()
  );

  ---------------------------------------------------------------------------
  -- Six finished rounds, one a week, oldest first
  ---------------------------------------------------------------------------
  create temp table seed_round (
    seq integer primary key,
    round_id uuid not null,
    tee_at timestamptz not null
  ) on commit drop;

  for k in 1..6 loop
    select d.round_id, d.version into v_round, v_ver
    from public.create_round_draft(
      v_org, 'Saturday points game',
      to_char(v_today + 2 + k, 'YYYY-MM-DD') || 'T08:30',
      c_venues[1 + (k % 3)], null,
      case when k = 6 then 'Winter tees. Meet at the first tee by 08:15.' else null end,
      true, null, 'individual_net', gen_random_uuid(), gen_random_uuid()
    ) as d;

    if k >= 5 then
      select f.version into v_ver
      from public.set_round_draft_score_fields(
        v_org, v_round, true, true, v_ver, gen_random_uuid(), gen_random_uuid()
      ) as f;
    end if;

    select distinct review.review_version, review.review_fingerprint into v_ver, v_fp
    from public.preview_round_publication(v_org, v_round, '{}') as review;
    select p.version into v_ver
    from public.publish_round(v_org, v_round, '{}', v_ver, v_fp, gen_random_uuid(), gen_random_uuid()) as p;

    for part in
      select rp.id, rp.version, sm.key, sm.user_id
      from public.round_participants as rp
      join seed_member as sm on sm.membership_id = rp.membership_id
      where rp.round_id = v_round
      order by sm.ord
    loop
      v_pick := abs(hashtext(part.key || ':rsvp:' || k)) % 10;
      v_status := case
        when part.key = 'organizer' then 'playing'
        when part.key = 'member' then (case when k = 3 then 'not_playing' else 'playing' end)
        when part.key = 'tom' then (case when k <= 3 then 'playing' else 'not_playing' end)
        when v_pick = 0 then 'not_playing'
        when v_pick = 1 then 'no_response'
        else 'playing'
      end;
      if v_status <> 'no_response' then
        perform public.set_round_participant_rsvp(
          part.user_id, v_round, v_status, part.version, 'member_web',
          gen_random_uuid(), gen_random_uuid()
        );
      end if;
    end loop;

    select o.version into v_ver
    from public.open_round_scoring(v_org, v_round, v_ver, true, gen_random_uuid(), gen_random_uuid()) as o;

    for part in
      select rp.id, rp.quota_snapshot, sm.key
      from public.round_participants as rp
      join seed_member as sm on sm.membership_id = rp.membership_id
      where rp.round_id = v_round and rp.rsvp_status = 'playing'
      order by sm.ord
    loop
      v_points := greatest(8, round(part.quota_snapshot) + (abs(hashtext(part.key || ':points:' || k)) % 13) - 6);
      v_fields := jsonb_build_object('golf_points', v_points);
      if k >= 5 then
        v_fields := v_fields || jsonb_build_object(
          'gross_score', 112 - v_points,
          'net_score', 112 - v_points - (36 - round(part.quota_snapshot))
        );
      end if;
      perform public.set_round_participant_score(
        v_org, part.id, v_fields, 0, gen_random_uuid(), 'portal', null,
        clock_timestamp(), gen_random_uuid(), gen_random_uuid()
      );
    end loop;

    perform public.complete_live_round(v_org, v_round, v_ver, true, gen_random_uuid(), gen_random_uuid());

    insert into seed_round (seq, round_id, tee_at)
    values (k, v_round, ((v_last_sat - (6 - k) * 7) + time '08:30') at time zone c_zone);
  end loop;

  ---------------------------------------------------------------------------
  -- A round called off in the week
  ---------------------------------------------------------------------------
  select d.round_id, d.version into v_round, v_ver
  from public.create_round_draft(
    v_org, 'Midweek nine holes', to_char(v_today + 2, 'YYYY-MM-DD') || 'T16:00',
    'Kingsdown Park', null, null, true, null, 'individual_net',
    gen_random_uuid(), gen_random_uuid()
  ) as d;
  select distinct review.review_version, review.review_fingerprint into v_ver, v_fp
  from public.preview_round_publication(v_org, v_round, '{}') as review;
  select p.version into v_ver
  from public.publish_round(v_org, v_round, '{}', v_ver, v_fp, gen_random_uuid(), gen_random_uuid()) as p;
  for part in
    select rp.id, rp.version, sm.user_id
    from public.round_participants as rp
    join seed_member as sm on sm.membership_id = rp.membership_id
    where rp.round_id = v_round and sm.key in ('organizer', 'member', 'dan', 'helen')
  loop
    perform public.set_round_participant_rsvp(
      part.user_id, v_round, 'playing', part.version, 'member_web',
      gen_random_uuid(), gen_random_uuid()
    );
  end loop;
  -- Calling a round off currently fails when two or more people are in it
  -- (cancel_round queues the same e-mail twice). Until that is fixed the round
  -- stays announced, two days out, so the failure is easy to reproduce.
  begin
    perform public.cancel_round(
      v_org, v_round, 'Course closed after heavy rain', v_ver, gen_random_uuid(), gen_random_uuid()
    );
    insert into seed_round (seq, round_id, tee_at)
    values (0, v_round, ((v_last_sat - 3) + time '16:00') at time zone c_zone);
  exception when unique_violation then
    raise notice 'Could not call off "Midweek nine holes" (cancel_round failed); left it announced.';
  end;

  ---------------------------------------------------------------------------
  -- Move those rounds into the past
  ---------------------------------------------------------------------------
  set local session_replication_role = replica;

  for k in 0..6 loop
    select sr.round_id, sr.tee_at into v_round, v_tee from seed_round as sr where sr.seq = k;
    continue when not found;

    update public.rounds
    set scheduled_at = v_tee,
        created_at = v_tee - interval '8 days',
        published_at = v_tee - interval '6 days',
        cancelled_at = case when cancelled_at is null then null else v_tee - interval '5 hours' end,
        updated_at = case when k = 0 then v_tee - interval '5 hours' else v_tee + interval '5 hours' end
    where id = v_round;
    update public.round_rule_snapshots set created_at = v_tee - interval '6 days' where round_id = v_round;
    update public.round_participants
    set created_at = v_tee - interval '6 days', updated_at = v_tee - interval '3 days'
    where round_id = v_round;
    update public.score_revisions
    set created_at = v_tee + interval '4 hours 30 minutes',
        client_changed_at = v_tee + interval '4 hours 30 minutes'
    where round_id = v_round;
    update public.participant_score_projections
    set created_at = v_tee + interval '4 hours 30 minutes',
        updated_at = v_tee + interval '4 hours 30 minutes'
    where round_id = v_round;
    update public.round_completion_runs
    set completed_at = v_tee + interval '5 hours', created_at = v_tee + interval '5 hours'
    where round_id = v_round;
    update public.round_official_results set created_at = v_tee + interval '5 hours' where round_id = v_round;
    update public.membership_quota_history
    set completed_at = v_tee + interval '5 hours', created_at = v_tee + interval '5 hours'
    where round_id = v_round;

    update public.audit_events
    set occurred_at = case
      when action = 'round.draft_created' then v_tee - interval '8 days'
      when action in ('round.completed', 'round.cancelled') then
        case when k = 0 then v_tee - interval '5 hours' else v_tee + interval '5 hours' end
      when action like '%scor%' then v_tee + interval '4 hours'
      when action like '%rsvp%' then v_tee - interval '3 days'
      else v_tee - interval '6 days'
    end
    where group_id = v_group
      and (target_id = v_round or after_state ->> 'round_id' = v_round::text);

    update public.notification_outbox_jobs
    set created_at = case
          when event_type = 'round.published' then v_tee - interval '6 days'
          when k = 0 then v_tee - interval '5 hours'
          when event_type like '%scoring%' then v_tee
          else v_tee + interval '5 hours'
        end,
        updated_at = case
          when event_type = 'round.published' then v_tee - interval '6 days'
          when k = 0 then v_tee - interval '5 hours'
          when event_type like '%scoring%' then v_tee
          else v_tee + interval '5 hours'
        end
    where group_id = v_group
      and (
        aggregate_id = v_round
        or aggregate_id in (select id from public.round_completion_runs where round_id = v_round)
      );
  end loop;

  update public.notification_inbox_items as item
  set created_at = job.created_at, updated_at = job.created_at
  from public.notification_outbox_jobs as job
  where job.id = item.outbox_job_id and item.group_id = v_group;

  update public.membership_quota_projections as projection
  set effective_at = latest.completed_at
  from (
    select membership_id, max(completed_at) as completed_at
    from public.membership_quota_history
    where group_id = v_group
    group by membership_id
  ) as latest
  where latest.membership_id = projection.membership_id;

  set local session_replication_role = origin;

  ---------------------------------------------------------------------------
  -- Tom has stopped playing
  ---------------------------------------------------------------------------
  select membership_id into v_mid from seed_member where key = 'tom';
  perform public.set_member_status(
    v_org, v_mid, 'inactive',
    (select version from public.memberships where id = v_mid),
    true, 'Moved away', gen_random_uuid(), gen_random_uuid()
  );

  ---------------------------------------------------------------------------
  -- Today's round: scoring is open and half the cards are in
  ---------------------------------------------------------------------------
  select d.round_id, d.version into v_round, v_ver
  from public.create_round_draft(
    v_org, 'Saturday points game', to_char(v_today + 2, 'YYYY-MM-DD') || 'T08:30',
    'Fairview Golf Club', null, 'Shotgun start. Cards to Alex in the bar afterwards.',
    true, null, 'individual_net', gen_random_uuid(), gen_random_uuid()
  ) as d;
  select distinct review.review_version, review.review_fingerprint into v_ver, v_fp
  from public.preview_round_publication(v_org, v_round, '{}') as review;
  select p.version into v_ver
  from public.publish_round(v_org, v_round, '{}', v_ver, v_fp, gen_random_uuid(), gen_random_uuid()) as p;
  for part in
    select rp.id, rp.version, sm.key, sm.user_id
    from public.round_participants as rp
    join seed_member as sm on sm.membership_id = rp.membership_id
    where rp.round_id = v_round
    order by sm.ord
  loop
    v_status := case
      when part.key in ('jo', 'grace') then 'not_playing'
      when part.key = 'nick' then 'no_response'
      else 'playing'
    end;
    if v_status <> 'no_response' then
      perform public.set_round_participant_rsvp(
        part.user_id, v_round, v_status, part.version, 'member_web',
        gen_random_uuid(), gen_random_uuid()
      );
    end if;
  end loop;
  select o.version into v_ver
  from public.open_round_scoring(v_org, v_round, v_ver, true, gen_random_uuid(), gen_random_uuid()) as o;
  for part in
    select rp.id, rp.quota_snapshot, sm.key
    from public.round_participants as rp
    join seed_member as sm on sm.membership_id = rp.membership_id
    where rp.round_id = v_round
      and rp.rsvp_status = 'playing'
      and sm.key in ('organizer', 'coordinator', 'dan', 'chris')
  loop
    perform public.set_round_participant_score(
      v_org, part.id,
      jsonb_build_object('golf_points', round(part.quota_snapshot) + (abs(hashtext(part.key || ':live')) % 9) - 4),
      0, gen_random_uuid(), 'portal', null, clock_timestamp(), gen_random_uuid(), gen_random_uuid()
    );
  end loop;
  update public.rounds
  set scheduled_at = (v_today + time '08:30') at time zone c_zone
  where id = v_round;

  ---------------------------------------------------------------------------
  -- Next Saturday: announced, replies coming in
  ---------------------------------------------------------------------------
  v_deadline := ((v_next_sat - 1) + time '18:00') at time zone c_zone;
  v_deadline_local := case
    when v_deadline > now() + interval '1 hour' then to_char(v_next_sat - 1, 'YYYY-MM-DD') || 'T18:00'
    else null
  end;
  select d.round_id, d.version into v_round, v_ver
  from public.create_round_draft(
    v_org, 'Saturday points game', to_char(v_next_sat, 'YYYY-MM-DD') || 'T08:30',
    'Ashby Heath', 'https://example.com/ashby-heath',
    'First tee time 08:30. Buggies need booking with the pro shop.',
    true, v_deadline_local, 'individual_net', gen_random_uuid(), gen_random_uuid()
  ) as d;
  select distinct review.review_version, review.review_fingerprint into v_ver, v_fp
  from public.preview_round_publication(v_org, v_round, '{}') as review;
  select p.version into v_ver
  from public.publish_round(v_org, v_round, '{}', v_ver, v_fp, gen_random_uuid(), gen_random_uuid()) as p;
  for part in
    select rp.id, rp.version, sm.key, sm.user_id
    from public.round_participants as rp
    join seed_member as sm on sm.membership_id = rp.membership_id
    where rp.round_id = v_round
    order by sm.ord
  loop
    v_status := case
      when part.key in ('organizer', 'coordinator', 'dan', 'chris', 'helen') then 'playing'
      when part.key in ('maria', 'rob') then 'not_playing'
      else 'no_response'
    end;
    if v_status <> 'no_response' then
      perform public.set_round_participant_rsvp(
        part.user_id, v_round, v_status, part.version, 'member_web',
        gen_random_uuid(), gen_random_uuid()
      );
    end if;
  end loop;
  perform public.post_round_announcement(
    v_org, v_round,
    'Ashby Heath have moved us to the back nine first. Same start time, meet at the 10th tee.',
    gen_random_uuid(), gen_random_uuid()
  );
  perform public.post_round_message(
    (select user_id from seed_member where key = 'dan'), v_round,
    'Anyone want to share a buggy? I can drive.', gen_random_uuid(), gen_random_uuid()
  );
  perform public.post_round_message(
    (select user_id from seed_member where key = 'helen'), v_round,
    'Yes please, Dan. See you at the 10th.', gen_random_uuid(), gen_random_uuid()
  );

  ---------------------------------------------------------------------------
  -- Two rounds still being planned
  ---------------------------------------------------------------------------
  select d.round_id, d.version into v_round, v_ver
  from public.create_round_draft(
    v_org, 'Saturday points game', to_char(v_next_sat + 7, 'YYYY-MM-DD') || 'T08:30',
    'Kingsdown Park', null, null, true, null, 'individual_net',
    gen_random_uuid(), gen_random_uuid()
  ) as d;
  perform public.set_round_draft_score_fields(
    v_org, v_round, true, false, v_ver, gen_random_uuid(), gen_random_uuid()
  );
  perform public.create_round_draft(
    v_org, 'Captain''s Day', null, null, null, 'Date to be agreed with the club.',
    false, null, 'individual_net', gen_random_uuid(), gen_random_uuid()
  );

  ---------------------------------------------------------------------------
  -- People who have not joined yet
  ---------------------------------------------------------------------------
  for m in select * from seed_member where ord between 13 and 16 order by ord loop
    select created_membership_id into v_mid
    from public.create_pending_member_profile(
      v_org, m.first_name, m.last_name, null, null, m.tee, m.key = 'liam',
      null, null, null, null, null, null, null, null, null, null,
      false, false, false, false, false,
      null, gen_random_uuid(), gen_random_uuid()
    );
    update seed_member set membership_id = v_mid where ord = m.ord;

    if m.email is not null then
      v_inv := gen_random_uuid();
      v_digest := encode(sha256(convert_to(v_inv::text, 'UTF8')), 'hex');
      perform public.issue_membership_invitation(
        v_org, v_mid, v_inv, m.email, v_digest, 1, now() + interval '7 days',
        gen_random_uuid(), gen_random_uuid()
      );
      if m.key = 'newmember' then
        perform public.accept_membership_invitation(
          m.user_id, v_inv, v_digest, gen_random_uuid(), gen_random_uuid()
        );
      elsif m.key = 'marcus' then
        perform public.revoke_membership_invitation(
          v_org, v_inv, 'Wrong e-mail address', gen_random_uuid(), gen_random_uuid()
        );
      end if;
    end if;
  end loop;

  ---------------------------------------------------------------------------
  -- News
  ---------------------------------------------------------------------------
  perform public.save_group_news(
    v_org, null, 'Winter rules from this Saturday',
    'Preferred lies on closely mown areas until further notice. Place within six inches, no nearer the hole.',
    'published', now() - interval '2 days', gen_random_uuid(), gen_random_uuid()
  );
  perform public.save_group_news(
    v_org, null, 'Subs are due',
    'Thank you to everyone who has paid. If you have not, please see Priya before the next round.',
    'published', now() - interval '16 days', gen_random_uuid(), gen_random_uuid()
  );
  perform public.save_group_news(
    v_org, null, 'Christmas lunch',
    'Pencilled in for the Saturday before Christmas. Menu to follow.',
    'draft', null, gen_random_uuid(), gen_random_uuid()
  );

  ---------------------------------------------------------------------------
  -- A second group with nothing in it yet
  ---------------------------------------------------------------------------
  perform public.bootstrap_organizer(
    (select user_id from seed_member where key = 'neworganizer'),
    'Jamie', 'Hart', 'Hillside Sunday Society', c_zone,
    gen_random_uuid(), gen_random_uuid()
  );

  raise notice 'Demo data loaded. Sign in as organizer@example.test or member@example.test, password %.', c_password;
end;
$seed$;
