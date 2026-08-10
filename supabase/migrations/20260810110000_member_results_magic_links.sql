-- Phase 07: stable, service-only member-results magic-link material.
--
-- Supabase Admin generateLink returns a one-time hashed token.  The trusted
-- results worker stores that hash only while the delivery is retryable so an
-- ambiguous provider response cannot send a different link under the same
-- provider idempotency key.  The hash is cleared when the delivery reaches a
-- terminal state.

alter table public.notification_deliveries
  add column member_magic_link_token_hash text;

alter table public.notification_deliveries
  add constraint notification_deliveries_member_magic_link_hash_valid
  check (
    member_magic_link_token_hash is null
    or (
      pg_catalog.length(member_magic_link_token_hash) between 16 and 512
      and member_magic_link_token_hash !~ '[[:space:]]'
    )
  );

create function app.clear_member_magic_link_on_terminal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.state in (
    'sent'::public.notification_delivery_state,
    'failed_permanent'::public.notification_delivery_state,
    'suppressed'::public.notification_delivery_state,
    'cancelled'::public.notification_delivery_state
  ) then
    new.member_magic_link_token_hash := null;
  end if;
  return new;
end;
$$;

revoke all on function app.clear_member_magic_link_on_terminal()
from public, anon, authenticated, service_role;

create trigger notification_deliveries_clear_member_magic_link
before update of state, member_magic_link_token_hash
on public.notification_deliveries
for each row execute function app.clear_member_magic_link_on_terminal();

create function public.read_results_member_magic_link(
  p_delivery_id uuid,
  p_claim_token uuid
)
returns table (recipient_user_id uuid, token_hash text)
language sql
security definer
set search_path = ''
as $$
  select membership.user_id, delivery.member_magic_link_token_hash
  from public.notification_deliveries as delivery
  join public.memberships as membership
    on membership.id = delivery.recipient_membership_id
   and membership.group_id = delivery.group_id
   and membership.status = 'active'::public.membership_status
  join auth.users as identity
    on identity.id = membership.user_id
   and identity.email_confirmed_at is not null
   and identity.deleted_at is null
   and not identity.is_anonymous
  where delivery.id = p_delivery_id
    and delivery.claim_token = p_claim_token
    and delivery.state = 'sending'::public.notification_delivery_state
    and delivery.channel = 'email'::public.notification_channel;
$$;

revoke all on function public.read_results_member_magic_link(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.read_results_member_magic_link(uuid, uuid)
to service_role;

create function public.store_results_member_magic_link(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_recipient_user_id uuid,
  p_token_hash text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_delivery_id is null
    or p_claim_token is null
    or p_recipient_user_id is null
    or p_token_hash is null
    or pg_catalog.length(p_token_hash) not between 16 and 512
    or p_token_hash ~ '[[:space:]]'
  then
    raise exception 'member_magic_link_context_invalid' using errcode = '22023';
  end if;

  update public.notification_deliveries as delivery
  set member_magic_link_token_hash = p_token_hash
  where delivery.id = p_delivery_id
    and delivery.claim_token = p_claim_token
    and delivery.state = 'sending'::public.notification_delivery_state
    and delivery.channel = 'email'::public.notification_channel
    and (
      delivery.member_magic_link_token_hash is null
      or delivery.member_magic_link_token_hash = p_token_hash
    )
    and exists (
      select 1
      from public.memberships as membership
      join auth.users as identity on identity.id = membership.user_id
      where membership.id = delivery.recipient_membership_id
        and membership.group_id = delivery.group_id
        and membership.user_id = p_recipient_user_id
        and membership.status = 'active'::public.membership_status
        and identity.email_confirmed_at is not null
        and identity.deleted_at is null
        and not identity.is_anonymous
    );

  if not found then
    raise exception 'member_magic_link_claim_invalid' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.store_results_member_magic_link(uuid, uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.store_results_member_magic_link(uuid, uuid, uuid, text)
to service_role;

comment on column public.notification_deliveries.member_magic_link_token_hash is
  'Service-only Supabase magic-link token hash retained only while this results e-mail can retry.';
