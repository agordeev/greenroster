-- Clubhouse content, round conversation, coordinator contact, and group
-- branding.  All writes resolve the tenant from the verified actor and are
-- exposed through narrow RPCs; clients never receive table write access.

create type public.content_item_state as enum ('draft', 'scheduled', 'published', 'archived');
create type public.media_item_kind as enum ('video', 'external');
create type public.branding_asset_slot as enum ('email_header', 'email_footer', 'scoreboard_header', 'scoreboard_footer');

create table public.group_news_items (
  id app.entity_id primary key default extensions.gen_random_uuid(),
  group_id app.entity_id not null references public.groups (id) on delete restrict,
  author_membership_id app.entity_id not null,
  author_user_id app.entity_id not null references auth.users (id) on delete restrict,
  author_display_name text not null,
  title text not null,
  body text not null,
  state public.content_item_state not null default 'draft',
  publish_at app.utc_instant,
  archived_at app.utc_instant,
  version bigint not null default 1,
  created_at app.utc_instant not null default pg_catalog.now(),
  updated_at app.utc_instant not null default pg_catalog.now(),
  operation_id uuid,
  constraint group_news_items_id_group_unique unique (id, group_id),
  constraint group_news_items_author_group_fk foreign key (author_membership_id, group_id)
    references public.memberships (id, group_id) on delete restrict,
  constraint group_news_items_title_valid check (pg_catalog.btrim(title) = title and pg_catalog.length(title) between 1 and 200),
  constraint group_news_items_body_valid check (pg_catalog.btrim(body) = body and pg_catalog.length(body) between 1 and 10000),
  constraint group_news_items_author_valid check (pg_catalog.btrim(author_display_name) = author_display_name and pg_catalog.length(author_display_name) between 1 and 200),
  constraint group_news_items_version_positive check (version > 0),
  constraint group_news_items_operation_unique unique (author_user_id, operation_id),
  constraint group_news_items_state_dates check (
    (state = 'draft' and archived_at is null)
    or (state = 'scheduled' and publish_at is not null and archived_at is null)
    or (state = 'published' and publish_at is not null and archived_at is null)
    or (state = 'archived' and archived_at is not null)
  )
);

create table public.group_media_items (
  id app.entity_id primary key default extensions.gen_random_uuid(),
  group_id app.entity_id not null references public.groups (id) on delete restrict,
  author_membership_id app.entity_id not null,
  author_user_id app.entity_id not null references auth.users (id) on delete restrict,
  title text not null,
  kind public.media_item_kind not null,
  media_url text not null,
  thumbnail_url text,
  display_from app.utc_instant,
  display_until app.utc_instant,
  is_default boolean not null default false,
  state public.content_item_state not null default 'draft',
  version bigint not null default 1,
  created_at app.utc_instant not null default pg_catalog.now(),
  updated_at app.utc_instant not null default pg_catalog.now(),
  operation_id uuid,
  constraint group_media_items_id_group_unique unique (id, group_id),
  constraint group_media_items_author_group_fk foreign key (author_membership_id, group_id)
    references public.memberships (id, group_id) on delete restrict,
  constraint group_media_items_title_valid check (pg_catalog.btrim(title) = title and pg_catalog.length(title) between 1 and 200),
  constraint group_media_items_url_https check (media_url ~ '^https://[^[:space:]]+$' and (thumbnail_url is null or thumbnail_url ~ '^https://[^[:space:]]+$')),
  constraint group_media_items_display_window check (display_until is null or display_from is null or display_until > display_from),
  constraint group_media_items_version_positive check (version > 0),
  constraint group_media_items_operation_unique unique (author_user_id, operation_id)
);

create table public.round_messages (
  id app.entity_id primary key default extensions.gen_random_uuid(),
  group_id app.entity_id not null,
  round_id app.entity_id not null,
  author_membership_id app.entity_id not null,
  author_user_id app.entity_id not null references auth.users (id) on delete restrict,
  author_role public.membership_role not null,
  author_display_name text not null,
  body text not null,
  removed_at app.utc_instant,
  removed_by_user_id app.entity_id references auth.users (id) on delete restrict,
  removal_reason text,
  operation_id uuid,
  created_at app.utc_instant not null default pg_catalog.now(),
  version bigint not null default 1,
  constraint round_messages_id_group_unique unique (id, group_id),
  constraint round_messages_round_group_fk foreign key (round_id, group_id) references public.rounds (id, group_id) on delete restrict,
  constraint round_messages_author_group_fk foreign key (author_membership_id, group_id) references public.memberships (id, group_id) on delete restrict,
  constraint round_messages_author_valid check (pg_catalog.btrim(author_display_name) = author_display_name and pg_catalog.length(author_display_name) between 1 and 200),
  constraint round_messages_body_valid check (pg_catalog.btrim(body) = body and pg_catalog.length(body) between 1 and 300),
  constraint round_messages_removal_consistent check ((removed_at is null and removed_by_user_id is null and removal_reason is null) or (removed_at is not null and removed_by_user_id is not null and removal_reason is not null and pg_catalog.length(pg_catalog.btrim(removal_reason)) between 1 and 500)),
  constraint round_messages_version_positive check (version > 0),
  constraint round_messages_operation_unique unique (author_user_id, operation_id)
);

