-- Phase 02: paginated, server-filtered administrative roster projection.
--
-- The function returns one JSON envelope so an empty page still carries the
-- authoritative total count.  It reads only operational roster fields; raw
-- private contacts and account e-mail values are never returned.

create or replace function public.list_manageable_member_roster(
  p_actor_user_id uuid,
  p_search text default null,
  p_alphabet text default null,
  p_status public.membership_status default null,
  p_role public.membership_role default null,
  p_dues_paid boolean default null,
  p_sort_key text default 'name',
  p_sort_direction text default 'asc',
  p_limit integer default 50,
  p_offset bigint default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_group_id uuid;
  normalized_search text;
  normalized_alphabet text;
  normalized_sort_key text;
  normalized_sort_direction text;
  v_now timestamptz := pg_catalog.statement_timestamp();
begin
  select actor.group_id
  into actor_group_id
  from app.resolve_member_management_actor(p_actor_user_id) as actor
  limit 1;

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
    raise exception 'roster_search_invalid' using errcode = '22023';
  end if;

  normalized_alphabet := nullif(pg_catalog.upper(pg_catalog.btrim(p_alphabet)), '');
  if normalized_alphabet is not null
    and normalized_alphabet !~ '^[A-Z]$'
  then
    raise exception 'roster_alphabet_invalid' using errcode = '22023';
  end if;

  normalized_sort_key := pg_catalog.lower(pg_catalog.btrim(p_sort_key));
  if normalized_sort_key is null or normalized_sort_key not in (
    'name',
    'status',
    'role',
    'dues',
    'tee',
    'handicap',
    'quota',
    'date_added',
    'invitation'
  ) then
    raise exception 'roster_sort_invalid' using errcode = '22023';
  end if;

  normalized_sort_direction := pg_catalog.lower(pg_catalog.btrim(p_sort_direction));
  if normalized_sort_direction is null or normalized_sort_direction not in ('asc', 'desc') then
    raise exception 'roster_sort_invalid' using errcode = '22023';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'roster_limit_invalid' using errcode = '22023';
  end if;

  if p_offset is null or p_offset < 0 then
    raise exception 'roster_offset_invalid' using errcode = '22023';
  end if;

  return (
    with latest_handicap as (
      select distinct on (record.membership_id)
        record.membership_id,
        record.group_id,
        record.id,
        record.handicap_id,
        record.handicap,
        record.source,
        record.as_of
      from public.membership_handicap_records as record
      where record.group_id = actor_group_id
      order by record.membership_id, record.as_of desc, record.created_at desc, record.id desc
    ),
    latest_invitation as (
      select distinct on (invitation.membership_id)
        invitation.membership_id,
        invitation.group_id,
        case
          when invitation.status = 'pending' and invitation.expires_at <= v_now
            then 'expired'::public.membership_invitation_status
          else invitation.status
        end as status,
        invitation.invited_email_normalized,
        case
          when invitation.status = 'pending' and invitation.expires_at > v_now then (
            coalesce(delivery.state in ('failed_permanent', 'suppressed'), false)
            or suppression.normalized_address is not null
          )
          else false
        end as delivery_action_required
      from public.membership_invitations as invitation
      left join lateral (
        select candidate.state
        from public.notification_outbox_jobs as outbox
        join public.notification_deliveries as candidate
          on candidate.outbox_job_id = outbox.id
          and candidate.group_id = outbox.group_id
        where outbox.group_id = invitation.group_id
          and outbox.aggregate_type = 'membership_invitation'
          and outbox.aggregate_id = invitation.id
          and candidate.recipient_membership_id = invitation.membership_id
          and candidate.channel = 'email'
        order by candidate.created_at desc, candidate.id desc
        limit 1
      ) as delivery on true
      left join public.email_suppressions as suppression
        on suppression.normalized_address = invitation.invited_email_normalized
      where invitation.group_id = actor_group_id
      order by invitation.membership_id, invitation.issued_at desc, invitation.created_at desc, invitation.id desc
    ),
    roster_base as (
      select
        membership.id as membership_id,
        coalesce(golfer.first_name, profile.first_name) as first_name,
        coalesce(golfer.last_name, profile.last_name) as last_name,
        membership.status,
        membership.role,
        membership.dues_paid,
        golfer.tee_location,
        handicap.handicap,
        handicap.source as handicap_source,
        handicap.as_of as handicap_as_of,
        handicap.handicap_id,
        projection.projected_quota as current_quota,
        projection.projection_source as current_quota_provenance,
        projection.effective_at as current_quota_effective_at,
        membership.uses_initial_quota,
        membership.created_at as date_added,
        invitation.status as invitation_state,
        coalesce(invitation.delivery_action_required, false) as invitation_delivery_action_required,
        pg_catalog.lower(coalesce(golfer.last_name, profile.last_name, '')) as sort_last_name,
        pg_catalog.lower(coalesce(golfer.first_name, profile.first_name, '')) as sort_first_name,
        pg_catalog.regexp_replace(
          pg_catalog.lower(
            pg_catalog.btrim(
              coalesce(golfer.first_name, profile.first_name, '') || ' ' ||
              coalesce(golfer.last_name, profile.last_name, '')
            )
          ),
          '[[:space:]]+',
          ' ',
          'g'
        ) as full_name_first_last_search,
        pg_catalog.regexp_replace(
          pg_catalog.lower(
            pg_catalog.btrim(
              coalesce(golfer.last_name, profile.last_name, '') || ' ' ||
              coalesce(golfer.first_name, profile.first_name, '')
            )
          ),
          '[[:space:]]+',
          ' ',
          'g'
        ) as full_name_last_first_search,
        pg_catalog.lower(identity.email) as account_email_search,
        invitation.invited_email_normalized as invited_email_search,
        pg_catalog.lower(coalesce(handicap.handicap_id, '')) as handicap_id_search
      from public.memberships as membership
      left join public.membership_golfer_profiles as golfer
        on golfer.membership_id = membership.id
        and golfer.group_id = membership.group_id
      left join public.user_profiles as profile
        on profile.user_id = membership.user_id
      left join auth.users as identity
        on identity.id = membership.user_id
      left join latest_handicap as handicap
        on handicap.membership_id = membership.id
        and handicap.group_id = membership.group_id
      left join public.membership_quota_projections as projection
        on projection.membership_id = membership.id
        and projection.group_id = membership.group_id
      left join latest_invitation as invitation
        on invitation.membership_id = membership.id
        and invitation.group_id = membership.group_id
      where membership.group_id = actor_group_id
    ),
    filtered as (
      select roster_base.*
      from roster_base
      where (
        normalized_search is null
        or pg_catalog.strpos(roster_base.sort_first_name, normalized_search) > 0
        or pg_catalog.strpos(roster_base.sort_last_name, normalized_search) > 0
        or pg_catalog.strpos(roster_base.full_name_first_last_search, normalized_search) > 0
        or pg_catalog.strpos(roster_base.full_name_last_first_search, normalized_search) > 0
        or pg_catalog.strpos(coalesce(roster_base.account_email_search, ''), normalized_search) > 0
        or pg_catalog.strpos(coalesce(roster_base.invited_email_search, ''), normalized_search) > 0
        or pg_catalog.strpos(roster_base.handicap_id_search, normalized_search) > 0
      )
        and (
          normalized_alphabet is null
          or pg_catalog.upper(pg_catalog.left(roster_base.sort_last_name, 1)) = normalized_alphabet
          or (
            roster_base.sort_last_name = ''
            and pg_catalog.upper(pg_catalog.left(roster_base.sort_first_name, 1)) = normalized_alphabet
          )
        )
        and (p_status is null or roster_base.status = p_status)
        and (p_role is null or roster_base.role = p_role)
        and (p_dues_paid is null or roster_base.dues_paid = p_dues_paid)
    ),
    paged as (
      select filtered.*
      from filtered
      order by
        case when normalized_sort_key = 'name' and normalized_sort_direction = 'asc' then filtered.sort_last_name end asc nulls last,
        case when normalized_sort_key = 'name' and normalized_sort_direction = 'desc' then filtered.sort_last_name end desc nulls last,
        case when normalized_sort_key = 'name' and normalized_sort_direction = 'asc' then filtered.sort_first_name end asc nulls last,
        case when normalized_sort_key = 'name' and normalized_sort_direction = 'desc' then filtered.sort_first_name end desc nulls last,
        case when normalized_sort_key = 'status' and normalized_sort_direction = 'asc' then filtered.status::text end asc nulls last,
        case when normalized_sort_key = 'status' and normalized_sort_direction = 'desc' then filtered.status::text end desc nulls last,
        case when normalized_sort_key = 'role' and normalized_sort_direction = 'asc' then filtered.role::text end asc nulls last,
        case when normalized_sort_key = 'role' and normalized_sort_direction = 'desc' then filtered.role::text end desc nulls last,
        case when normalized_sort_key = 'dues' and normalized_sort_direction = 'asc' then filtered.dues_paid end asc nulls last,
        case when normalized_sort_key = 'dues' and normalized_sort_direction = 'desc' then filtered.dues_paid end desc nulls last,
        case when normalized_sort_key = 'tee' and normalized_sort_direction = 'asc' then filtered.tee_location end asc nulls last,
        case when normalized_sort_key = 'tee' and normalized_sort_direction = 'desc' then filtered.tee_location end desc nulls last,
        case when normalized_sort_key = 'handicap' and normalized_sort_direction = 'asc' then filtered.handicap end asc nulls last,
        case when normalized_sort_key = 'handicap' and normalized_sort_direction = 'desc' then filtered.handicap end desc nulls last,
        case when normalized_sort_key = 'quota' and normalized_sort_direction = 'asc' then filtered.current_quota end asc nulls last,
        case when normalized_sort_key = 'quota' and normalized_sort_direction = 'desc' then filtered.current_quota end desc nulls last,
        case when normalized_sort_key = 'date_added' and normalized_sort_direction = 'asc' then filtered.date_added end asc nulls last,
        case when normalized_sort_key = 'date_added' and normalized_sort_direction = 'desc' then filtered.date_added end desc nulls last,
        case when normalized_sort_key = 'invitation' and normalized_sort_direction = 'asc' then filtered.invitation_state::text end asc nulls last,
        case when normalized_sort_key = 'invitation' and normalized_sort_direction = 'desc' then filtered.invitation_state::text end desc nulls last,
        filtered.sort_last_name asc nulls last,
        filtered.sort_first_name asc nulls last,
        filtered.membership_id asc
      offset p_offset
      limit p_limit
    )
    select pg_catalog.jsonb_build_object(
      'total_count', (select count(*) from filtered),
      'active_count', (select count(*) from roster_base where roster_base.status = 'active'),
      'rows', coalesce(
        (
          select pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'membership_id', paged.membership_id::text,
              'first_name', paged.first_name,
              'last_name', paged.last_name,
              'status', paged.status::text,
              'role', paged.role::text,
              'dues_paid', paged.dues_paid,
              'tee_location', paged.tee_location,
              'handicap_value', paged.handicap::text,
              'handicap_source', paged.handicap_source::text,
              'handicap_as_of', paged.handicap_as_of::text,
              'handicap_id', paged.handicap_id,
              'current_quota', paged.current_quota::text,
              'current_quota_provenance', paged.current_quota_provenance,
              'current_quota_effective_at', paged.current_quota_effective_at,
              'uses_initial_quota', paged.uses_initial_quota,
              'date_added', paged.date_added,
              'invitation_state', paged.invitation_state::text,
              'invitation_delivery_action_required', paged.invitation_delivery_action_required
            )
            order by
              case when normalized_sort_key = 'name' and normalized_sort_direction = 'asc' then paged.sort_last_name end asc nulls last,
              case when normalized_sort_key = 'name' and normalized_sort_direction = 'desc' then paged.sort_last_name end desc nulls last,
              case when normalized_sort_key = 'name' and normalized_sort_direction = 'asc' then paged.sort_first_name end asc nulls last,
              case when normalized_sort_key = 'name' and normalized_sort_direction = 'desc' then paged.sort_first_name end desc nulls last,
              case when normalized_sort_key = 'status' and normalized_sort_direction = 'asc' then paged.status::text end asc nulls last,
              case when normalized_sort_key = 'status' and normalized_sort_direction = 'desc' then paged.status::text end desc nulls last,
              case when normalized_sort_key = 'role' and normalized_sort_direction = 'asc' then paged.role::text end asc nulls last,
              case when normalized_sort_key = 'role' and normalized_sort_direction = 'desc' then paged.role::text end desc nulls last,
              case when normalized_sort_key = 'dues' and normalized_sort_direction = 'asc' then paged.dues_paid end asc nulls last,
              case when normalized_sort_key = 'dues' and normalized_sort_direction = 'desc' then paged.dues_paid end desc nulls last,
              case when normalized_sort_key = 'tee' and normalized_sort_direction = 'asc' then paged.tee_location end asc nulls last,
              case when normalized_sort_key = 'tee' and normalized_sort_direction = 'desc' then paged.tee_location end desc nulls last,
              case when normalized_sort_key = 'handicap' and normalized_sort_direction = 'asc' then paged.handicap end asc nulls last,
              case when normalized_sort_key = 'handicap' and normalized_sort_direction = 'desc' then paged.handicap end desc nulls last,
              case when normalized_sort_key = 'quota' and normalized_sort_direction = 'asc' then paged.current_quota end asc nulls last,
              case when normalized_sort_key = 'quota' and normalized_sort_direction = 'desc' then paged.current_quota end desc nulls last,
              case when normalized_sort_key = 'date_added' and normalized_sort_direction = 'asc' then paged.date_added end asc nulls last,
              case when normalized_sort_key = 'date_added' and normalized_sort_direction = 'desc' then paged.date_added end desc nulls last,
              case when normalized_sort_key = 'invitation' and normalized_sort_direction = 'asc' then paged.invitation_state::text end asc nulls last,
              case when normalized_sort_key = 'invitation' and normalized_sort_direction = 'desc' then paged.invitation_state::text end desc nulls last,
              paged.sort_last_name asc nulls last,
              paged.sort_first_name asc nulls last,
              paged.membership_id asc
          )
          from paged
        ),
        '[]'::jsonb
      )
    )
  );
end;
$$;

comment on function public.list_manageable_member_roster(uuid, text, text, public.membership_status, public.membership_role, boolean, text, text, integer, bigint) is
  'Service-only, actor-tenant administrative roster envelope. Search/filter/sort inputs are allowlisted; rows include operational member, handicap, current quota, date-added, and invitation actionability fields without account e-mail or private contacts.';

revoke all on function public.list_manageable_member_roster(uuid, text, text, public.membership_status, public.membership_role, boolean, text, text, integer, bigint)
from public, anon, authenticated, service_role;
grant execute on function public.list_manageable_member_roster(uuid, text, text, public.membership_status, public.membership_role, boolean, text, text, integer, bigint)
to service_role;
