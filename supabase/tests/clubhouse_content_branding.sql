begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

select has_table('public', 'group_news_items', 'group news is persisted');
select has_table('public', 'group_media_items', 'group media is persisted');
select has_table('public', 'round_messages', 'round messages are persisted');
select has_table('public', 'coordinator_contact_messages', 'coordinator contact is persisted');
select has_table('public', 'group_branding_assets', 'branding assets are persisted');

select ok((select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid = 'public.group_news_items'::regclass), 'news uses force RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid = 'public.round_messages'::regclass), 'round messages use force RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid = 'public.group_branding_assets'::regclass), 'branding uses force RLS');

select has_function('public', 'resolve_mobile_group_content', array['integer'], 'members can read group content through a scoped RPC');
select has_function('public', 'resolve_mobile_round_messages', array['uuid'], 'members can read round messages through a scoped RPC');
select has_function('public', 'post_mobile_round_message', array['uuid', 'text', 'uuid', 'uuid'], 'members can post round messages through a scoped RPC');
select has_function('public', 'send_mobile_coordinator_contact', array['uuid', 'text', 'uuid', 'uuid'], 'members can contact a coordinator through a scoped RPC');
select has_function('public', 'read_public_scoreboard_branding', array['text'], 'scoreboard branding is token scoped');

select ok(
  has_function_privilege('authenticated', 'public.resolve_mobile_group_content(integer)', 'execute')
  and not has_function_privilege('anon', 'public.resolve_mobile_group_content(integer)', 'execute')
  and has_function_privilege('anon', 'public.read_public_scoreboard_branding(text)', 'execute'),
  'member content is authenticated while scoreboard branding is token public'
);

rollback;
