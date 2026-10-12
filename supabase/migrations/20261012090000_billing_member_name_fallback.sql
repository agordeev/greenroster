-- The billing member list read names only from the golfer profile, so an
-- administrator who has not filled one in yet was listed without a name.
-- Fall back to the account profile, the same way the member roster does.
create or replace function public.read_billing_member_entitlements(p_actor_user_id uuid)
returns table (
  membership_id app.entity_id,
  first_name text,
  last_name text,
  status public.billing_entitlement_status,
  starts_at app.utc_instant,
  expires_at app.utc_instant,
  source text,
  reason text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_group_id uuid;
begin
  select membership.group_id into actor_group_id
  from public.memberships as membership
  where membership.user_id = p_actor_user_id
    and membership.status = 'active'
    and membership.role = 'administrator';
  if actor_group_id is null then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;
  return query
  select entitlement.membership_id,
    coalesce(golfer.first_name, profile.first_name),
    coalesce(golfer.last_name, profile.last_name),
    case when entitlement.expires_at is not null and entitlement.expires_at <= pg_catalog.clock_timestamp()
      then 'expired'::public.billing_entitlement_status else entitlement.status end,
    entitlement.starts_at,
    entitlement.expires_at,
    entitlement.source,
    entitlement.reason
  from public.membership_billing_entitlements as entitlement
  join public.memberships as membership
    on membership.id = entitlement.membership_id and membership.group_id = entitlement.group_id
  left join public.membership_golfer_profiles as golfer
    on golfer.membership_id = membership.id and golfer.group_id = membership.group_id
  left join public.user_profiles as profile
    on profile.user_id = membership.user_id
  where entitlement.group_id = actor_group_id
    and membership.status = 'active'
  order by coalesce(golfer.last_name, profile.last_name) nulls last,
    coalesce(golfer.first_name, profile.first_name) nulls last,
    entitlement.membership_id;
end;
$$;
