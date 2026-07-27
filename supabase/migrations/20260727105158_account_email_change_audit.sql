-- Phase 02: audit the committed Supabase Auth account e-mail transition.
--
-- GoTrue stores a requested e-mail in auth.users.email_change until its
-- confirmation flow commits the real auth.users.email update.  The trigger
-- therefore observes only the verified transition and keeps the account
-- identity/membership unchanged.  No account e-mail is copied into tenant
-- tables or audit JSON.

create function app.audit_account_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  membership_record public.memberships%rowtype;
  group_record public.groups%rowtype;
  correlation_id uuid := extensions.gen_random_uuid();
  operation_id uuid := extensions.gen_random_uuid();
begin
  if new.email is null
    or pg_catalog.btrim(new.email) <> new.email
    or pg_catalog.lower(new.email) <> new.email
    or pg_catalog.length(new.email) not between 3 and 320
    or new.email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  then
    raise exception 'account_email_not_canonical'
      using errcode = '22023';
  end if;

  if new.email_confirmed_at is null then
    raise exception 'account_email_unverified'
      using errcode = '22023';
  end if;

  select membership.*
  into membership_record
  from public.memberships as membership
  where membership.user_id = new.id
  order by membership.created_at, membership.id
  limit 1;

  if found then
    -- Invitation issuance locks the same group before checking Auth e-mails.
    -- Take that lock before checking pending invitations so either the
    -- invitation or this verified e-mail transition wins the address race.
    select group_row.*
    into group_record
    from public.groups as group_row
    where group_row.id = membership_record.group_id
    for update;

    if exists (
      select 1
      from public.membership_invitations as invitation
      where invitation.group_id = group_record.id
        and invitation.status = 'pending'
        and invitation.invited_email_normalized = new.email
    ) then
      raise exception 'invitation_email_in_use'
        using errcode = '23505';
    end if;

    insert into public.audit_events (
      group_id,
      actor_user_id,
      action,
      target_type,
      target_id,
      target_version,
      before_state,
      after_state,
      source,
      correlation_id,
      operation_id
    )
    values (
      membership_record.group_id,
      new.id,
      'account.email_changed',
      'membership',
      membership_record.id,
      membership_record.version,
      pg_catalog.jsonb_build_object(
        'email_present', old.email is not null,
        'email_verified', old.email_confirmed_at is not null
      ),
      pg_catalog.jsonb_build_object(
        'email_present', new.email is not null,
        'email_verified', new.email_confirmed_at is not null
      ),
      'auth',
      correlation_id,
      operation_id
    );
  else
    insert into public.identity_security_audit_events (
      user_id,
      action,
      target_type,
      target_id,
      after_state,
      source,
      correlation_id,
      operation_id
    )
    values (
      new.id,
      'account.email_changed',
      'user',
      new.id,
      pg_catalog.jsonb_build_object(
        'email_present', new.email is not null,
        'email_verified', new.email_confirmed_at is not null
      ),
      'auth',
      correlation_id,
      operation_id
    );
  end if;

  return new;
end;
$$;

comment on function app.audit_account_email_change() is
  'Auth-owned audit boundary for a verified account e-mail change. It fires only after auth.users.email changes, keeps raw e-mail values out of audit state, and routes unattached identities to the private security audit.';

revoke all on function app.audit_account_email_change()
from public, anon, authenticated, service_role;

create trigger auth_user_account_email_audit
after update of email on auth.users
for each row
when (old.email is distinct from new.email)
execute function app.audit_account_email_change();

create function app.enforce_attached_membership_invitation_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  auth_identity auth.users%rowtype;
  locked_group public.groups%rowtype;
begin
  -- Attachment and Auth e-mail transitions use the same lock order:
  -- Auth identity, then tenant group.  The acceptance RPC already owns both
  -- locks before this trigger runs; direct server-side attachment updates take
  -- them here before inspecting pending invitation addresses.
  select identity.*
  into auth_identity
  from auth.users as identity
  where identity.id = new.user_id
  for update;

  if not found
    or auth_identity.email is null
    or auth_identity.email_confirmed_at is null
    or auth_identity.deleted_at is not null
    or auth_identity.is_anonymous
    or (
      auth_identity.banned_until is not null
      and auth_identity.banned_until > pg_catalog.clock_timestamp()
    )
  then
    raise exception 'membership_identity_unavailable'
      using errcode = 'P0002';
  end if;

  select group_row.*
  into locked_group
  from public.groups as group_row
  where group_row.id = new.group_id
  for update;

  if not found then
    raise exception 'membership_group_unavailable'
      using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.membership_invitations as invitation
    where invitation.group_id = locked_group.id
      and invitation.status = 'pending'
      and invitation.invited_email_normalized = pg_catalog.lower(auth_identity.email)
  ) then
    raise exception 'invitation_email_in_use'
      using errcode = '23505';
  end if;

  return new;
end;
$$;

comment on function app.enforce_attached_membership_invitation_email() is
  'Server-authoritative membership attachment guard. It serializes Auth identity and tenant group state before rejecting an attached identity whose current verified e-mail matches another pending invitation in that group.';

revoke all on function app.enforce_attached_membership_invitation_email()
from public, anon, authenticated, service_role;

create trigger memberships_attached_identity_invitation_email
before update of user_id on public.memberships
for each row
when (old.user_id is null and new.user_id is not null)
execute function app.enforce_attached_membership_invitation_email();
