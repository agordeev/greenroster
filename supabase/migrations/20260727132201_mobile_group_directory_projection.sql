-- Phase 02: authenticated mobile group and privacy-safe active directory.
--
-- The actor is taken from auth.uid(), never from a client-supplied tenant or
-- user id. The existing service-only directory projection supplies the
-- field-level privacy decisions; this boundary only adds mobile filtering
-- and the group envelope.

create function public.resolve_mobile_group_directory(
  p_search text default null,
  p_alphabet text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := (select auth.uid());
  actor_group_id uuid;
  actor_group_name text;
  actor_group_time_zone text;
  normalized_search text;
  normalized_alphabet text;
begin
  select membership.group_id
  into actor_group_id
  from public.memberships as membership
  join public.user_profiles as profile on profile.user_id = membership.user_id
  join auth.users as identity on identity.id = membership.user_id
  where membership.user_id = actor_user_id
    and membership.status = 'active'
    and profile.disabled_at is null
    and identity.email_confirmed_at is not null
    and identity.deleted_at is null
    and not identity.is_anonymous
    and (identity.banned_until is null or identity.banned_until <= pg_catalog.statement_timestamp());

  if actor_group_id is null then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  normalized_search := nullif(
    pg_catalog.regexp_replace(
      pg_catalog.lower(pg_catalog.btrim(p_search)),
      '[[:space:]]+',
      ' ',
      'g'
    ),
    ''
  );
  if normalized_search is not null and pg_catalog.length(normalized_search) > 200 then
    raise exception 'mobile_directory_search_invalid' using errcode = '22023';
  end if;

  normalized_alphabet := nullif(pg_catalog.upper(pg_catalog.btrim(p_alphabet)), '');
  if normalized_alphabet is not null
    and normalized_alphabet !~ '^[A-Z]$'
  then
    raise exception 'mobile_directory_alphabet_invalid' using errcode = '22023';
  end if;

  select group_record.name, group_record.time_zone::text
  into actor_group_name, actor_group_time_zone
  from public.groups as group_record
  where group_record.id = actor_group_id;

  return (
    with directory_rows as (
      select directory.*
      from public.list_member_directory(actor_user_id) as directory
      where directory.group_id = actor_group_id
    ),
    normalized_rows as (
      select
        directory_rows.*,
        pg_catalog.lower(
          pg_catalog.regexp_replace(
            pg_catalog.btrim(
              coalesce(directory_rows.first_name, '') || ' ' ||
              coalesce(directory_rows.last_name, '')
            ),
            '[[:space:]]+',
            ' ',
            'g'
          )
        ) as full_name_first_last,
        pg_catalog.lower(
          pg_catalog.regexp_replace(
            pg_catalog.btrim(
              coalesce(directory_rows.last_name, '') || ' ' ||
              coalesce(directory_rows.first_name, '')
            ),
            '[[:space:]]+',
            ' ',
            'g'
          )
        ) as full_name_last_first,
        pg_catalog.lower(coalesce(directory_rows.first_name, '')) as search_first_name,
        pg_catalog.lower(coalesce(directory_rows.last_name, '')) as search_last_name,
        pg_catalog.lower(coalesce(directory_rows.secondary_email, '')) as search_secondary_email
      from directory_rows
    ),
    filtered_rows as (
      select normalized_rows.*
      from normalized_rows
      where (
        normalized_search is null
        or pg_catalog.strpos(normalized_rows.search_first_name, normalized_search) > 0
        or pg_catalog.strpos(normalized_rows.search_last_name, normalized_search) > 0
        or pg_catalog.strpos(normalized_rows.full_name_first_last, normalized_search) > 0
        or pg_catalog.strpos(normalized_rows.full_name_last_first, normalized_search) > 0
        or pg_catalog.strpos(normalized_rows.search_secondary_email, normalized_search) > 0
      )
        and (
          normalized_alphabet is null
          or pg_catalog.upper(
            pg_catalog.left(
              coalesce(
                nullif(normalized_rows.search_last_name, ''),
                normalized_rows.search_first_name
              ),
              1
            )
          ) = normalized_alphabet
        )
    )
    select pg_catalog.jsonb_build_object(
      'group', pg_catalog.jsonb_build_object(
        'group_id', actor_group_id::text,
        'name', actor_group_name,
        'time_zone', actor_group_time_zone
      ),
      'members', coalesce(
        (
          select pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'membership_id', filtered_rows.membership_id::text,
              'first_name', filtered_rows.first_name,
              'last_name', filtered_rows.last_name,
              'tee_location', filtered_rows.tee_location
            )
            || case
              when filtered_rows.secondary_email is not null
                then pg_catalog.jsonb_build_object('secondary_email', filtered_rows.secondary_email)
              else '{}'::jsonb
            end
            || case
              when filtered_rows.home_phone_display is not null
                then pg_catalog.jsonb_build_object('home_phone', filtered_rows.home_phone_display)
              else '{}'::jsonb
            end
            || case
              when filtered_rows.work_phone_display is not null
                then pg_catalog.jsonb_build_object('work_phone', filtered_rows.work_phone_display)
              else '{}'::jsonb
            end
            || case
              when filtered_rows.mobile_phone_display is not null
                then pg_catalog.jsonb_build_object('mobile_phone', filtered_rows.mobile_phone_display)
              else '{}'::jsonb
            end
            || case
                when filtered_rows.address_line1 is not null
                  or filtered_rows.address_line2 is not null
                  or filtered_rows.city is not null
                  or filtered_rows.state_region is not null
                  or filtered_rows.postal_code is not null
                  or filtered_rows.country is not null
                then pg_catalog.jsonb_build_object(
                  'address', pg_catalog.jsonb_build_object(
                    'line1', filtered_rows.address_line1,
                    'line2', filtered_rows.address_line2,
                    'city', filtered_rows.city,
                    'state_region', filtered_rows.state_region,
                    'postal_code', filtered_rows.postal_code,
                    'country', filtered_rows.country
                  )
                )
                else '{}'::jsonb
              end
            order by
              pg_catalog.lower(coalesce(filtered_rows.last_name, '')),
              pg_catalog.lower(coalesce(filtered_rows.first_name, '')),
              filtered_rows.membership_id
          )
          from filtered_rows
        ),
        '[]'::jsonb
      )
    )
  );
end;
$$;

comment on function public.resolve_mobile_group_directory(text, text) is
  'Authenticated actor-derived mobile group and active directory projection. Search and alphabet filters never bypass active-membership or field-level contact visibility checks.';

revoke all on function public.resolve_mobile_group_directory(text, text)
from public, anon, authenticated, service_role;
grant execute on function public.resolve_mobile_group_directory(text, text)
to authenticated;
