create function public.resolve_group_onboarding()
returns table (
  group_profile_complete boolean,
  additional_membership_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    pg_catalog.btrim(group_record.name) <> ''
      and group_record.time_zone is not null as group_profile_complete,
    count(membership.id) filter (
      where membership.user_id is distinct from (select auth.uid())
    ) as additional_membership_count
  from public.groups as group_record
  left join public.memberships as membership
    on membership.group_id = group_record.id
  where group_record.id = (select app.active_group_id())
    and (select app.active_membership_role()) in ('coordinator', 'administrator')
  group by group_record.id, group_record.name, group_record.time_zone;
$$;

comment on function public.resolve_group_onboarding() is
  'Returns only Phase 01 onboarding facts derived from the authenticated coordinator or administrator group. Later phases extend the projection from their authoritative records.';

revoke all on function public.resolve_group_onboarding() from public, anon;
grant execute on function public.resolve_group_onboarding() to authenticated;