create table public.coordinator_contact_messages (
  id app.entity_id primary key default extensions.gen_random_uuid(),
  group_id app.entity_id not null,
  sender_membership_id app.entity_id not null,
  recipient_membership_id app.entity_id not null,
  sender_user_id app.entity_id not null references auth.users (id) on delete restrict,
  recipient_user_id app.entity_id not null references auth.users (id) on delete restrict,
  sender_display_name text not null,
  recipient_display_name text not null,
  body text not null,
  operation_id uuid,
  created_at app.utc_instant not null default pg_catalog.now(),
  constraint coordinator_contact_messages_id_group_unique unique (id, group_id),
  constraint coordinator_contact_messages_sender_group_fk foreign key (sender_membership_id, group_id) references public.memberships (id, group_id) on delete restrict,
  constraint coordinator_contact_messages_recipient_group_fk foreign key (recipient_membership_id, group_id) references public.memberships (id, group_id) on delete restrict,
  constraint coordinator_contact_messages_sender_recipient_distinct check (sender_membership_id <> recipient_membership_id),
  constraint coordinator_contact_messages_body_valid check (pg_catalog.btrim(body) = body and pg_catalog.length(body) between 1 and 2000),
  constraint coordinator_contact_messages_operation_unique unique (sender_user_id, operation_id)
);

create table public.group_branding_assets (
  id app.entity_id primary key default extensions.gen_random_uuid(),
  group_id app.entity_id not null references public.groups (id) on delete restrict,
  slot public.branding_asset_slot not null,
  storage_path text,
  asset_url text not null,
  mime_type text not null,
  byte_size integer not null,
  alt_text text,
  decorative boolean not null default false,
  click_url text,
  display_order smallint not null default 0,
  version bigint not null default 1,
  created_by_user_id app.entity_id not null references auth.users (id) on delete restrict,
  created_at app.utc_instant not null default pg_catalog.now(),
  updated_at app.utc_instant not null default pg_catalog.now(),
  operation_id uuid,
  constraint group_branding_assets_id_group_unique unique (id, group_id),
  constraint group_branding_assets_slot_order_unique unique (group_id, slot, display_order),
  constraint group_branding_assets_url_https check (asset_url ~ '^https://[^[:space:]]+$'),
  constraint group_branding_assets_storage_path_safe check (storage_path is null or storage_path ~ '^[0-9a-fA-F-]{36}/[A-Za-z0-9._/-]+$'),
  constraint group_branding_assets_mime_valid check (mime_type in ('image/png', 'image/jpeg', 'image/gif', 'image/bmp', 'image/webp')),
  constraint group_branding_assets_size_valid check (byte_size > 0 and byte_size <= case when slot in ('email_header', 'email_footer') then 512000 else 1048576 end),
  constraint group_branding_assets_alt_valid check (decorative or (alt_text is not null and pg_catalog.length(pg_catalog.btrim(alt_text)) between 1 and 200)),
  constraint group_branding_assets_click_url_https check (click_url is null or click_url ~ '^https://[^[:space:]]+$'),
  constraint group_branding_assets_version_positive check (version > 0),
  constraint group_branding_assets_operation_unique unique (created_by_user_id, operation_id)
);

create index group_news_items_published_idx on public.group_news_items (group_id, state, publish_at desc, id desc);
create index group_media_items_published_idx on public.group_media_items (group_id, state, display_from desc, id desc);
create index round_messages_round_created_idx on public.round_messages (group_id, round_id, created_at asc, id asc);
create index coordinator_contact_messages_recipient_idx on public.coordinator_contact_messages (group_id, recipient_membership_id, created_at desc, id desc);
create index coordinator_contact_messages_sender_idx on public.coordinator_contact_messages (group_id, sender_membership_id, created_at desc, id desc);
create index group_branding_assets_scoreboard_idx on public.group_branding_assets (group_id, slot, display_order);

create trigger group_news_items_set_updated_at before update on public.group_news_items for each row execute function app.set_updated_at();
create trigger group_media_items_set_updated_at before update on public.group_media_items for each row execute function app.set_updated_at();
create trigger group_branding_assets_set_updated_at before update on public.group_branding_assets for each row execute function app.set_updated_at();

alter table public.group_news_items enable row level security;
alter table public.group_news_items force row level security;
alter table public.group_media_items enable row level security;
alter table public.group_media_items force row level security;
alter table public.round_messages enable row level security;
alter table public.round_messages force row level security;
alter table public.coordinator_contact_messages enable row level security;
alter table public.coordinator_contact_messages force row level security;
alter table public.group_branding_assets enable row level security;
alter table public.group_branding_assets force row level security;
revoke all on table public.group_news_items, public.group_media_items, public.round_messages, public.coordinator_contact_messages, public.group_branding_assets from public, anon, authenticated, service_role;

-- Storage is private.  The trusted server writes metadata and can issue a
-- signed URL when a retained asset is selected; browser uploads are limited
-- to a group-prefixed path and coordinator/admin membership.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('group-branding', 'group-branding', false, 1048576, array['image/png', 'image/jpeg', 'image/gif', 'image/bmp', 'image/webp']::text[])
on conflict (id) do update set public = false, file_size_limit = 1048576;

drop policy if exists group_branding_objects_read on storage.objects;
drop policy if exists group_branding_objects_insert on storage.objects;
drop policy if exists group_branding_objects_update on storage.objects;
drop policy if exists group_branding_objects_delete on storage.objects;
create policy group_branding_objects_read on storage.objects for select to authenticated
  using (bucket_id = 'group-branding' and (storage.foldername(name))[1] = (select app.active_group_id())::text);
