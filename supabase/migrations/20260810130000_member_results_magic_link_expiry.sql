-- Keep retry-stable member result links bounded by the Supabase Auth OTP
-- lifetime.  A delivery may rotate its stored token only after the previous
-- token's expiry; the provider idempotency key is versioned by issuance time.

alter table public.notification_deliveries
  add column member_magic_link_token_issued_at timestamptz,
  add column member_magic_link_token_expires_at timestamptz;

alter table public.notification_deliveries
  add constraint notification_deliveries_member_magic_link_expiry_valid
  check (
    (member_magic_link_token_hash is null
      and member_magic_link_token_issued_at is null
      and member_magic_link_token_expires_at is null)
    or (
      member_magic_link_token_hash is not null
      and member_magic_link_token_issued_at is not null
      and member_magic_link_token_expires_at is not null
      and member_magic_link_token_expires_at > member_magic_link_token_issued_at
      and member_magic_link_token_expires_at <= member_magic_link_token_issued_at + interval '1 hour'
    )
  );

create or replace function app.clear_member_magic_link_on_terminal()
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
    new.member_magic_link_token_issued_at := null;
    new.member_magic_link_token_expires_at := null;
  end if;
  return new;
end;
$$;
revoke all on function app.clear_member_magic_link_on_terminal()
from public, anon, authenticated, service_role;

drop function if exists public.read_results_member_magic_link(uuid, uuid);
create function public.read_results_member_magic_link(
  p_delivery_id uuid,
  p_claim_token uuid
)
returns table (
  recipient_user_id uuid,
  token_hash text,
  token_issued_at timestamptz,
  token_expires_at timestamptz
)
language sql
security definer
set search_path = ''
as $$
  select membership.user_id,
    delivery.member_magic_link_token_hash,
    delivery.member_magic_link_token_issued_at,
    delivery.member_magic_link_token_expires_at
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
from public, anon, authenticated, service_role;
grant execute on function public.read_results_member_magic_link(uuid, uuid)
to service_role;

drop function if exists public.store_results_member_magic_link(uuid, uuid, uuid, text);
create function public.store_results_member_magic_link(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_recipient_user_id uuid,
  p_token_hash text,
  p_token_issued_at timestamptz,
  p_token_expires_at timestamptz
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
    or p_token_issued_at is null
    or p_token_expires_at is null
    or p_token_expires_at <= p_token_issued_at
    or p_token_expires_at > p_token_issued_at + interval '1 hour'
  then
    raise exception 'member_magic_link_context_invalid' using errcode = '22023';
  end if;

  update public.notification_deliveries as delivery
  set member_magic_link_token_hash = p_token_hash,
    member_magic_link_token_issued_at = p_token_issued_at,
    member_magic_link_token_expires_at = p_token_expires_at
  where delivery.id = p_delivery_id
    and delivery.claim_token = p_claim_token
    and delivery.state = 'sending'::public.notification_delivery_state
    and delivery.channel = 'email'::public.notification_channel
    and (
      delivery.member_magic_link_token_hash is null
      or delivery.member_magic_link_token_expires_at <= pg_catalog.clock_timestamp()
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
revoke all on function public.store_results_member_magic_link(uuid, uuid, uuid, text, timestamptz, timestamptz)
from public, anon, authenticated;
grant execute on function public.store_results_member_magic_link(uuid, uuid, uuid, text, timestamptz, timestamptz)
to service_role;
