grant select (id, user_id) on table public.memberships to service_role;
grant select (user_id, disabled_at) on table public.user_profiles to service_role;

comment on table public.memberships is
  'Tenant memberships. The service role has column-scoped read access only for server-side identity affiliation checks.';
comment on table public.user_profiles is
  'Application identity profiles. The service role has column-scoped read access only for server-side identity affiliation checks.';
