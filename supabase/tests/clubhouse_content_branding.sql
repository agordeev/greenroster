begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

select has_table('public', 'group_news_items', 'group news is persisted');
select has_table('public', 'group_media_items', 'group media is persisted');
select has_table('public', 'round_messages', 'round messages are persisted');
select has_table('public', 'coordinator_contact_messages', 'coordinator contact is persisted');
select has_table('public', 'group_branding_assets', 'branding assets are persisted');

select ok((select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid = 'public.group_news_items'::regclass), 'news uses force RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid = 'public.round_messages'::regclass), 'round messages use force RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid = 'public.group_branding_assets'::regclass), 'branding uses force RLS');
select has_function('app', 'validate_group_branding_asset_storage', array[]::text[], 'branding storage is validated by a server trigger');
select ok(
  exists (
    select 1
    from pg_catalog.pg_trigger
    where tgrelid = 'public.group_branding_assets'::regclass
      and tgname = 'group_branding_assets_validate_storage'
      and not tgenabled = 'D'
  ),
  'branding storage validation trigger is enabled'
);
select ok(
  (select pg_catalog.strpos(pg_catalog.pg_get_constraintdef(oid), 'split_part(storage_path') > 0
   from pg_catalog.pg_constraint
   where conrelid = 'public.group_branding_assets'::regclass
     and conname = 'group_branding_assets_storage_group_match'),
  'legacy branding paths are quarantined to their owning group'
);
select is(
  (select count(*)::integer
   from pg_catalog.pg_policies
   where schemaname = 'storage'
     and tablename = 'objects'
     and policyname like 'group_branding_objects_%'),
  0,
  'branding Storage objects are not directly writable or readable by browser roles'
);

select has_function('public', 'resolve_mobile_group_content', array['integer'], 'members can read group content through a scoped RPC');
select has_function('public', 'resolve_mobile_round_messages', array['uuid'], 'members can read round messages through a scoped RPC');
select has_function('public', 'post_mobile_round_message', array['uuid', 'text', 'uuid', 'uuid'], 'members can post round messages through a scoped RPC');
select has_function('public', 'send_mobile_coordinator_contact', array['uuid', 'text', 'uuid', 'uuid'], 'members can contact a coordinator through a scoped RPC');
select has_function('public', 'read_public_scoreboard_branding', array['text'], 'legacy scoreboard branding projection remains available to the server');
select has_function('public', 'read_public_scoreboard_branding_storage', array['text'], 'private scoreboard branding paths are token scoped');
select has_function('public', 'read_group_branding_assets_for_actor', array['uuid'], 'administrators can list their own branding assets through a scoped RPC');
select has_function('public', 'remove_group_branding_asset', array['uuid', 'uuid', 'uuid', 'uuid'], 'administrators can remove their own branding assets through a scoped RPC');

select ok(
  has_function_privilege('authenticated', 'public.resolve_mobile_group_content(integer)', 'execute')
  and not has_function_privilege('anon', 'public.resolve_mobile_group_content(integer)', 'execute')
  and has_function_privilege('service_role', 'public.read_public_scoreboard_branding_storage(text)', 'execute')
  and has_function_privilege('service_role', 'public.read_group_branding_assets_for_actor(uuid)', 'execute')
  and has_function_privilege('service_role', 'public.remove_group_branding_asset(uuid, uuid, uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.read_group_branding_assets_for_actor(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.remove_group_branding_asset(uuid, uuid, uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.read_public_scoreboard_branding_storage(text)', 'execute')
  and not has_function_privilege('anon', 'public.read_public_scoreboard_branding(text)', 'execute'),
  'member content is authenticated while branding paths stay service-only'
);

rollback;
