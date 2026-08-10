-- Phase 07: durable round announcements and an in-app member inbox.
--
-- An announcement is immutable content authored by a coordinator or
-- administrator for one published/live round.  The transaction creates the
-- round content, its audit event, a notification outbox event, and one
-- recipient-scoped inbox item for every active participant and current
-- coordinator/administrator.  The outbox row is terminalized in the same
-- transaction because in-app fan-out is completed before the RPC returns;
-- provider delivery workers remain responsible for the existing e-mail/push
-- event families.

create table public.round_announcements (
  id app.entity_id primary key default extensions.gen_random_uuid(),
  group_id app.entity_id not null,
  round_id app.entity_id not null,
  author_membership_id app.entity_id not null,
  author_user_id app.entity_id not null references auth.users (id) on delete restrict,
  author_role public.membership_role not null,
  author_display_name text not null,
  body text not null,
  version bigint not null default 1,
  created_at app.utc_instant not null default pg_catalog.now(),
  constraint round_announcements_id_group_unique unique (id, group_id),
  constraint round_announcements_round_group_fk
    foreign key (round_id, group_id)
    references public.rounds (id, group_id)
    on delete restrict,
  constraint round_announcements_author_group_fk
    foreign key (author_membership_id, group_id)
    references public.memberships (id, group_id)
    on delete restrict,
  constraint round_announcements_author_display_name_valid
    check (
      pg_catalog.btrim(author_display_name) = author_display_name
      and pg_catalog.length(author_display_name) between 1 and 200
    ),
  constraint round_announcements_body_valid
    check (
      pg_catalog.btrim(body) = body
      and pg_catalog.length(body) between 1 and 300
    ),
  constraint round_announcements_version_positive check (version > 0)
);

comment on table public.round_announcements is
  'Immutable, plain-text round updates authored by a coordinator or administrator and delivered to the round inbox.';
comment on column public.round_announcements.body is
  'Plain text only. PostgreSQL length counts Unicode characters and enforces the 300-character member-facing limit.';
comment on column public.round_announcements.author_display_name is
  'Display-name snapshot captured at post time so later profile changes do not rewrite communication history.';

create function app.reject_round_announcement_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'round_announcement_immutable'
    using errcode = 'P0001';
end;
$$;

revoke all on function app.reject_round_announcement_mutation()
from public, anon, authenticated;

create trigger round_announcements_append_only
before update or delete on public.round_announcements
for each row execute function app.reject_round_announcement_mutation();

create index round_announcements_round_created_idx
on public.round_announcements (group_id, round_id, created_at desc, id desc);

create table public.notification_inbox_items (
  id app.entity_id primary key default extensions.gen_random_uuid(),
  group_id app.entity_id not null,
  outbox_job_id app.entity_id not null,
  announcement_id app.entity_id not null,
  recipient_membership_id app.entity_id not null,
  read_at app.utc_instant,
  version bigint not null default 1,
  created_at app.utc_instant not null default pg_catalog.now(),
  updated_at app.utc_instant not null default pg_catalog.now(),
  constraint notification_inbox_items_id_group_unique unique (id, group_id),
  constraint notification_inbox_items_outbox_group_fk
    foreign key (outbox_job_id, group_id)
    references public.notification_outbox_jobs (id, group_id)
    on delete restrict,
  constraint notification_inbox_items_announcement_group_fk
    foreign key (announcement_id, group_id)
    references public.round_announcements (id, group_id)
    on delete restrict,
  constraint notification_inbox_items_recipient_group_fk
    foreign key (recipient_membership_id, group_id)
    references public.memberships (id, group_id)
    on delete restrict,
  constraint notification_inbox_items_version_positive check (version > 0)
);

comment on table public.notification_inbox_items is
  'Recipient-scoped in-app read state. Each row joins one durable outbox announcement event to one active membership.';

create trigger notification_inbox_items_immutable_id
before update of id on public.notification_inbox_items
for each row execute function app.reject_id_change('id');

