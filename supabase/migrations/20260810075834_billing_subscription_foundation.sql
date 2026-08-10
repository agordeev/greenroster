-- Commercial parity foundation: a group trial, Stripe-normalized subscription
-- state, member entitlements, and an append-only webhook ledger.  Commercial
-- pricing and seat rules stay in Stripe configuration until OD-18--OD-21 are
-- approved; no client can assert entitlement or subscription state.

create type public.billing_subscription_status as enum (
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'incomplete',
  'incomplete_expired',
  'paused',
  'expired'
);

create type public.billing_entitlement_status as enum (
  'active',
  'grace',
  'expired',
  'revoked'
);

create type public.billing_event_state as enum (
  'received',
  'processed',
  'ignored',
  'failed'
);

create type public.billing_invoice_status as enum (
  'draft',
  'open',
  'paid',
  'uncollectible',
  'void',
  'unknown'
);

create type public.billing_checkout_kind as enum ('checkout', 'portal');
create type public.billing_checkout_state as enum ('processing', 'succeeded', 'failed');

create table public.billing_accounts (
  group_id app.entity_id primary key references public.groups (id) on delete cascade,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  stripe_price_id text,
  plan_name text,
  plan_interval text,
  plan_amount_minor bigint,
  plan_currency text,
  subscription_status public.billing_subscription_status not null default 'expired',
  trial_started_at app.utc_instant,
  trial_ends_at app.utc_instant,
  current_period_start app.utc_instant,
  current_period_end app.utc_instant,
  next_invoice_at app.utc_instant,
  payment_action_required boolean not null default false,
  last_stripe_event_created_at app.utc_instant,
  last_stripe_event_id text,
  version bigint not null default 1,
  created_at app.utc_instant not null default pg_catalog.now(),
  updated_at app.utc_instant not null default pg_catalog.now(),
  constraint billing_accounts_customer_id_valid check (
    stripe_customer_id is null or pg_catalog.btrim(stripe_customer_id) <> ''
  ),
  constraint billing_accounts_subscription_id_valid check (
    stripe_subscription_id is null or pg_catalog.btrim(stripe_subscription_id) <> ''
  ),
  constraint billing_accounts_price_id_valid check (
    stripe_price_id is null or pg_catalog.btrim(stripe_price_id) <> ''
  ),
  constraint billing_accounts_plan_interval_valid check (
    plan_interval is null or plan_interval in ('day', 'week', 'month', 'year')
  ),
  constraint billing_accounts_amount_valid check (plan_amount_minor is null or plan_amount_minor >= 0),
  constraint billing_accounts_currency_valid check (
    plan_currency is null or plan_currency ~ '^[a-z]{3}$'
  ),
  constraint billing_accounts_trial_order check (
    trial_ends_at is null or trial_started_at is not null and trial_ends_at > trial_started_at
  ),
  constraint billing_accounts_period_order check (
    current_period_end is null or current_period_start is not null and current_period_end >= current_period_start
  ),
  constraint billing_accounts_version_positive check (version > 0)
);

create trigger billing_accounts_immutable_group
before update of group_id on public.billing_accounts
for each row execute function app.reject_id_change('group_id');
create trigger billing_accounts_set_updated_at
before update on public.billing_accounts
for each row execute function app.set_updated_at();

create table public.billing_events (
  stripe_event_id text primary key,
  group_id app.entity_id references public.groups (id) on delete cascade,
  event_type text not null,
  stripe_created_at app.utc_instant not null,
  payload jsonb not null,
  state public.billing_event_state not null default 'received',
  attempts integer not null default 0,
  safe_error text,
  received_at app.utc_instant not null default pg_catalog.now(),
  processed_at app.utc_instant,
  updated_at app.utc_instant not null default pg_catalog.now(),
  constraint billing_events_id_valid check (stripe_event_id ~ '^evt_[A-Za-z0-9_-]+$'),
  constraint billing_events_type_valid check (pg_catalog.btrim(event_type) <> ''),
  constraint billing_events_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint billing_events_payload_bounded check (pg_catalog.length(payload::text) <= 2000000),
  constraint billing_events_attempts_nonnegative check (attempts >= 0),
  constraint billing_events_error_bounded check (safe_error is null or pg_catalog.length(safe_error) <= 2000),
  constraint billing_events_processed_state_consistent check (
    processed_at is null or state in ('processed', 'ignored', 'failed')
  )
);

create index billing_events_group_created_idx on public.billing_events (group_id, stripe_created_at desc);
create index billing_events_state_idx on public.billing_events (state, received_at);
create trigger billing_events_set_updated_at
before update on public.billing_events
for each row execute function app.set_updated_at();

