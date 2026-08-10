-- Administrator-only listing/removal closes the private Storage lifecycle:
-- replace an occupied slot atomically, then remove the superseded object;
-- remove a slot through an audited, tenant-scoped RPC.

create function public.read_group_branding_assets_for_actor(p_actor_user_id uuid)
returns table (
  asset_id uuid,
  group_id uuid,
  slot public.branding_asset_slot,
  storage_path text,
  mime_type text,
  byte_size integer,
  alt_text text,
  decorative boolean,
  click_url text,
  display_order smallint,
  version bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare actor record;
begin
  select * into actor from app.content_actor_context(p_actor_user_id);
  if actor.group_id is null or actor.actor_role <> 'administrator' then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  return query
  select asset.id::uuid, asset.group_id::uuid, asset.slot, asset.storage_path,
    asset.mime_type, asset.byte_size, asset.alt_text, asset.decorative,
    asset.click_url, asset.display_order, asset.version
  from public.group_branding_assets as asset
  where asset.group_id = actor.group_id
    and asset.slot in ('scoreboard_header', 'scoreboard_footer')
  order by asset.slot, asset.display_order, asset.id;
end;
$$;
revoke all on function public.read_group_branding_assets_for_actor(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.read_group_branding_assets_for_actor(uuid)
to service_role;

create function public.remove_group_branding_asset(
  p_actor_user_id uuid,
  p_asset_id uuid,
  p_correlation_id uuid,
  p_operation_id uuid
)
returns table (asset_id uuid, group_id uuid, storage_path text, version bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare actor record;
declare target public.group_branding_assets%rowtype;
begin
  if p_correlation_id is null or p_operation_id is null then
    raise exception 'operation_context_required' using errcode = '22004';
  end if;

  select * into actor from app.content_actor_context(p_actor_user_id);
  if actor.group_id is null or actor.actor_role <> 'administrator' then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  select asset.* into target
  from public.group_branding_assets as asset
  where asset.id = p_asset_id and asset.group_id = actor.group_id
  for update;
  if not found then
    raise exception 'branding_asset_not_found' using errcode = 'P0002';
  end if;

  delete from public.group_branding_assets where id = target.id;
  insert into public.audit_events (
    group_id, actor_user_id, action, target_type, target_id, target_version,
    after_state, source, correlation_id, operation_id
  ) values (
    actor.group_id, p_actor_user_id, 'group.branding_removed',
    'group_branding_asset', target.id, target.version,
    pg_catalog.jsonb_build_object('slot', target.slot, 'version', target.version),
    'portal', p_correlation_id, p_operation_id
  ) on conflict do nothing;

  return query select target.id::uuid, target.group_id::uuid, target.storage_path, target.version;
end;
$$;
revoke all on function public.remove_group_branding_asset(uuid, uuid, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.remove_group_branding_asset(uuid, uuid, uuid, uuid)
to service_role;