create trigger notification_inbox_items_immutable_group
before update of group_id on public.notification_inbox_items
for each row execute function app.reject_id_change('group_id');

create trigger notification_inbox_items_immutable_outbox
before update of outbox_job_id on public.notification_inbox_items
for each row execute function app.reject_id_change('outbox_job_id');

create trigger notification_inbox_items_immutable_announcement
before update of announcement_id on public.notification_inbox_items
for each row execute function app.reject_id_change('announcement_id');

create trigger notification_inbox_items_immutable_recipient
before update of recipient_membership_id on public.notification_inbox_items
for each row execute function app.reject_id_change('recipient_membership_id');

create trigger notification_inbox_items_set_updated_at
before update on public.notification_inbox_items
for each row execute function app.set_updated_at();

alter table public.notification_inbox_items
  add constraint notification_inbox_items_event_recipient_unique
  unique (outbox_job_id, recipient_membership_id);
create index notification_inbox_items_recipient_created_idx
on public.notification_inbox_items (group_id, recipient_membership_id, created_at desc, id desc);
create index notification_inbox_items_unread_idx
on public.notification_inbox_items (group_id, recipient_membership_id, read_at, created_at desc);

alter table public.round_announcements enable row level security;
alter table public.round_announcements force row level security;
alter table public.notification_inbox_items enable row level security;
alter table public.notification_inbox_items force row level security;

revoke all on table public.round_announcements, public.notification_inbox_items
from public, anon, authenticated, service_role;

create function app.member_inbox_actor_context(p_actor_user_id uuid)
returns table (
  membership_id app.entity_id,
  group_id app.entity_id,
  actor_role public.membership_role
)
language sql
stable
security definer
set search_path = ''
as $$
  select membership.id, membership.group_id, membership.role
  from public.memberships as membership
  join public.user_profiles as profile
    on profile.user_id = membership.user_id
  join auth.users as identity
    on identity.id = membership.user_id
  where membership.user_id = p_actor_user_id
    and membership.status = 'active'
    and profile.disabled_at is null
    and identity.email_confirmed_at is not null
    and identity.deleted_at is null
    and not identity.is_anonymous
    and (identity.banned_until is null or identity.banned_until <= pg_catalog.statement_timestamp())
  order by membership.id
  limit 1;
$$;

revoke all on function app.member_inbox_actor_context(uuid)
from public, anon, authenticated, service_role;