create table public.billing_invoices (
  id app.entity_id primary key default pg_catalog.gen_random_uuid(),
  group_id app.entity_id not null references public.groups (id) on delete cascade,
  stripe_invoice_id text not null unique,
  stripe_subscription_id text,
  stripe_event_id text references public.billing_events (stripe_event_id) on delete restrict,
  status public.billing_invoice_status not null default 'unknown',
  amount_due_minor bigint,
  amount_paid_minor bigint,
  currency text,
  hosted_invoice_url text,
  invoice_pdf_url text,
  period_start app.utc_instant,
  period_end app.utc_instant,
  due_at app.utc_instant,
  paid_at app.utc_instant,
  created_at app.utc_instant not null default pg_catalog.now(),
  updated_at app.utc_instant not null default pg_catalog.now(),
  constraint billing_invoices_id_valid check (pg_catalog.btrim(stripe_invoice_id) <> ''),
  constraint billing_invoices_amount_due_valid check (amount_due_minor is null or amount_due_minor >= 0),
  constraint billing_invoices_amount_paid_valid check (amount_paid_minor is null or amount_paid_minor >= 0),
  constraint billing_invoices_currency_valid check (currency is null or currency ~ '^[a-z]{3}$'),
  constraint billing_invoices_period_order check (
    period_end is null or period_start is not null and period_end >= period_start
  )
);

create index billing_invoices_group_created_idx on public.billing_invoices (group_id, created_at desc);
create trigger billing_invoices_immutable_id
before update of id on public.billing_invoices
for each row execute function app.reject_id_change('id');
create trigger billing_invoices_immutable_group
before update of group_id on public.billing_invoices
for each row execute function app.reject_id_change('group_id');
create trigger billing_invoices_set_updated_at
before update on public.billing_invoices
for each row execute function app.set_updated_at();

create table public.membership_billing_entitlements (
  membership_id app.entity_id primary key,
  group_id app.entity_id not null references public.groups (id) on delete cascade,
  status public.billing_entitlement_status not null default 'expired',
  starts_at app.utc_instant,
  expires_at app.utc_instant,
  source text not null default 'trial',
  source_event_id text references public.billing_events (stripe_event_id) on delete restrict,
  reason text,
  version bigint not null default 1,
  updated_at app.utc_instant not null default pg_catalog.now(),
  constraint membership_billing_entitlements_id_group_unique unique (membership_id, group_id),
  constraint membership_billing_entitlements_membership_group_fk
    foreign key (membership_id, group_id)
    references public.memberships (id, group_id)
    on delete cascade,
  constraint membership_billing_entitlements_source_valid check (pg_catalog.btrim(source) <> ''),
  constraint membership_billing_entitlements_version_positive check (version > 0),
  constraint membership_billing_entitlements_reason_bounded check (reason is null or pg_catalog.length(reason) <= 1000)
);

create index membership_billing_entitlements_group_status_idx
on public.membership_billing_entitlements (group_id, status, expires_at);

create trigger membership_billing_entitlements_immutable_membership
before update of membership_id on public.membership_billing_entitlements
for each row execute function app.reject_id_change('membership_id');
create trigger membership_billing_entitlements_immutable_group
before update of group_id on public.membership_billing_entitlements
for each row execute function app.reject_id_change('group_id');
create trigger membership_billing_entitlements_set_updated_at
before update on public.membership_billing_entitlements
for each row execute function app.set_updated_at();

create table public.billing_checkout_sessions (
  id app.entity_id primary key default pg_catalog.gen_random_uuid(),
  group_id app.entity_id not null references public.groups (id) on delete cascade,
  actor_user_id app.entity_id not null references auth.users (id) on delete restrict,
  operation_id uuid not null,
  kind public.billing_checkout_kind not null,
  stripe_session_id text,
  stripe_session_url text,
  state public.billing_checkout_state not null default 'processing',
  safe_error text,
  created_at app.utc_instant not null default pg_catalog.now(),
  updated_at app.utc_instant not null default pg_catalog.now(),
  completed_at app.utc_instant,
  constraint billing_checkout_sessions_operation_unique unique (actor_user_id, operation_id),
  constraint billing_checkout_sessions_error_bounded check (safe_error is null or pg_catalog.length(safe_error) <= 2000),
  constraint billing_checkout_sessions_finished_consistent check (
    completed_at is null or state in ('succeeded', 'failed')
  )
);

create index billing_checkout_sessions_group_created_idx
on public.billing_checkout_sessions (group_id, created_at desc);
create trigger billing_checkout_sessions_immutable_id
before update of id on public.billing_checkout_sessions
for each row execute function app.reject_id_change('id');
create trigger billing_checkout_sessions_immutable_group
before update of group_id on public.billing_checkout_sessions
for each row execute function app.reject_id_change('group_id');
create trigger billing_checkout_sessions_set_updated_at
before update on public.billing_checkout_sessions
for each row execute function app.set_updated_at();

