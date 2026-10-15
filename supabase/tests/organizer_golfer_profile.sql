begin;

create extension if not exists pgtap with schema extensions;

select plan(7);

insert into app.current_legal_documents (singleton, terms_version, privacy_version)
values (true, 'synthetic-terms-v1', 'synthetic-privacy-v1')
on conflict (singleton) do update
set terms_version = excluded.terms_version,
    privacy_version = excluded.privacy_version;

insert into auth.users (id, email, email_confirmed_at, is_sso_user, is_anonymous, created_at, updated_at)
values (
  '1c000000-0000-4000-8000-000000000001', 'organizer-golfer-profile@example.test',
  now(), false, false, now(), now()
);

create temporary table organizer_signup as
select * from public.bootstrap_organizer(
  '1c000000-0000-4000-8000-000000000001', '  Olive ', ' Organizer ',
  'Organizer Profile Group', 'UTC',
  '2c000000-0000-4000-8000-000000000001', '3c000000-0000-4000-8000-000000000001'
);

select is(
  (select first_name || ' ' || last_name
   from public.membership_golfer_profiles
   where membership_id = (select administrator_membership_id from organizer_signup)),
  'Olive Organizer',
  'organizer signup writes a golfer profile from the signup names'
);
select is(
  (select group_id from public.membership_golfer_profiles
   where membership_id = (select administrator_membership_id from organizer_signup)),
  (select created_group_id from organizer_signup),
  'the organizer golfer profile belongs to the new group'
);

select lives_ok(
  $$ select * from public.bootstrap_organizer(
    '1c000000-0000-4000-8000-000000000001', 'Olive', 'Organizer',
    'Organizer Profile Group', 'UTC',
    '2c000000-0000-4000-8000-000000000002', '3c000000-0000-4000-8000-000000000001'
  ) $$,
  'replaying organizer signup does not write a second golfer profile'
);

create temporary table organizer_draft as
select * from public.create_round_draft(
  '1c000000-0000-4000-8000-000000000001', 'Organizer first round', '2026-10-20T09:00',
  null, null, null, true, null, 'individual_gross',
  '2c000000-0000-4000-8000-000000000003', '3c000000-0000-4000-8000-000000000003'
);

create temporary table organizer_preview as
select * from public.preview_round_publication(
  '1c000000-0000-4000-8000-000000000001',
  (select round_id from organizer_draft), '{}'
);
select is(
  (select first_name || ' ' || last_name from organizer_preview),
  'Olive Organizer',
  'publication review names the organizer'
);
select is(
  (select eligibility_state from organizer_preview),
  'eligible',
  'the organizer can be invited to their own round'
);

delete from public.membership_golfer_profiles
where membership_id = (select administrator_membership_id from organizer_signup);

create temporary table fallback_preview as
select * from public.preview_round_publication(
  '1c000000-0000-4000-8000-000000000001',
  (select round_id from organizer_draft), '{}'
);
select is(
  (select first_name || ' ' || last_name from fallback_preview),
  'Olive Organizer',
  'publication review falls back to the account name without a golfer profile'
);
select is(
  (select ineligibility_reason from fallback_preview),
  'profile_missing',
  'a member without a golfer profile still cannot be invited'
);

select * from finish();

rollback;