create policy group_branding_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'group-branding' and (storage.foldername(name))[1] = (select app.active_group_id())::text and (select app.active_membership_role()) in ('coordinator', 'administrator'));
create policy group_branding_objects_update on storage.objects for update to authenticated
  using (bucket_id = 'group-branding' and (storage.foldername(name))[1] = (select app.active_group_id())::text and (select app.active_membership_role()) in ('coordinator', 'administrator'))
  with check (bucket_id = 'group-branding' and (storage.foldername(name))[1] = (select app.active_group_id())::text and (select app.active_membership_role()) in ('coordinator', 'administrator'));
create policy group_branding_objects_delete on storage.objects for delete to authenticated
  using (bucket_id = 'group-branding' and (storage.foldername(name))[1] = (select app.active_group_id())::text and (select app.active_membership_role()) in ('coordinator', 'administrator'));

create function app.content_actor_context(p_actor_user_id uuid)
returns table (membership_id uuid, group_id uuid, actor_role public.membership_role, display_name text)
language sql stable security definer set search_path = ''
as $$
  select membership.id, membership.group_id, membership.role,
    pg_catalog.left(pg_catalog.btrim(coalesce(nullif(pg_catalog.concat_ws(' ', golfer.first_name, golfer.last_name), ''), nullif(pg_catalog.concat_ws(' ', profile.first_name, profile.last_name), ''), nullif(profile.display_name, ''), 'Member')), 200)
  from public.memberships membership
  join public.user_profiles profile on profile.user_id = membership.user_id
  left join public.membership_golfer_profiles golfer on golfer.membership_id = membership.id and golfer.group_id = membership.group_id
  join auth.users identity on identity.id = membership.user_id
  where membership.user_id = p_actor_user_id and membership.status = 'active' and profile.disabled_at is null
    and identity.email_confirmed_at is not null and identity.deleted_at is null and not identity.is_anonymous
    and (identity.banned_until is null or identity.banned_until <= pg_catalog.statement_timestamp())
  order by membership.id limit 1;
$$;
revoke all on function app.content_actor_context(uuid) from public, anon, authenticated, service_role;

create function public.read_group_content_for_actor(p_actor_user_id uuid, p_limit integer default 50)
returns table (group_id uuid, group_name text, news_id uuid, news_title text, news_body text, news_author text, news_publish_at timestamptz, media_id uuid, media_title text, media_kind text, media_url text, thumbnail_url text, media_display_from timestamptz, media_display_until timestamptz, media_is_default boolean)
language plpgsql stable security definer set search_path = ''
as $$
declare actor_group_id uuid;
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then raise exception 'content_limit_invalid' using errcode = '22023'; end if;
  select context.group_id into actor_group_id from app.content_actor_context(p_actor_user_id) as context;
  if actor_group_id is null then raise exception 'actor_not_authorized' using errcode = 'P0003'; end if;
  return query
  with news as (
    select n.id, n.title, n.body, n.author_display_name, n.publish_at,
      row_number() over (order by n.publish_at desc nulls last, n.id desc) as position
    from public.group_news_items n
    where n.group_id = actor_group_id and n.state = 'published' and coalesce(n.publish_at, n.created_at) <= pg_catalog.statement_timestamp()
  ), media as (
    select m.id, m.title, m.kind::text, m.media_url, m.thumbnail_url, m.display_from, m.display_until, m.is_default,
      row_number() over (order by m.is_default desc, m.display_from desc nulls last, m.id desc) as position
    from public.group_media_items m
    where m.group_id = actor_group_id and m.state = 'published'
      and (m.display_from is null or m.display_from <= pg_catalog.statement_timestamp())
      and (m.display_until is null or m.display_until > pg_catalog.statement_timestamp())
  )
  select actor_group_id::text::uuid, g.name, n.id::text::uuid, n.title, n.body, n.author_display_name, n.publish_at::text::timestamptz,
    m.id::text::uuid, m.title, m.kind, m.media_url, m.thumbnail_url, m.display_from::text::timestamptz, m.display_until::text::timestamptz, m.is_default
  from public.groups g
  left join news n on n.position <= p_limit
  left join media m on m.position <= p_limit
  where g.id = actor_group_id
  order by n.publish_at desc nulls last, n.id desc, m.is_default desc, m.display_from desc nulls last, m.id desc;
