-- Keep scoreboard branding in the private Storage bucket.  The public
-- scoreboard route receives only a storage path through a service-only RPC;
-- the web server turns that path into a short-lived signed URL.

alter table public.group_branding_assets
  add constraint group_branding_assets_storage_group_match
  check (
    storage_path is null
    or pg_catalog.split_part(storage_path, '/', 1) = group_id::text
  ) not valid;

create or replace function app.validate_group_branding_asset_storage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.storage_path is null
    or pg_catalog.btrim(new.storage_path) = ''
    or new.storage_path !~ '^[0-9a-fA-F-]{36}/[A-Za-z0-9][A-Za-z0-9._/-]*$'
    or pg_catalog.split_part(new.storage_path, '/', 1) <> new.group_id::text then
    raise exception 'branding_storage_path_invalid' using errcode = '22023';
  end if;

  if new.slot = 'scoreboard_header' and new.display_order <> 0 then
    raise exception 'branding_header_order_invalid' using errcode = '22023';
  end if;

  if new.slot = 'scoreboard_footer' and new.display_order not between 0 and 2 then
    raise exception 'branding_footer_order_invalid' using errcode = '22023';
  end if;

  return new;
end;
$$;
revoke all on function app.validate_group_branding_asset_storage() from public, anon, authenticated, service_role;

drop trigger if exists group_branding_assets_validate_storage on public.group_branding_assets;
create trigger group_branding_assets_validate_storage
before insert or update of group_id, slot, storage_path, display_order
on public.group_branding_assets
for each row execute function app.validate_group_branding_asset_storage();

create or replace function public.read_public_scoreboard_branding(p_token text)
returns table (slot public.branding_asset_slot, asset_url text, alt_text text, decorative boolean, click_url text, display_order smallint)
language sql stable security definer set search_path = ''
as $$
  select asset.slot, asset.asset_url, asset.alt_text, asset.decorative, asset.click_url, asset.display_order
  from public.scoreboard_access_grants grant_record
  join public.group_branding_assets asset on asset.group_id = grant_record.group_id
  where p_token is not null and p_token ~ '^[A-Za-z0-9_-]{43,128}$'
    and grant_record.token_digest_sha256 = pg_catalog.encode(extensions.digest(pg_catalog.convert_to(p_token, 'UTF8'), 'sha256'), 'hex')
    and grant_record.state = 'active' and grant_record.expires_at > pg_catalog.statement_timestamp()
    and asset.storage_path is not null
    and pg_catalog.split_part(asset.storage_path, '/', 1) = asset.group_id::text
    and asset.slot in ('scoreboard_header', 'scoreboard_footer')
  order by asset.slot, asset.display_order, asset.id;
$$;
revoke all on function public.read_public_scoreboard_branding(text) from public, anon, authenticated, service_role;
grant execute on function public.read_public_scoreboard_branding(text) to service_role;

create function public.read_public_scoreboard_branding_storage(p_token text)
returns table (slot public.branding_asset_slot, storage_path text, alt_text text, decorative boolean, click_url text, display_order smallint)
language sql stable security definer set search_path = ''
as $$
  select asset.slot, asset.storage_path, asset.alt_text, asset.decorative, asset.click_url, asset.display_order
  from public.scoreboard_access_grants grant_record
  join public.group_branding_assets asset on asset.group_id = grant_record.group_id
  where p_token is not null and p_token ~ '^[A-Za-z0-9_-]{43,128}$'
    and grant_record.token_digest_sha256 = pg_catalog.encode(extensions.digest(pg_catalog.convert_to(p_token, 'UTF8'), 'sha256'), 'hex')
    and grant_record.state = 'active' and grant_record.expires_at > pg_catalog.statement_timestamp()
    and asset.storage_path is not null
    and pg_catalog.split_part(asset.storage_path, '/', 1) = asset.group_id::text
    and asset.slot in ('scoreboard_header', 'scoreboard_footer')
  order by asset.slot, asset.display_order, asset.id;
$$;
revoke all on function public.read_public_scoreboard_branding_storage(text) from public, anon, authenticated, service_role;
grant execute on function public.read_public_scoreboard_branding_storage(text) to service_role;

comment on function public.read_public_scoreboard_branding_storage(text) is
  'Service-only token-scoped projection of private scoreboard branding paths; callers must issue signed Storage URLs without exposing the path to the browser.';
