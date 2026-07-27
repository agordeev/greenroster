-- Phase 02: expose the authoritative address-level actionability flag alongside
-- the latest invitation delivery state. A complaint or hard bounce can arrive
-- after a delivery was marked sent, so the latest delivery row alone is not a
-- safe actionability signal. The suppression reason itself stays private.

drop function public.list_manageable_membership_invitations(uuid);

create function public.list_manageable_membership_invitations(p_actor_user_id uuid)
returns table (
  invitation_id app.entity_id,
  membership_id app.entity_id,
  member_first_name text,
  member_last_name text,
  invited_email text,
  status public.membership_invitation_status,
  expires_at app.utc_instant,
  invitation_version bigint,
  delivery_state public.notification_delivery_state,
  delivery_failure_reason text,
  delivery_action_required boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.statement_timestamp();
  actor_group_id uuid;
begin
  if p_actor_user_id is null then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  select actor.group_id
  into actor_group_id
  from public.memberships as actor
  join public.user_profiles as profile on profile.user_id = actor.user_id
  join auth.users as identity on identity.id = actor.user_id
  where actor.user_id = p_actor_user_id
    and actor.status = 'active'
    and actor.role in ('coordinator', 'administrator')
    and profile.disabled_at is null
    and identity.email_confirmed_at is not null
    and identity.deleted_at is null
    and not identity.is_anonymous
    and (identity.banned_until is null or identity.banned_until <= v_now);

  if not found then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  return query
  select
    invitation.id,
    invitation.membership_id,
    golfer.first_name,
    golfer.last_name,
    invitation.invited_email,
    case
      when invitation.expires_at <= v_now
        then 'expired'::public.membership_invitation_status
      else invitation.status
    end,
    invitation.expires_at,
    invitation.version,
    delivery.state,
    delivery.failure_reason,
    (
      coalesce(delivery.state in ('failed_permanent', 'suppressed'), false)
      or suppression.normalized_address is not null
    )
  from public.membership_invitations as invitation
  join public.membership_golfer_profiles as golfer
    on golfer.membership_id = invitation.membership_id
    and golfer.group_id = invitation.group_id
  left join public.email_suppressions as suppression
    on suppression.normalized_address = invitation.invited_email_normalized
  left join lateral (
    select candidate.state, candidate.failure_reason
    from public.notification_outbox_jobs as outbox
    join public.notification_deliveries as candidate
      on candidate.outbox_job_id = outbox.id
      and candidate.group_id = outbox.group_id
    where outbox.group_id = invitation.group_id
      and outbox.aggregate_type = 'membership_invitation'
      and outbox.aggregate_id = invitation.id
      and candidate.recipient_membership_id = invitation.membership_id
      and candidate.channel = 'email'
    order by candidate.created_at desc, candidate.id desc
    limit 1
  ) as delivery on true
  where invitation.group_id = actor_group_id
    and invitation.status = 'pending'
  order by golfer.last_name, golfer.first_name, invitation.id;
end;
$$;

comment on function public.list_manageable_membership_invitations(uuid) is
  'Service-only coordinator/administrator projection of current pending invitations, latest delivery state, and an authoritative address-level action-required flag for the actor tenant. Suppression reasons remain private.';

revoke all on function public.list_manageable_membership_invitations(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.list_manageable_membership_invitations(uuid)
to service_role;