end;
$$;
revoke all on function public.read_group_content_for_actor(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.read_group_content_for_actor(uuid, integer) to service_role;

create function public.resolve_mobile_group_content(p_limit integer default 50)
returns table (group_id uuid, group_name text, news_id uuid, news_title text, news_body text, news_author text, news_publish_at timestamptz, media_id uuid, media_title text, media_kind text, media_url text, thumbnail_url text, media_display_from timestamptz, media_display_until timestamptz, media_is_default boolean)
language sql stable security definer set search_path = ''
as $$ select * from public.read_group_content_for_actor((select auth.uid()), p_limit); $$;
revoke all on function public.resolve_mobile_group_content(integer) from public, anon, service_role;
grant execute on function public.resolve_mobile_group_content(integer) to authenticated;

create function public.save_group_news(p_actor_user_id uuid, p_news_id uuid, p_title text, p_body text, p_state public.content_item_state, p_publish_at timestamptz, p_correlation_id uuid, p_operation_id uuid)
returns table (news_id uuid, group_id uuid, title text, body text, state public.content_item_state, publish_at timestamptz, version bigint)
language plpgsql security definer set search_path = ''
as $$
declare actor record; target public.group_news_items%rowtype; normalized_title text; normalized_body text; now_at timestamptz := pg_catalog.clock_timestamp();
begin
  if p_correlation_id is null or p_operation_id is null then raise exception 'operation_context_required' using errcode = '22004'; end if;
  normalized_title := nullif(pg_catalog.btrim(p_title), ''); normalized_body := nullif(pg_catalog.btrim(p_body), '');
  if normalized_title is null or pg_catalog.length(normalized_title) > 200 or normalized_body is null or pg_catalog.length(normalized_body) > 10000 then raise exception 'content_input_invalid' using errcode = '22023'; end if;
  select * into actor from app.content_actor_context(p_actor_user_id);
  if actor.group_id is null or actor.actor_role not in ('coordinator', 'administrator') then raise exception 'actor_not_authorized' using errcode = 'P0003'; end if;
  if p_state = 'scheduled' and (p_publish_at is null or p_publish_at <= now_at) then raise exception 'content_schedule_invalid' using errcode = '22023'; end if;
  if p_state = 'published' then p_publish_at := coalesce(p_publish_at, now_at); end if;
  if p_news_id is null then
    select item.* into target from public.group_news_items item where item.author_user_id = p_actor_user_id and item.operation_id = p_operation_id;
    if found then return query select target.id::text::uuid, target.group_id::text::uuid, target.title, target.body, target.state, target.publish_at::text::timestamptz, target.version; return; end if;
    insert into public.group_news_items (group_id, author_membership_id, author_user_id, author_display_name, title, body, state, publish_at, archived_at, operation_id)
      values (actor.group_id, actor.membership_id, p_actor_user_id, actor.display_name, normalized_title, normalized_body, p_state, p_publish_at, case when p_state = 'archived' then now_at else null end, p_operation_id)
      returning * into target;
  else
    select item.* into target from public.group_news_items as item where item.id = p_news_id and item.group_id = actor.group_id for update;
    if not found then raise exception 'content_not_found' using errcode = 'P0002'; end if;
    update public.group_news_items as item set title = normalized_title, body = normalized_body, state = p_state, publish_at = p_publish_at, archived_at = case when p_state = 'archived' then coalesce(item.archived_at, now_at) else null end, version = item.version + 1 where item.id = target.id and item.group_id = actor.group_id returning item.* into target;
  end if;
  insert into public.audit_events (group_id, actor_user_id, action, target_type, target_id, target_version, after_state, source, correlation_id, operation_id)
    values (actor.group_id, p_actor_user_id, 'group.news_saved', 'group_news_item', target.id, target.version, pg_catalog.jsonb_build_object('state', target.state, 'version', target.version), 'portal', p_correlation_id, p_operation_id)
    on conflict do nothing;
  return query select target.id::text::uuid, target.group_id::text::uuid, target.title, target.body, target.state, target.publish_at::text::timestamptz, target.version;
end;
$$;
revoke all on function public.save_group_news(uuid, uuid, text, text, public.content_item_state, timestamptz, uuid, uuid) from public, anon, authenticated;
grant execute on function public.save_group_news(uuid, uuid, text, text, public.content_item_state, timestamptz, uuid, uuid) to service_role;

create function public.save_group_media(p_actor_user_id uuid, p_media_id uuid, p_title text, p_kind public.media_item_kind, p_media_url text, p_thumbnail_url text, p_display_from timestamptz, p_display_until timestamptz, p_is_default boolean, p_state public.content_item_state, p_correlation_id uuid, p_operation_id uuid)
returns table (media_id uuid, group_id uuid, title text, kind public.media_item_kind, media_url text, thumbnail_url text, state public.content_item_state, version bigint)
language plpgsql security definer set search_path = ''
as $$
declare actor record; target public.group_media_items%rowtype; normalized_title text;
begin
  if p_correlation_id is null or p_operation_id is null then raise exception 'operation_context_required' using errcode = '22004'; end if;
  normalized_title := nullif(pg_catalog.btrim(p_title), '');
  if normalized_title is null or pg_catalog.length(normalized_title) > 200 or p_media_url is null or p_media_url !~ '^https://[^[:space:]]+$' then raise exception 'media_input_invalid' using errcode = '22023'; end if;
  if p_display_until is not null and p_display_from is not null and p_display_until <= p_display_from then raise exception 'media_display_window_invalid' using errcode = '22023'; end if;
  select * into actor from app.content_actor_context(p_actor_user_id);
  if actor.group_id is null or actor.actor_role not in ('coordinator', 'administrator') then raise exception 'actor_not_authorized' using errcode = 'P0003'; end if;
  if p_media_id is null then
    select item.* into target from public.group_media_items item where item.author_user_id = p_actor_user_id and item.operation_id = p_operation_id;
    if found then return query select target.id::text::uuid, target.group_id::text::uuid, target.title, target.kind, target.media_url, target.thumbnail_url, target.state, target.version; return; end if;
    insert into public.group_media_items (group_id, author_membership_id, author_user_id, title, kind, media_url, thumbnail_url, display_from, display_until, is_default, state, operation_id)
      values (actor.group_id, actor.membership_id, p_actor_user_id, normalized_title, p_kind, pg_catalog.btrim(p_media_url), nullif(pg_catalog.btrim(p_thumbnail_url), ''), p_display_from, p_display_until, coalesce(p_is_default, false), p_state, p_operation_id)
      returning * into target;
  else
    select item.* into target from public.group_media_items as item where item.id = p_media_id and item.group_id = actor.group_id for update;
    if not found then raise exception 'content_not_found' using errcode = 'P0002'; end if;
    update public.group_media_items as item set title = normalized_title, kind = p_kind, media_url = pg_catalog.btrim(p_media_url), thumbnail_url = nullif(pg_catalog.btrim(p_thumbnail_url), ''), display_from = p_display_from, display_until = p_display_until, is_default = coalesce(p_is_default, false), state = p_state, version = item.version + 1 where item.id = target.id and item.group_id = actor.group_id returning item.* into target;
  end if;
  if target.is_default then update public.group_media_items as item set is_default = false where item.group_id = target.group_id and item.id <> target.id and item.is_default; end if;
  insert into public.audit_events (group_id, actor_user_id, action, target_type, target_id, target_version, after_state, source, correlation_id, operation_id)
    values (actor.group_id, p_actor_user_id, 'group.media_saved', 'group_media_item', target.id, target.version, pg_catalog.jsonb_build_object('state', target.state, 'version', target.version), 'portal', p_correlation_id, p_operation_id)
    on conflict do nothing;
  return query select target.id::text::uuid, target.group_id::text::uuid, target.title, target.kind, target.media_url, target.thumbnail_url, target.state, target.version;
end;
$$;
revoke all on function public.save_group_media(uuid, uuid, text, public.media_item_kind, text, text, timestamptz, timestamptz, boolean, public.content_item_state, uuid, uuid) from public, anon, authenticated;
grant execute on function public.save_group_media(uuid, uuid, text, public.media_item_kind, text, text, timestamptz, timestamptz, boolean, public.content_item_state, uuid, uuid) to service_role;

create function public.post_round_message(p_actor_user_id uuid, p_round_id uuid, p_body text, p_correlation_id uuid, p_operation_id uuid)
returns table (message_id uuid, group_id uuid, round_id uuid, author_display_name text, author_role public.membership_role, body text, created_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare actor record; target_round public.rounds%rowtype; target public.round_messages%rowtype; normalized_body text;
begin
  if p_correlation_id is null or p_operation_id is null then raise exception 'operation_context_required' using errcode = '22004'; end if;
  normalized_body := nullif(pg_catalog.btrim(p_body), '');
  if normalized_body is null or pg_catalog.length(normalized_body) > 300 then raise exception 'round_message_invalid' using errcode = '22023'; end if;
  select * into actor from app.content_actor_context(p_actor_user_id);
  if actor.group_id is null then raise exception 'actor_not_authorized' using errcode = 'P0003'; end if;
  select round_record.* into target_round from public.rounds as round_record where round_record.id = p_round_id::app.entity_id and round_record.group_id = actor.group_id for share;
  if not found or target_round.state not in ('published', 'live', 'completed') then raise exception 'round_message_unavailable' using errcode = 'P0002'; end if;
  if actor.actor_role = 'member' and not exists (select 1 from public.round_participants p where p.round_id = p_round_id::app.entity_id and p.group_id = actor.group_id and p.membership_id = actor.membership_id) then raise exception 'actor_not_authorized' using errcode = 'P0003'; end if;
  select message.* into target from public.round_messages message where message.author_user_id = p_actor_user_id and message.operation_id = p_operation_id;
    if found then return query select target.id::text::uuid, target.group_id::text::uuid, target.round_id::text::uuid, target.author_display_name, target.author_role, target.body, target.created_at::text::timestamptz; return; end if;
  insert into public.round_messages (group_id, round_id, author_membership_id, author_user_id, author_role, author_display_name, body, operation_id)
    values (actor.group_id, p_round_id::app.entity_id, actor.membership_id, p_actor_user_id, actor.actor_role, actor.display_name, normalized_body, p_operation_id) returning * into target;
  insert into public.audit_events (group_id, actor_user_id, action, target_type, target_id, target_version, after_state, source, correlation_id, operation_id)
    values (actor.group_id, p_actor_user_id, 'round.message_posted', 'round_message', target.id, target.version, pg_catalog.jsonb_build_object('round_id', target.round_id), 'member_app', p_correlation_id, p_operation_id)
    on conflict do nothing;
  return query select target.id::text::uuid, target.group_id::text::uuid, target.round_id::text::uuid, target.author_display_name, target.author_role, target.body, target.created_at::text::timestamptz;
end;
$$;
revoke all on function public.post_round_message(uuid, uuid, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.post_round_message(uuid, uuid, text, uuid, uuid) to service_role;

create function public.resolve_mobile_round_messages(p_round_id uuid)
returns table (message_id uuid, group_id uuid, round_id uuid, author_display_name text, author_role public.membership_role, body text, created_at timestamptz, removed_at timestamptz, removal_reason text)
language sql stable security definer set search_path = ''
as $$
  select m.id, m.group_id, m.round_id, m.author_display_name, m.author_role, case when m.removed_at is null then m.body else null end, m.created_at, m.removed_at, m.removal_reason
  from public.round_messages m
  join public.rounds r on r.id = m.round_id and r.group_id = m.group_id
  join public.memberships membership on membership.user_id = (select auth.uid()) and membership.group_id = m.group_id and membership.status = 'active'
  where m.round_id = p_round_id::app.entity_id
    and (membership.role in ('coordinator', 'administrator') or exists (select 1 from public.round_participants p where p.round_id = m.round_id and p.group_id = m.group_id and p.membership_id = membership.id))
  order by m.created_at asc, m.id asc;
$$;
revoke all on function public.resolve_mobile_round_messages(uuid) from public, anon, service_role;
grant execute on function public.resolve_mobile_round_messages(uuid) to authenticated;

create function public.read_round_messages_for_actor(p_actor_user_id uuid, p_round_id uuid)
returns table (message_id uuid, group_id uuid, round_id uuid, author_display_name text, author_role public.membership_role, body text, created_at timestamptz, removed_at timestamptz, removal_reason text)
language plpgsql stable security definer set search_path = ''
as $$
declare actor record; target_group_id uuid;
begin
  select * into actor from app.content_actor_context(p_actor_user_id);
  if actor.group_id is null then raise exception 'actor_not_authorized' using errcode = 'P0003'; end if;
  select r.group_id into target_group_id from public.rounds r where r.id = p_round_id::app.entity_id and r.group_id = actor.group_id;
  if target_group_id is null then raise exception 'round_message_unavailable' using errcode = 'P0002'; end if;
  if actor.actor_role = 'member' and not exists (select 1 from public.round_participants p where p.round_id = p_round_id::app.entity_id and p.group_id = actor.group_id and p.membership_id = actor.membership_id) then raise exception 'actor_not_authorized' using errcode = 'P0003'; end if;
  return query select m.id::text::uuid, m.group_id::text::uuid, m.round_id::text::uuid, m.author_display_name, m.author_role, case when m.removed_at is null then m.body else null end, m.created_at::text::timestamptz, m.removed_at::text::timestamptz, m.removal_reason
    from public.round_messages m where m.round_id = p_round_id::app.entity_id and m.group_id = actor.group_id order by m.created_at asc, m.id asc;
end;
$$;
revoke all on function public.read_round_messages_for_actor(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.read_round_messages_for_actor(uuid, uuid) to service_role;

create function public.post_mobile_round_message(p_round_id uuid, p_body text, p_correlation_id uuid, p_operation_id uuid)
returns table (message_id uuid, group_id uuid, round_id uuid, author_display_name text, author_role public.membership_role, body text, created_at timestamptz)
language sql security definer set search_path = ''
as $$ select * from public.post_round_message((select auth.uid()), p_round_id, p_body, p_correlation_id, p_operation_id); $$;
revoke all on function public.post_mobile_round_message(uuid, text, uuid, uuid) from public, anon, service_role;
grant execute on function public.post_mobile_round_message(uuid, text, uuid, uuid) to authenticated;

create function public.remove_round_message(p_actor_user_id uuid, p_message_id uuid, p_reason text, p_correlation_id uuid, p_operation_id uuid)
returns table (message_id uuid, removed_at timestamptz, version bigint)
language plpgsql security definer set search_path = ''
as $$
declare actor record; target public.round_messages%rowtype; normalized_reason text; now_at timestamptz := pg_catalog.clock_timestamp();
begin
  if p_correlation_id is null or p_operation_id is null then raise exception 'operation_context_required' using errcode = '22004'; end if;
  normalized_reason := nullif(pg_catalog.btrim(p_reason), '');
  if normalized_reason is null or pg_catalog.length(normalized_reason) > 500 then raise exception 'round_message_reason_invalid' using errcode = '22023'; end if;
  select * into actor from app.content_actor_context(p_actor_user_id);
  if actor.group_id is null or actor.actor_role not in ('coordinator', 'administrator') then raise exception 'actor_not_authorized' using errcode = 'P0003'; end if;
  select message.* into target from public.round_messages as message where message.id = p_message_id and message.group_id = actor.group_id for update;
  if not found then raise exception 'round_message_not_found' using errcode = 'P0002'; end if;
  if target.removed_at is null then update public.round_messages as message set removed_at = now_at, removed_by_user_id = p_actor_user_id, removal_reason = normalized_reason, version = message.version + 1 where message.id = target.id returning message.* into target; end if;
  insert into public.audit_events (group_id, actor_user_id, action, target_type, target_id, target_version, after_state, source, correlation_id, operation_id, reason)
    values (actor.group_id, p_actor_user_id, 'round.message_removed', 'round_message', target.id, target.version, pg_catalog.jsonb_build_object('round_id', target.round_id, 'removed_at', target.removed_at), 'portal', p_correlation_id, p_operation_id, normalized_reason)
    on conflict do nothing;
  return query select target.id::text::uuid, target.removed_at::text::timestamptz, target.version;
end;
$$;
revoke all on function public.remove_round_message(uuid, uuid, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.remove_round_message(uuid, uuid, text, uuid, uuid) to service_role;

create function public.send_coordinator_contact(p_actor_user_id uuid, p_recipient_membership_id uuid, p_body text, p_correlation_id uuid, p_operation_id uuid)
returns table (message_id uuid, group_id uuid, recipient_display_name text, body text, created_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare actor record; recipient record; target public.coordinator_contact_messages%rowtype; normalized_body text;
begin
  if p_correlation_id is null or p_operation_id is null then raise exception 'operation_context_required' using errcode = '22004'; end if;
  normalized_body := nullif(pg_catalog.btrim(p_body), '');
  if normalized_body is null or pg_catalog.length(normalized_body) > 2000 then raise exception 'coordinator_contact_invalid' using errcode = '22023'; end if;
  select * into actor from app.content_actor_context(p_actor_user_id);
  if actor.group_id is null then raise exception 'actor_not_authorized' using errcode = 'P0003'; end if;
  select m.id, m.user_id, m.role, pg_catalog.left(pg_catalog.btrim(coalesce(nullif(pg_catalog.concat_ws(' ', gp.first_name, gp.last_name), ''), nullif(pg_catalog.concat_ws(' ', up.first_name, up.last_name), ''), nullif(up.display_name, ''), 'Coordinator')), 200) as display_name
    into recipient from public.memberships m join public.user_profiles up on up.user_id = m.user_id left join public.membership_golfer_profiles gp on gp.membership_id = m.id and gp.group_id = m.group_id
    where m.id = p_recipient_membership_id and m.group_id = actor.group_id and m.status = 'active' and m.role in ('coordinator', 'administrator');
  if recipient.id is null or recipient.user_id is null then raise exception 'coordinator_not_found' using errcode = 'P0002'; end if;
  select message.* into target from public.coordinator_contact_messages message where message.sender_user_id = p_actor_user_id and message.operation_id = p_operation_id;
  if found then return query select target.id::text::uuid, target.group_id::text::uuid, target.recipient_display_name, target.body, target.created_at::text::timestamptz; return; end if;
  insert into public.coordinator_contact_messages (group_id, sender_membership_id, recipient_membership_id, sender_user_id, recipient_user_id, sender_display_name, recipient_display_name, body, operation_id)
    values (actor.group_id, actor.membership_id, recipient.id, p_actor_user_id, recipient.user_id, actor.display_name, recipient.display_name, normalized_body, p_operation_id) returning * into target;
  insert into public.audit_events (group_id, actor_user_id, action, target_type, target_id, target_version, after_state, source, correlation_id, operation_id)
    values (actor.group_id, p_actor_user_id, 'coordinator.contact_sent', 'coordinator_contact_message', target.id, 1, pg_catalog.jsonb_build_object('recipient_membership_id', recipient.id), 'member_app', p_correlation_id, p_operation_id)
    on conflict do nothing;
  return query select target.id::text::uuid, target.group_id::text::uuid, target.recipient_display_name, target.body, target.created_at::text::timestamptz;
end;
$$;
revoke all on function public.send_coordinator_contact(uuid, uuid, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.send_coordinator_contact(uuid, uuid, text, uuid, uuid) to service_role;

create function public.resolve_mobile_coordinator_contacts()
returns table (message_id uuid, group_id uuid, sender_display_name text, recipient_display_name text, body text, created_at timestamptz, sent_by_actor boolean)
language sql stable security definer set search_path = ''
as $$
  select m.id, m.group_id, m.sender_display_name, m.recipient_display_name, m.body, m.created_at, m.sender_user_id = (select auth.uid())
  from public.coordinator_contact_messages m
  where m.sender_user_id = (select auth.uid()) or m.recipient_user_id = (select auth.uid())
  order by m.created_at desc, m.id desc limit 100;
$$;
revoke all on function public.resolve_mobile_coordinator_contacts() from public, anon, service_role;
grant execute on function public.resolve_mobile_coordinator_contacts() to authenticated;

create function public.read_coordinator_contacts_for_actor(p_actor_user_id uuid)
returns table (message_id uuid, group_id uuid, sender_display_name text, recipient_display_name text, body text, created_at timestamptz, sent_by_actor boolean)
language sql stable security definer set search_path = ''
as $$
  select m.id, m.group_id, m.sender_display_name, m.recipient_display_name, m.body, m.created_at, m.sender_user_id = p_actor_user_id
  from public.coordinator_contact_messages m
  where m.sender_user_id = p_actor_user_id or m.recipient_user_id = p_actor_user_id
  order by m.created_at desc, m.id desc limit 100;
$$;
revoke all on function public.read_coordinator_contacts_for_actor(uuid) from public, anon, authenticated, service_role;
grant execute on function public.read_coordinator_contacts_for_actor(uuid) to service_role;

create function public.send_mobile_coordinator_contact(p_recipient_membership_id uuid, p_body text, p_correlation_id uuid, p_operation_id uuid)
returns table (message_id uuid, group_id uuid, recipient_display_name text, body text, created_at timestamptz)
language sql security definer set search_path = ''
as $$ select * from public.send_coordinator_contact((select auth.uid()), p_recipient_membership_id, p_body, p_correlation_id, p_operation_id); $$;
revoke all on function public.send_mobile_coordinator_contact(uuid, text, uuid, uuid) from public, anon, service_role;
grant execute on function public.send_mobile_coordinator_contact(uuid, text, uuid, uuid) to authenticated;

create function public.resolve_mobile_coordinators()
returns table (membership_id uuid, display_name text, role public.membership_role)
language sql stable security definer set search_path = ''
as $$
  select m.id, pg_catalog.left(pg_catalog.btrim(coalesce(nullif(pg_catalog.concat_ws(' ', gp.first_name, gp.last_name), ''), nullif(pg_catalog.concat_ws(' ', up.first_name, up.last_name), ''), nullif(up.display_name, ''), 'Coordinator')), 200), m.role
  from public.memberships m join public.user_profiles up on up.user_id = m.user_id
  left join public.membership_golfer_profiles gp on gp.membership_id = m.id and gp.group_id = m.group_id
  where m.group_id = (select app.active_group_id()) and m.status = 'active' and m.role in ('coordinator', 'administrator')
  order by case when m.role = 'administrator' then 0 else 1 end, m.id;
$$;
revoke all on function public.resolve_mobile_coordinators() from public, anon, service_role;
grant execute on function public.resolve_mobile_coordinators() to authenticated;

create function public.save_group_branding_asset(p_actor_user_id uuid, p_asset_id uuid, p_slot public.branding_asset_slot, p_storage_path text, p_asset_url text, p_mime_type text, p_byte_size integer, p_alt_text text, p_decorative boolean, p_click_url text, p_display_order smallint, p_correlation_id uuid, p_operation_id uuid)
returns table (asset_id uuid, group_id uuid, slot public.branding_asset_slot, asset_url text, storage_path text, version bigint)
language plpgsql security definer set search_path = ''
as $$
declare actor record; target public.group_branding_assets%rowtype; max_bytes integer;
begin
  if p_correlation_id is null or p_operation_id is null then raise exception 'operation_context_required' using errcode = '22004'; end if;
  select * into actor from app.content_actor_context(p_actor_user_id);
  if actor.group_id is null or actor.actor_role <> 'administrator' then raise exception 'actor_not_authorized' using errcode = 'P0003'; end if;
  max_bytes := case when p_slot in ('email_header', 'email_footer') then 512000 else 1048576 end;
  if p_asset_url is null or p_asset_url !~ '^https://[^[:space:]]+$' or p_mime_type not in ('image/png', 'image/jpeg', 'image/gif', 'image/bmp', 'image/webp') or p_byte_size is null or p_byte_size < 1 or p_byte_size > max_bytes then raise exception 'branding_asset_invalid' using errcode = '22023'; end if;
  if not coalesce(p_decorative, false) and nullif(pg_catalog.btrim(p_alt_text), '') is null then raise exception 'branding_alt_text_required' using errcode = '22023'; end if;
  if p_click_url is not null and p_click_url !~ '^https://[^[:space:]]+$' then raise exception 'branding_click_url_invalid' using errcode = '22023'; end if;
  if p_asset_id is null then
    select asset.* into target from public.group_branding_assets asset where asset.created_by_user_id = p_actor_user_id and asset.operation_id = p_operation_id;
    if found then return query select target.id::text::uuid, target.group_id::text::uuid, target.slot, target.asset_url, target.storage_path, target.version; return; end if;
    insert into public.group_branding_assets (group_id, slot, storage_path, asset_url, mime_type, byte_size, alt_text, decorative, click_url, display_order, created_by_user_id, operation_id)
      values (actor.group_id, p_slot, nullif(pg_catalog.btrim(p_storage_path), ''), p_asset_url, p_mime_type, p_byte_size, nullif(pg_catalog.btrim(p_alt_text), ''), coalesce(p_decorative, false), p_click_url, coalesce(p_display_order, 0), p_actor_user_id, p_operation_id) returning * into target;
  else
    select asset.* into target from public.group_branding_assets as asset where asset.id = p_asset_id and asset.group_id = actor.group_id for update;
    if not found then raise exception 'branding_asset_not_found' using errcode = 'P0002'; end if;
    update public.group_branding_assets as asset set slot = p_slot, storage_path = nullif(pg_catalog.btrim(p_storage_path), ''), asset_url = p_asset_url, mime_type = p_mime_type, byte_size = p_byte_size, alt_text = nullif(pg_catalog.btrim(p_alt_text), ''), decorative = coalesce(p_decorative, false), click_url = p_click_url, display_order = coalesce(p_display_order, 0), version = asset.version + 1 where asset.id = target.id returning asset.* into target;
  end if;
  insert into public.audit_events (group_id, actor_user_id, action, target_type, target_id, target_version, after_state, source, correlation_id, operation_id)
    values (actor.group_id, p_actor_user_id, 'group.branding_saved', 'group_branding_asset', target.id, target.version, pg_catalog.jsonb_build_object('slot', target.slot, 'version', target.version), 'portal', p_correlation_id, p_operation_id)
    on conflict do nothing;
  return query select target.id::text::uuid, target.group_id::text::uuid, target.slot, target.asset_url, target.storage_path, target.version;
end;
$$;
revoke all on function public.save_group_branding_asset(uuid, uuid, public.branding_asset_slot, text, text, text, integer, text, boolean, text, smallint, uuid, uuid) from public, anon, authenticated;
grant execute on function public.save_group_branding_asset(uuid, uuid, public.branding_asset_slot, text, text, text, integer, text, boolean, text, smallint, uuid, uuid) to service_role;

create function public.read_public_scoreboard_branding(p_token text)
returns table (slot public.branding_asset_slot, asset_url text, alt_text text, decorative boolean, click_url text, display_order smallint)
language sql stable security definer set search_path = ''
as $$
  select asset.slot, asset.asset_url, asset.alt_text, asset.decorative, asset.click_url, asset.display_order
  from public.scoreboard_access_grants grant_record join public.group_branding_assets asset on asset.group_id = grant_record.group_id
  where p_token is not null and p_token ~ '^[A-Za-z0-9_-]{43,128}$'
    and grant_record.token_digest_sha256 = pg_catalog.encode(extensions.digest(pg_catalog.convert_to(p_token, 'UTF8'), 'sha256'), 'hex')
    and grant_record.state = 'active' and grant_record.expires_at > pg_catalog.statement_timestamp()
    and asset.slot in ('scoreboard_header', 'scoreboard_footer')
  order by asset.slot, asset.display_order, asset.id;
$$;
revoke all on function public.read_public_scoreboard_branding(text) from public, authenticated, service_role;
grant execute on function public.read_public_scoreboard_branding(text) to anon;