alter table public.billing_accounts enable row level security;
alter table public.billing_accounts force row level security;
alter table public.billing_events enable row level security;
alter table public.billing_events force row level security;
alter table public.billing_invoices enable row level security;
alter table public.billing_invoices force row level security;
alter table public.membership_billing_entitlements enable row level security;
alter table public.membership_billing_entitlements force row level security;
alter table public.billing_checkout_sessions enable row level security;
alter table public.billing_checkout_sessions force row level security;

revoke all on table
  public.billing_accounts,
  public.billing_events,
  public.billing_invoices,
  public.membership_billing_entitlements,
  public.billing_checkout_sessions
from public, anon, authenticated;

grant select on table
  public.billing_accounts,
  public.billing_events,
  public.billing_invoices,
  public.membership_billing_entitlements,
  public.billing_checkout_sessions
to authenticated;
grant all on table
  public.billing_accounts,
  public.billing_events,
  public.billing_invoices,
  public.membership_billing_entitlements,
  public.billing_checkout_sessions
to service_role;

create policy billing_accounts_admin_read
on public.billing_accounts for select to authenticated
using (
  group_id = (select app.active_group_id())
  and (select app.active_membership_role()) = 'administrator'
);

create policy billing_events_admin_read
on public.billing_events for select to authenticated
using (
  group_id = (select app.active_group_id())
  and (select app.active_membership_role()) = 'administrator'
);

create policy billing_invoices_admin_read
on public.billing_invoices for select to authenticated
using (
  group_id = (select app.active_group_id())
  and (select app.active_membership_role()) = 'administrator'
);

create policy membership_billing_entitlements_read
on public.membership_billing_entitlements for select to authenticated
using (
  group_id = (select app.active_group_id())
  and (
    (select app.active_membership_role()) = 'administrator'
    or membership_id in (
      select context.membership_id
      from public.resolve_identity_context() as context
      where context.group_id = (select app.active_group_id())
    )
  )
);

create policy billing_checkout_sessions_admin_read
on public.billing_checkout_sessions for select to authenticated
using (
  group_id = (select app.active_group_id())
  and actor_user_id = (select auth.uid())
  and (select app.active_membership_role()) = 'administrator'
);

comment on table public.billing_accounts is
  'Server-normalized commercial state for one tenant. Price and subscription identifiers originate in Stripe or approved manual support work.';
comment on table public.billing_events is
  'Append-only Stripe event ledger. The event is persisted before its normalized subscription or entitlement projection is changed.';
comment on table public.membership_billing_entitlements is
  'Current server-authoritative member restriction state. Guests never receive an entitlement row.';

create function app.billing_account_is_entitled(
  p_group_id uuid,
  p_at timestamptz default pg_catalog.clock_timestamp()
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.billing_accounts as account
    where account.group_id = p_group_id
      and (
        (account.subscription_status = 'trialing' and account.trial_ends_at > p_at)
        or account.subscription_status in ('active', 'past_due', 'unpaid', 'paused')
          and (account.current_period_end is null or account.current_period_end > p_at)
      )
  );
$$;

create function app.billing_membership_is_entitled(
  p_membership_id uuid,
  p_group_id uuid,
  p_at timestamptz default pg_catalog.clock_timestamp()
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.membership_billing_entitlements as entitlement
    where entitlement.membership_id = p_membership_id
      and entitlement.group_id = p_group_id
      and entitlement.status in ('active', 'grace')
      and (entitlement.expires_at is null or entitlement.expires_at > p_at)
  );
$$;

revoke all on function app.billing_account_is_entitled(uuid, timestamptz) from public, anon, authenticated;
revoke all on function app.billing_membership_is_entitled(uuid, uuid, timestamptz) from public, anon, authenticated;

create function app.ensure_billing_account_for_group()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.billing_accounts (
    group_id,
    subscription_status,
    trial_started_at,
    trial_ends_at
  )
  values (
    new.id,
    'trialing',
    new.created_at,
    new.created_at + interval '30 days'
  )
  on conflict (group_id) do nothing;
  return new;
end;
$$;

revoke all on function app.ensure_billing_account_for_group() from public, anon, authenticated;
create trigger groups_create_billing_account
after insert on public.groups
for each row execute function app.ensure_billing_account_for_group();