create function app.read_member_inbox_for_actor(
  p_actor_user_id uuid,
  p_limit integer default 50
)
returns table (
  inbox_item_id app.entity_id,
  announcement_id app.entity_id,
  group_id app.entity_id,
  round_id app.entity_id,
  round_description text,
  body text,
  author_display_name text,
  author_role public.membership_role,
  created_at app.utc_instant,
  read_at app.utc_instant
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_membership_id uuid;
  actor_group_id uuid;
begin
  if p_actor_user_id is null then
    raise exception 'member_inbox_context_required' using errcode = '22004';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'member_inbox_limit_invalid' using errcode = '22023';
  end if;
  if exists (
    select 1
    from auth.users as identity
    where identity.id = p_actor_user_id
      and coalesce(identity.raw_app_meta_data, '{}'::jsonb)
        ? 'greenroster_password_recovery'
  ) then
    raise exception 'recovery_session_forbidden' using errcode = 'P0003';
  end if;

  select context.membership_id, context.group_id
  into actor_membership_id, actor_group_id
  from app.member_inbox_actor_context(p_actor_user_id) as context;
  if actor_membership_id is null or actor_group_id is null then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  return query
  select
    inbox.id,
    inbox.announcement_id,
    inbox.group_id,
    announcement.round_id,
    round_record.description,
    announcement.body,
    announcement.author_display_name,
    announcement.author_role,
    inbox.created_at,
    inbox.read_at
  from public.notification_inbox_items as inbox
  join public.round_announcements as announcement
    on announcement.id = inbox.announcement_id
   and announcement.group_id = inbox.group_id
  join public.rounds as round_record
    on round_record.id = announcement.round_id
   and round_record.group_id = announcement.group_id
  where inbox.group_id = actor_group_id
    and inbox.recipient_membership_id = actor_membership_id
  order by inbox.created_at desc, inbox.id desc
  limit p_limit;
end;
$$;

revoke all on function app.read_member_inbox_for_actor(uuid, integer)
from public, anon, authenticated, service_role;

create function public.read_member_inbox(
  p_actor_user_id uuid,
  p_limit integer default 50
)
returns table (
  inbox_item_id app.entity_id,
  announcement_id app.entity_id,
  group_id app.entity_id,
  round_id app.entity_id,
  round_description text,
  body text,
  author_display_name text,
  author_role public.membership_role,
  created_at app.utc_instant,
  read_at app.utc_instant
)
language sql
stable
security definer
set search_path = ''
as $$
  select * from app.read_member_inbox_for_actor(p_actor_user_id, p_limit);
$$;

comment on function public.read_member_inbox(uuid, integer) is
  'Service-only member-web projection of the caller''s tenant-scoped round updates and read state.';

revoke all on function public.read_member_inbox(uuid, integer)
from public, anon, authenticated, service_role;
grant execute on function public.read_member_inbox(uuid, integer)
to service_role;

create function public.resolve_mobile_member_inbox(
  p_limit integer default 50
)
returns table (
  inbox_item_id app.entity_id,
  announcement_id app.entity_id,
  group_id app.entity_id,
  round_id app.entity_id,
  round_description text,
  body text,
  author_display_name text,
  author_role public.membership_role,
  created_at app.utc_instant,
  read_at app.utc_instant
)
language sql
stable
security definer
set search_path = ''
as $$
  select * from app.read_member_inbox_for_actor((select auth.uid()), p_limit);
$$;

comment on function public.resolve_mobile_member_inbox(integer) is
  'Authenticated mobile projection of only the current account''s active membership inbox.';

revoke all on function public.resolve_mobile_member_inbox(integer)
from public, anon, service_role;
grant execute on function public.resolve_mobile_member_inbox(integer)
to authenticated;

create function app.mark_member_inbox_read_for_actor(
  p_actor_user_id uuid,
  p_inbox_item_id uuid,
  p_correlation_id uuid,
  p_operation_id uuid
)
returns table (
  inbox_item_id app.entity_id,
  read_at app.utc_instant,
  version bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_membership_id uuid;
  actor_group_id uuid;
  prior_event public.audit_events%rowtype;
  inbox_record public.notification_inbox_items%rowtype;
  read_at_value timestamptz;
  next_version bigint;
begin
  if p_actor_user_id is null
    or p_inbox_item_id is null
    or p_correlation_id is null
    or p_operation_id is null
  then
    raise exception 'operation_context_required' using errcode = '22004';
  end if;
  if exists (
    select 1
    from auth.users as identity
    where identity.id = p_actor_user_id
      and coalesce(identity.raw_app_meta_data, '{}'::jsonb)
        ? 'greenroster_password_recovery'
  ) then
    raise exception 'recovery_session_forbidden' using errcode = 'P0003';
  end if;

  select context.membership_id, context.group_id
  into actor_membership_id, actor_group_id
  from app.member_inbox_actor_context(p_actor_user_id) as context;
  if actor_membership_id is null or actor_group_id is null then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  -- Serialize the audit lookup with another mark-read request for this
  -- tenant so concurrent retries converge on the same operation receipt.
  perform 1
  from public.groups as group_record
  where group_record.id = actor_group_id
  for update;
  if not found then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  select event.*
  into prior_event
  from public.audit_events as event
  where event.group_id = actor_group_id
    and event.actor_user_id = p_actor_user_id
    and event.action = 'notification.inbox_read'
    and event.operation_id = p_operation_id;
  if found then
    if prior_event.target_id is distinct from p_inbox_item_id then
      raise exception 'operation_id_reused' using errcode = '23505';
    end if;
    select inbox.*
    into inbox_record
    from public.notification_inbox_items as inbox
    where inbox.id = p_inbox_item_id
      and inbox.group_id = actor_group_id
      and inbox.recipient_membership_id = actor_membership_id;
    if not found then
      raise exception 'inbox_item_not_found' using errcode = 'P0002';
    end if;
    return query select inbox_record.id, inbox_record.read_at, inbox_record.version;
    return;
  end if;

  select inbox.*
  into inbox_record
  from public.notification_inbox_items as inbox
  where inbox.id = p_inbox_item_id
    and inbox.group_id = actor_group_id
    and inbox.recipient_membership_id = actor_membership_id
  for update;
  if not found then
    raise exception 'inbox_item_not_found' using errcode = 'P0002';
  end if;

  read_at_value := coalesce(inbox_record.read_at, pg_catalog.clock_timestamp());
  next_version := case
    when inbox_record.read_at is null then inbox_record.version + 1
    else inbox_record.version
  end;
  update public.notification_inbox_items as inbox
  set read_at = read_at_value,
      version = next_version
  where inbox.id = inbox_record.id
    and inbox.group_id = actor_group_id;

  insert into public.audit_events (
    group_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    target_version,
    after_state,
    source,
    correlation_id,
    operation_id
  )
  values (
    actor_group_id,
    p_actor_user_id,
    'notification.inbox_read',
    'notification_inbox_item',
    inbox_record.id,
    next_version,
    pg_catalog.jsonb_build_object(
      'inbox_item_id', inbox_record.id,
      'announcement_id', inbox_record.announcement_id,
      'read_at', read_at_value
    ),
    'member_web',
    p_correlation_id,
    p_operation_id
  );

  return query select inbox_record.id, read_at_value::app.utc_instant, next_version;
end;
$$;

revoke all on function app.mark_member_inbox_read_for_actor(uuid, uuid, uuid, uuid)
from public, anon, authenticated, service_role;

create function public.mark_member_inbox_read(
  p_actor_user_id uuid,
  p_inbox_item_id uuid,
  p_correlation_id uuid,
  p_operation_id uuid
)
returns table (
  inbox_item_id app.entity_id,
  read_at app.utc_instant,
  version bigint
)
language sql
security definer
set search_path = ''
as $$
  select * from app.mark_member_inbox_read_for_actor(
    p_actor_user_id,
    p_inbox_item_id,
    p_correlation_id,
    p_operation_id
  );
$$;

revoke all on function public.mark_member_inbox_read(uuid, uuid, uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.mark_member_inbox_read(uuid, uuid, uuid, uuid)
to service_role;

create function public.mark_mobile_member_inbox_read(
  p_inbox_item_id uuid,
  p_correlation_id uuid,
  p_operation_id uuid
)
returns table (
  inbox_item_id app.entity_id,
  read_at app.utc_instant,
  version bigint
)
language sql
security definer
set search_path = ''
as $$
  select * from app.mark_member_inbox_read_for_actor(
    (select auth.uid()),
    p_inbox_item_id,
    p_correlation_id,
    p_operation_id
  );
$$;

revoke all on function public.mark_mobile_member_inbox_read(uuid, uuid, uuid)
from public, anon, service_role;
grant execute on function public.mark_mobile_member_inbox_read(uuid, uuid, uuid)
to authenticated;

create function public.post_round_announcement(
  p_actor_user_id uuid,
  p_round_id uuid,
  p_body text,
  p_correlation_id uuid,
  p_operation_id uuid
)
returns table (
  announcement_id app.entity_id,
  group_id app.entity_id,
  round_id app.entity_id,
  body text,
  author_display_name text,
  author_role public.membership_role,
  created_at app.utc_instant,
  outbox_job_id app.entity_id,
  inbox_count bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_group_id uuid;
  actor_membership_id uuid;
  actor_role public.membership_role;
  locked_group public.groups%rowtype;
  locked_round public.rounds%rowtype;
  author_name text;
  normalized_body text;
  request_payload jsonb;
  request_fingerprint text;
  prior_event public.audit_events%rowtype;
  announcement_record public.round_announcements%rowtype;
  outbox_record public.notification_outbox_jobs%rowtype;
  now_at timestamptz := pg_catalog.clock_timestamp();
  recipient_count bigint;
begin
  if p_actor_user_id is null
    or p_round_id is null
    or p_correlation_id is null
    or p_operation_id is null
  then
    raise exception 'operation_context_required' using errcode = '22004';
  end if;

  normalized_body := nullif(pg_catalog.btrim(p_body), '');
  if normalized_body is null then
    raise exception 'round_announcement_empty' using errcode = '22023';
  end if;
  if pg_catalog.length(normalized_body) > 300 then
    raise exception 'round_announcement_too_long' using errcode = '22023';
  end if;

  select actor.group_id, actor.membership_id, actor.actor_role
  into actor_group_id, actor_membership_id, actor_role
  from app.resolve_member_management_actor(p_actor_user_id) as actor
  limit 1;
  if actor_group_id is null or actor_membership_id is null
    or actor_role not in ('coordinator', 'administrator')
  then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;
  if exists (
    select 1
    from auth.users as identity
    where identity.id = p_actor_user_id
      and coalesce(identity.raw_app_meta_data, '{}'::jsonb)
        ? 'greenroster_password_recovery'
  ) then
    raise exception 'recovery_session_forbidden' using errcode = 'P0003';
  end if;

  select group_record.*
  into locked_group
  from public.groups as group_record
  where group_record.id = actor_group_id
  for update;
  if not found then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  select round_record.*
  into locked_round
  from public.rounds as round_record
  where round_record.id = p_round_id
    and round_record.group_id = locked_group.id
  for update;
  if not found then
    raise exception 'round_not_found' using errcode = 'P0002';
  end if;
  if locked_round.state not in ('published', 'live') then
    raise exception 'round_announcement_state_locked' using errcode = 'P0001';
  end if;

  request_payload := pg_catalog.jsonb_build_object(
    'round_id', p_round_id,
    'body', normalized_body
  );
  request_fingerprint := app.member_request_fingerprint(
    request_payload,
    p_actor_user_id::text || ':' || p_operation_id::text
  );

  select event.*
  into prior_event
  from public.audit_events as event
  where event.group_id = locked_group.id
    and event.actor_user_id = p_actor_user_id
    and event.action = 'round.announcement_posted'
    and event.operation_id = p_operation_id;
  if found then
    if prior_event.target_id is null
      or prior_event.after_state ->> 'request_fingerprint' <> request_fingerprint
    then
      raise exception 'operation_id_reused' using errcode = '23505';
    end if;
    select announcement.*
    into announcement_record
    from public.round_announcements as announcement
    where announcement.id = prior_event.target_id
      and announcement.group_id = locked_group.id;
    if not found then
      raise exception 'announcement_idempotency_record_missing' using errcode = 'P0002';
    end if;
    select outbox.*
    into outbox_record
    from public.notification_outbox_jobs as outbox
    where outbox.id = (prior_event.after_state ->> 'outbox_job_id')::uuid
      and outbox.group_id = locked_group.id;
    if not found then
      raise exception 'announcement_idempotency_record_missing' using errcode = 'P0002';
    end if;
    select count(*)
    into recipient_count
    from public.notification_inbox_items as inbox
    where inbox.outbox_job_id = outbox_record.id
      and inbox.group_id = locked_group.id;
    return query select
      announcement_record.id,
      announcement_record.group_id,
      announcement_record.round_id,
      announcement_record.body,
      announcement_record.author_display_name,
      announcement_record.author_role,
      announcement_record.created_at,
      outbox_record.id,
      recipient_count;
    return;
  end if;

  select coalesce(
    nullif(pg_catalog.concat_ws(' ', golfer_profile.first_name, golfer_profile.last_name), ''),
    nullif(pg_catalog.concat_ws(' ', user_profile.first_name, user_profile.last_name), ''),
    nullif(pg_catalog.btrim(user_profile.display_name), ''),
    'Group coordinator'
  )
  into author_name
  from public.memberships as membership
  left join public.membership_golfer_profiles as golfer_profile
    on golfer_profile.membership_id = membership.id
   and golfer_profile.group_id = membership.group_id
  left join public.user_profiles as user_profile
    on user_profile.user_id = membership.user_id
  where membership.id = actor_membership_id
    and membership.group_id = locked_group.id;
  author_name := pg_catalog.left(pg_catalog.btrim(coalesce(author_name, 'Group coordinator')), 200);

  insert into public.round_announcements (
    group_id,
    round_id,
    author_membership_id,
    author_user_id,
    author_role,
    author_display_name,
    body
  )
  values (
    locked_group.id,
    locked_round.id,
    actor_membership_id,
    p_actor_user_id,
    actor_role,
    author_name,
    normalized_body
  )
  returning * into announcement_record;

  insert into public.notification_outbox_jobs (
    group_id,
    event_type,
    aggregate_type,
    aggregate_id,
    aggregate_version,
    idempotency_key,
    state,
    finished_at,
    next_attempt_at
  )
  values (
    locked_group.id,
    'round.announcement_posted',
    'round_announcement',
    announcement_record.id,
    announcement_record.version,
    'round.announcement_posted:' || announcement_record.id::text,
    'succeeded',
    now_at,
    now_at
  )
  returning * into outbox_record;

  with eligible_recipients as (
    select distinct participant_membership.id as membership_id
    from public.round_participants as participant
    join public.memberships as participant_membership
      on participant_membership.id = participant.membership_id
     and participant_membership.group_id = participant.group_id
    where participant.round_id = locked_round.id
      and participant.group_id = locked_group.id
      and participant_membership.status = 'active'
      and participant_membership.user_id is not null
    union
    select membership.id
    from public.memberships as membership
    where membership.group_id = locked_group.id
      and membership.status = 'active'
      and membership.role in ('coordinator', 'administrator')
      and membership.user_id is not null
  )
  insert into public.notification_inbox_items (
    group_id,
    outbox_job_id,
    announcement_id,
    recipient_membership_id
  )
  select
    locked_group.id,
    outbox_record.id,
    announcement_record.id,
    eligible.membership_id
  from eligible_recipients as eligible
  on conflict on constraint notification_inbox_items_event_recipient_unique do nothing;

  get diagnostics recipient_count = row_count;

  insert into public.audit_events (
    group_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    target_version,
    after_state,
    source,
    correlation_id,
    operation_id
  )
  values (
    locked_group.id,
    p_actor_user_id,
    'round.announcement_posted',
    'round_announcement',
    announcement_record.id,
    announcement_record.version,
    pg_catalog.jsonb_build_object(
      'announcement_id', announcement_record.id,
      'round_id', announcement_record.round_id,
      'outbox_job_id', outbox_record.id,
      'body', announcement_record.body,
      'recipient_count', recipient_count,
      'request_fingerprint', request_fingerprint
    ),
    'portal',
    p_correlation_id,
    p_operation_id
  );

  return query select
    announcement_record.id,
    announcement_record.group_id,
    announcement_record.round_id,
    announcement_record.body,
    announcement_record.author_display_name,
    announcement_record.author_role,
    announcement_record.created_at,
    outbox_record.id,
    recipient_count;
end;
$$;

comment on function public.post_round_announcement(uuid, uuid, text, uuid, uuid) is
  'Coordinator/administrator-only atomic round update. Validates plain text, derives the tenant, records audit/outbox state, and fans out the member inbox.';

revoke all on function public.post_round_announcement(uuid, uuid, text, uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.post_round_announcement(uuid, uuid, text, uuid, uuid)
to service_role;