create function app.ensure_billing_entitlement_for_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  account public.billing_accounts%rowtype;
begin
  if new.status <> 'active' then
    return new;
  end if;

  select * into account
  from public.billing_accounts
  where group_id = new.group_id
  for update;

  if found and account.subscription_status = 'trialing' and account.trial_ends_at > pg_catalog.clock_timestamp() then
    insert into public.membership_billing_entitlements (
      membership_id, group_id, status, starts_at, expires_at, source, reason
    )
    values (
      new.id, new.group_id, 'active', account.trial_started_at, account.trial_ends_at,
      'trial', '30-day group trial'
    )
    on conflict (membership_id) do nothing;
  else
    insert into public.membership_billing_entitlements (membership_id, group_id, status, source, reason)
    values (new.id, new.group_id, 'expired', 'trial', 'The group trial has ended')
    on conflict (membership_id) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function app.ensure_billing_entitlement_for_membership() from public, anon, authenticated;
create trigger memberships_create_billing_entitlement
after insert or update of status on public.memberships
for each row execute function app.ensure_billing_entitlement_for_membership();

create function app.enforce_member_billing_entitlement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.membership_id is not null
    and exists (
      select 1
      from public.memberships as membership
      where membership.id = new.membership_id
        and membership.group_id = new.group_id
        and membership.status = 'active'
    )
    and not app.billing_membership_is_entitled(new.membership_id, new.group_id, pg_catalog.clock_timestamp())
  then
    raise exception 'membership_subscription_required'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function app.enforce_member_billing_entitlement() from public, anon, authenticated;
create trigger round_participants_require_billing_entitlement
before insert on public.round_participants
for each row execute function app.enforce_member_billing_entitlement();

-- Existing groups predate the commercial migration. Give them a bounded
-- migration grace period so the commercial gate cannot invalidate already
-- scheduled rounds while administrators connect Stripe or approve access.
insert into public.billing_accounts (group_id, subscription_status, trial_started_at, trial_ends_at)
select group_record.id,
       'trialing'::public.billing_subscription_status,
       pg_catalog.clock_timestamp(),
       pg_catalog.clock_timestamp() + interval '30 days'
from public.groups as group_record
on conflict (group_id) do nothing;

insert into public.membership_billing_entitlements (
  membership_id, group_id, status, starts_at, expires_at, source, reason
)
select membership.id,
       membership.group_id,
       'active'::public.billing_entitlement_status,
       account.trial_started_at,
       account.trial_ends_at,
       'trial',
       '30-day migration grace period'
from public.memberships as membership
join public.billing_accounts as account on account.group_id = membership.group_id
where membership.status = 'active'
on conflict (membership_id) do nothing;

create function public.read_billing_portal(p_actor_user_id uuid)
returns table (
  group_id app.entity_id,
  stripe_customer_reference text,
  stripe_subscription_reference text,
  plan_name text,
  plan_interval text,
  plan_amount_minor bigint,
  plan_currency text,
  subscription_status public.billing_subscription_status,
  trial_started_at app.utc_instant,
  trial_ends_at app.utc_instant,
  current_period_start app.utc_instant,
  current_period_end app.utc_instant,
  next_invoice_at app.utc_instant,
  payment_action_required boolean,
  active_entitlement_count bigint,
  billable_member_count bigint,
  expired_member_count bigint,
  expiring_member_count bigint,
  failed_webhook_count bigint,
  last_webhook_at app.utc_instant
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
  select
    account.group_id,
    account.stripe_customer_id,
    account.stripe_subscription_id,
    account.plan_name,
    account.plan_interval,
    account.plan_amount_minor,
    account.plan_currency,
    account.subscription_status,
    account.trial_started_at,
    account.trial_ends_at,
    account.current_period_start,
    account.current_period_end,
    account.next_invoice_at,
    account.payment_action_required,
    count(entitlement.membership_id) filter (
      where entitlement.status in ('active', 'grace')
        and (entitlement.expires_at is null or entitlement.expires_at > pg_catalog.clock_timestamp())
    ),
    count(membership.id),
    count(entitlement.membership_id) filter (
      where entitlement.status in ('expired', 'revoked')
        or entitlement.expires_at is not null and entitlement.expires_at <= pg_catalog.clock_timestamp()
    ),
    count(entitlement.membership_id) filter (
      where entitlement.expires_at > pg_catalog.clock_timestamp()
        and entitlement.expires_at <= pg_catalog.clock_timestamp() + interval '10 days'
    ),
    (select count(*) from public.billing_events as event
      where event.group_id = account.group_id and event.state = 'failed'),
    (select max(event.received_at)::app.utc_instant from public.billing_events as event
      where event.group_id = account.group_id)
  from public.billing_accounts as account
  left join public.memberships as membership
    on membership.group_id = account.group_id and membership.status = 'active'
  left join public.membership_billing_entitlements as entitlement
    on entitlement.membership_id = membership.id and entitlement.group_id = account.group_id
  where account.group_id = actor_group_id
  group by account.group_id;
end;
$$;

comment on function public.read_billing_portal(uuid) is
  'Administrator-only normalized billing summary. The actor identity resolves the tenant; no group identifier is accepted.';
revoke all on function public.read_billing_portal(uuid) from public, anon;
grant execute on function public.read_billing_portal(uuid) to authenticated, service_role;

create function public.read_billing_member_entitlements(p_actor_user_id uuid)
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
    profile.first_name,
    profile.last_name,
    case when entitlement.expires_at is not null and entitlement.expires_at <= pg_catalog.clock_timestamp()
      then 'expired'::public.billing_entitlement_status else entitlement.status end,
    entitlement.starts_at,
    entitlement.expires_at,
    entitlement.source,
    entitlement.reason
  from public.membership_billing_entitlements as entitlement
  join public.memberships as membership
    on membership.id = entitlement.membership_id and membership.group_id = entitlement.group_id
  left join public.membership_golfer_profiles as profile
    on profile.membership_id = membership.id and profile.group_id = membership.group_id
  where entitlement.group_id = actor_group_id
    and membership.status = 'active'
  order by profile.last_name nulls last, profile.first_name nulls last, entitlement.membership_id;
end;
$$;

comment on function public.read_billing_member_entitlements(uuid) is
  'Administrator-only expiring member view. Expiry is evaluated from UTC server time on every read.';
revoke all on function public.read_billing_member_entitlements(uuid) from public, anon;
grant execute on function public.read_billing_member_entitlements(uuid) to authenticated, service_role;

create function public.process_stripe_billing_event(
  p_stripe_event_id text,
  p_event_type text,
  p_stripe_created_at timestamptz,
  p_payload jsonb
)
returns table (
  event_id text,
  event_state public.billing_event_state,
  group_id app.entity_id,
  applied boolean,
  safe_error text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_record public.billing_events%rowtype;
  account public.billing_accounts%rowtype;
  target_group_id uuid;
  customer_id text;
  subscription_id text;
  event_created timestamptz;
  event_object jsonb;
  subscription_status text;
  current_period_start timestamptz;
  current_period_end timestamptz;
  trial_start timestamptz;
  trial_end timestamptz;
  plan jsonb;
  invoice_status public.billing_invoice_status;
  invoice_id text;
  invoice_created timestamptz;
  current_is_newer boolean;
  safe_failure text;
begin
  if p_stripe_event_id is null or p_stripe_event_id !~ '^evt_[A-Za-z0-9_-]+$'
    or p_event_type is null or pg_catalog.btrim(p_event_type) = ''
    or p_stripe_created_at is null
    or p_payload is null or jsonb_typeof(p_payload) <> 'object'
  then
    raise exception 'billing_event_invalid' using errcode = '22023';
  end if;

  insert into public.billing_events (
    stripe_event_id, event_type, stripe_created_at, payload, state
  )
  values (
    p_stripe_event_id, p_event_type, p_stripe_created_at, p_payload, 'received'
  )
  on conflict (stripe_event_id) do nothing
  returning * into event_record;

  if not found then
    select * into event_record
    from public.billing_events
    where stripe_event_id = p_stripe_event_id
    for update;
    return query select event_record.stripe_event_id, event_record.state,
      event_record.group_id::app.entity_id, event_record.state = 'processed', event_record.safe_error;
    return;
  end if;

  event_object := coalesce(p_payload -> 'data' -> 'object', p_payload, '{}'::jsonb);
  customer_id := nullif(pg_catalog.btrim(coalesce(event_object ->> 'customer', '')), '');
  subscription_id := nullif(pg_catalog.btrim(coalesce(event_object ->> 'subscription', '')), '');
  if subscription_id is null then
    if p_event_type like 'customer.subscription.%' then
      subscription_id := nullif(pg_catalog.btrim(coalesce(event_object ->> 'id', '')), '');
    end if;
  end if;
  event_created := p_stripe_created_at;

  select billing_account.group_id
  into target_group_id
  from public.billing_accounts as billing_account
  where (customer_id is not null and billing_account.stripe_customer_id = customer_id)
     or (subscription_id is not null and billing_account.stripe_subscription_id = subscription_id)
  order by billing_account.group_id
  limit 1;

  if target_group_id is null and p_event_type = 'checkout.session.completed' then
    begin
      target_group_id := nullif(event_object -> 'metadata' ->> 'group_id', '')::uuid;
    exception when invalid_text_representation then
      target_group_id := null;
    end;
  end if;

  if target_group_id is null then
    update public.billing_events
    set state = 'ignored', safe_error = 'unknown_customer_or_subscription', processed_at = pg_catalog.clock_timestamp(), attempts = attempts + 1
    where stripe_event_id = p_stripe_event_id;
    return query select p_stripe_event_id, 'ignored'::public.billing_event_state, null::app.entity_id, false, 'unknown_customer_or_subscription';
    return;
  end if;

  update public.billing_events
  set group_id = target_group_id, attempts = attempts + 1
  where stripe_event_id = p_stripe_event_id;

  select * into account
  from public.billing_accounts as billing_account
  where billing_account.group_id = target_group_id
  for update;

  current_is_newer := account.last_stripe_event_created_at is null
    or event_created > account.last_stripe_event_created_at
    or (event_created = account.last_stripe_event_created_at and p_stripe_event_id > coalesce(account.last_stripe_event_id, ''));

  if p_event_type = 'checkout.session.completed' then
    update public.billing_accounts
    set stripe_customer_id = coalesce(customer_id, stripe_customer_id),
        version = version + 1
    where public.billing_accounts.group_id = target_group_id;
  elsif p_event_type like 'customer.subscription.%' then
    if not current_is_newer then
      update public.billing_events
      set state = 'ignored', safe_error = 'out_of_order_event', processed_at = pg_catalog.clock_timestamp()
      where stripe_event_id = p_stripe_event_id;
      return query select p_stripe_event_id, 'ignored'::public.billing_event_state, target_group_id::app.entity_id, false, 'out_of_order_event';
      return;
    end if;

    subscription_status := nullif(pg_catalog.btrim(coalesce(event_object ->> 'status', '')), '');
    if subscription_status in ('trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused') then
      account.subscription_status := subscription_status::public.billing_subscription_status;
    else
      account.subscription_status := 'expired';
    end if;
    plan := coalesce(event_object -> 'items' -> 'data' -> 0 -> 'price', '{}'::jsonb);
    account.stripe_customer_id := coalesce(customer_id, account.stripe_customer_id);
    account.stripe_subscription_id := coalesce(subscription_id, account.stripe_subscription_id);
    account.stripe_price_id := coalesce(nullif(plan ->> 'id', ''), account.stripe_price_id);
    account.plan_name := coalesce(nullif(plan ->> 'nickname', ''), nullif(plan -> 'product' ->> 'name', ''), account.plan_name);
    account.plan_interval := coalesce(nullif(plan -> 'recurring' ->> 'interval', ''), account.plan_interval);
    account.plan_amount_minor := coalesce(nullif(plan ->> 'unit_amount', '')::bigint, account.plan_amount_minor);
    account.plan_currency := coalesce(nullif(pg_catalog.lower(plan ->> 'currency'), ''), account.plan_currency);
    current_period_start := timestamptz 'epoch' + (nullif(event_object ->> 'current_period_start', '')::bigint * interval '1 second');
    current_period_end := timestamptz 'epoch' + (nullif(event_object ->> 'current_period_end', '')::bigint * interval '1 second');
    trial_start := timestamptz 'epoch' + (nullif(event_object ->> 'trial_start', '')::bigint * interval '1 second');
    trial_end := timestamptz 'epoch' + (nullif(event_object ->> 'trial_end', '')::bigint * interval '1 second');
    account.current_period_start := coalesce(current_period_start, account.current_period_start);
    account.current_period_end := coalesce(current_period_end, account.current_period_end);
    account.trial_started_at := coalesce(trial_start, account.trial_started_at);
    account.trial_ends_at := coalesce(trial_end, account.trial_ends_at);
    account.payment_action_required := account.subscription_status in ('past_due', 'unpaid', 'incomplete');
    account.last_stripe_event_created_at := event_created;
    account.last_stripe_event_id := p_stripe_event_id;
    account.version := account.version + 1;
    update public.billing_accounts set
      stripe_customer_id = account.stripe_customer_id,
      stripe_subscription_id = account.stripe_subscription_id,
      stripe_price_id = account.stripe_price_id,
      plan_name = account.plan_name,
      plan_interval = account.plan_interval,
      plan_amount_minor = account.plan_amount_minor,
      plan_currency = account.plan_currency,
      subscription_status = account.subscription_status,
      trial_started_at = account.trial_started_at,
      trial_ends_at = account.trial_ends_at,
      current_period_start = account.current_period_start,
      current_period_end = account.current_period_end,
      payment_action_required = account.payment_action_required,
      last_stripe_event_created_at = account.last_stripe_event_created_at,
      last_stripe_event_id = account.last_stripe_event_id,
      version = account.version
    where public.billing_accounts.group_id = target_group_id;

    update public.membership_billing_entitlements as entitlement
    set status = case
      when account.subscription_status in ('active', 'trialing', 'past_due', 'unpaid', 'paused')
        and (account.current_period_end is null or account.current_period_end > pg_catalog.clock_timestamp()) then 'active'::public.billing_entitlement_status
      else 'expired'::public.billing_entitlement_status
    end,
    starts_at = coalesce(account.current_period_start, account.trial_started_at, entitlement.starts_at),
    expires_at = coalesce(account.current_period_end, account.trial_ends_at, entitlement.expires_at),
    source = 'stripe_event',
    source_event_id = p_stripe_event_id,
    reason = 'Stripe subscription state reconciled',
    version = entitlement.version + 1
    where entitlement.group_id = target_group_id
      and exists (select 1 from public.memberships as membership where membership.id = entitlement.membership_id and membership.status = 'active');
  elsif p_event_type like 'invoice.%' then
    invoice_id := nullif(pg_catalog.btrim(coalesce(event_object ->> 'id', '')), '');
    if invoice_id is null then
      safe_failure := 'invoice_id_missing';
    else
      invoice_status := case coalesce(event_object ->> 'status', '')
        when 'draft' then 'draft'::public.billing_invoice_status
        when 'open' then 'open'::public.billing_invoice_status
        when 'paid' then 'paid'::public.billing_invoice_status
        when 'uncollectible' then 'uncollectible'::public.billing_invoice_status
        when 'void' then 'void'::public.billing_invoice_status
        else 'unknown'::public.billing_invoice_status end;
      invoice_created := timestamptz 'epoch' + (nullif(event_object ->> 'created', '')::bigint * interval '1 second');
      insert into public.billing_invoices (
        group_id, stripe_invoice_id, stripe_subscription_id, stripe_event_id, status,
        amount_due_minor, amount_paid_minor, currency, hosted_invoice_url, invoice_pdf_url,
        period_start, period_end, due_at, paid_at
      ) values (
        target_group_id,
        invoice_id,
        nullif(event_object ->> 'subscription', ''),
        p_stripe_event_id,
        invoice_status,
        nullif(event_object ->> 'amount_due', '')::bigint,
        nullif(event_object ->> 'amount_paid', '')::bigint,
        nullif(pg_catalog.lower(event_object ->> 'currency'), ''),
        nullif(event_object ->> 'hosted_invoice_url', ''),
        nullif(event_object ->> 'invoice_pdf', ''),
        timestamptz 'epoch' + (nullif(event_object ->> 'period_start', '')::bigint * interval '1 second'),
        timestamptz 'epoch' + (nullif(event_object ->> 'period_end', '')::bigint * interval '1 second'),
        timestamptz 'epoch' + (nullif(event_object ->> 'due_date', '')::bigint * interval '1 second'),
        case when invoice_status = 'paid' then coalesce(invoice_created, pg_catalog.clock_timestamp()) end
      )
      on conflict (stripe_invoice_id) do update set
        status = excluded.status,
        amount_due_minor = excluded.amount_due_minor,
        amount_paid_minor = excluded.amount_paid_minor,
        currency = excluded.currency,
        hosted_invoice_url = excluded.hosted_invoice_url,
        invoice_pdf_url = excluded.invoice_pdf_url,
        period_start = excluded.period_start,
        period_end = excluded.period_end,
        due_at = excluded.due_at,
        paid_at = excluded.paid_at,
        stripe_event_id = excluded.stripe_event_id;
      update public.billing_accounts
      set payment_action_required = invoice_status in ('open', 'uncollectible'),
          next_invoice_at = case when invoice_status = 'open' then coalesce(
            timestamptz 'epoch' + (nullif(event_object ->> 'due_date', '')::bigint * interval '1 second'),
            next_invoice_at) else next_invoice_at end
      where public.billing_accounts.group_id = target_group_id;
    end if;
  else
    safe_failure := 'event_type_not_reconciled';
  end if;

  if safe_failure is not null then
    update public.billing_events
    set state = 'failed', safe_error = safe_failure, processed_at = pg_catalog.clock_timestamp()
    where stripe_event_id = p_stripe_event_id;
    return query select p_stripe_event_id, 'failed'::public.billing_event_state, target_group_id::app.entity_id, false, safe_failure;
    return;
  end if;

  update public.billing_events
  set state = 'processed', safe_error = null, processed_at = pg_catalog.clock_timestamp()
  where stripe_event_id = p_stripe_event_id;
  return query select p_stripe_event_id, 'processed'::public.billing_event_state, target_group_id::app.entity_id, true, null::text;
exception when others then
  safe_failure := left(sqlerrm, 2000);
  update public.billing_events
  set state = 'failed', safe_error = safe_failure, processed_at = pg_catalog.clock_timestamp()
  where stripe_event_id = p_stripe_event_id;
  return query select p_stripe_event_id, 'failed'::public.billing_event_state, target_group_id::app.entity_id, false, safe_failure;
end;
$$;

comment on function public.process_stripe_billing_event(text, text, timestamptz, jsonb) is
  'Service-role-only Stripe reconciliation. It stores and deduplicates the event before applying ordered subscription and entitlement projections.';
revoke all on function public.process_stripe_billing_event(text, text, timestamptz, jsonb)
from public, anon, authenticated;
grant execute on function public.process_stripe_billing_event(text, text, timestamptz, jsonb) to service_role;

create function public.grant_billing_entitlement(
  p_actor_user_id uuid,
  p_membership_id uuid,
  p_expires_at timestamptz,
  p_reason text,
  p_correlation_id uuid,
  p_operation_id uuid
)
returns table (
  membership_id app.entity_id,
  group_id app.entity_id,
  status public.billing_entitlement_status,
  starts_at app.utc_instant,
  expires_at app.utc_instant,
  version bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_group_id uuid;
  target_group_id uuid;
  prior_event public.audit_events%rowtype;
  entitlement public.membership_billing_entitlements%rowtype;
begin
  if p_actor_user_id is null or p_membership_id is null or p_expires_at is null
    or p_expires_at <= pg_catalog.clock_timestamp()
    or p_correlation_id is null or p_operation_id is null
    or p_reason is null or pg_catalog.btrim(p_reason) = '' then
    raise exception 'billing_entitlement_input_invalid' using errcode = '22023';
  end if;
  select membership.group_id into actor_group_id
  from public.memberships as membership
  where membership.user_id = p_actor_user_id
    and membership.status = 'active'
    and membership.role = 'administrator';
  if actor_group_id is null then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;
  select event.* into prior_event
  from public.audit_events as event
  where event.actor_user_id = p_actor_user_id
    and event.action = 'billing.entitlement_granted'
    and event.operation_id = p_operation_id
  limit 1;
  if found then
    if prior_event.target_id is distinct from p_membership_id
      or prior_event.reason is distinct from pg_catalog.btrim(p_reason)
    then
      raise exception 'operation_reused' using errcode = 'P0001';
    end if;
    select existing_entitlement.* into entitlement
    from public.membership_billing_entitlements as existing_entitlement
    where existing_entitlement.membership_id = p_membership_id and existing_entitlement.group_id = actor_group_id;
    if not found then raise exception 'operation_reused' using errcode = 'P0001'; end if;
    return query select entitlement.membership_id, entitlement.group_id, entitlement.status,
      entitlement.starts_at, entitlement.expires_at, entitlement.version;
    return;
  end if;
  select membership.group_id into target_group_id
  from public.memberships as membership
  where membership.id = p_membership_id and membership.status = 'active';
  if target_group_id is null or target_group_id <> actor_group_id then
    raise exception 'membership_not_found' using errcode = 'P0002';
  end if;
  insert into public.membership_billing_entitlements (
    membership_id, group_id, status, starts_at, expires_at, source, reason, version
  ) values (
    p_membership_id, actor_group_id, 'active', pg_catalog.clock_timestamp(), p_expires_at,
    'manual', pg_catalog.btrim(p_reason), 1
  ) on conflict on constraint membership_billing_entitlements_pkey do update set
    status = 'active', starts_at = pg_catalog.clock_timestamp(), expires_at = excluded.expires_at,
    source = 'manual', source_event_id = null, reason = excluded.reason,
    version = membership_billing_entitlements.version + 1
  returning * into entitlement;
  insert into public.audit_events (
    group_id, actor_user_id, action, target_type, target_id, target_version,
    after_state, source, correlation_id, operation_id, reason
  ) values (
    actor_group_id, p_actor_user_id, 'billing.entitlement_granted', 'membership', p_membership_id,
    entitlement.version,
    pg_catalog.jsonb_build_object('status', entitlement.status, 'expires_at', entitlement.expires_at,
      'source', entitlement.source),
    'portal', p_correlation_id, p_operation_id, pg_catalog.btrim(p_reason)
  );
  return query select entitlement.membership_id, entitlement.group_id, entitlement.status,
    entitlement.starts_at, entitlement.expires_at, entitlement.version;
end;
$$;

comment on function public.grant_billing_entitlement(uuid, uuid, timestamptz, text, uuid, uuid) is
  'Administrator-only temporary entitlement adjustment. Reason, expiry, actor, and an append-only audit row are required.';
revoke all on function public.grant_billing_entitlement(uuid, uuid, timestamptz, text, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.grant_billing_entitlement(uuid, uuid, timestamptz, text, uuid, uuid) to service_role;
