-- Phase 02: administrator/coordinator role directory and safe activity feed.
--
-- This is a service-only projection.  The trusted server supplies the actor
-- identity; tenant and role are resolved from that identity.  Raw audit state
-- and source tables remain unavailable to application roles.

create function app.safe_group_activity_state(
  p_action text,
  p_state jsonb
)
returns jsonb
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when p_state is null then null::jsonb
    else
      pg_catalog.jsonb_build_object(
        'kind', 'unknown',
        'summary_available', false,
        'membership_id', null,
        'invitation_id', null,
        'import_job_id', null,
        'group_version', null,
        'membership_version', null,
        'profile_version', null,
        'contact_version', null,
        'version', null,
        'status', null,
        'role', null,
        'dues_paid', null,
        'accepted_at', null,
        'expires_at', null,
        'email_matches', null,
        'inactivated_at', null,
        'handicap_record_id', null,
        'handicap_id', null,
        'handicap', null,
        'source', null,
        'as_of', null,
        'created_at', null,
        'quota', null,
        'projection_version', null,
        'settings_version', null,
        'projection_ready', null,
        'total_rows', null,
        'valid_rows', null,
        'invalid_rows', null,
        'skipped_rows', null,
        'applied_rows', null,
        'revision', null,
        'cancelled_notification_count', null,
        'email_present', null,
        'email_verified', null,
        'complete', null,
        'previous_membership_id', null,
        'replacement_membership_id', null,
        'band_count', null,
        'state', null
      ) || case
        when p_action in ('member.created', 'member.updated', 'member.self_profile_updated') then
          pg_catalog.jsonb_build_object(
            'kind', 'member',
            'summary_available', true,
            'membership_id', coalesce(p_state ->> 'membership_id', p_state ->> 'id'),
            'membership_version', nullif(p_state ->> 'membership_version', '')::bigint,
            'profile_version', nullif(p_state ->> 'profile_version', '')::bigint,
            'contact_version', nullif(p_state ->> 'contact_version', '')::bigint,
            'status', coalesce(p_state ->> 'status', p_state ->> 'membership_status'),
            'role', coalesce(p_state ->> 'role', p_state ->> 'membership_role'),
            'dues_paid', case when p_state ? 'dues_paid' then (p_state ->> 'dues_paid')::boolean else null end
          )
        when p_action = 'member.status_changed' then
          pg_catalog.jsonb_build_object(
            'kind', 'member',
            'summary_available', true,
            'membership_id', p_state ->> 'membership_id',
            'membership_version', nullif(p_state ->> 'membership_version', '')::bigint,
            'status', p_state ->> 'status',
            'role', p_state ->> 'role',
            'inactivated_at', case
              when pg_catalog.jsonb_typeof(p_state -> 'inactivated_at') = 'string'
                then p_state ->> 'inactivated_at'
              else null
            end,
            'cancelled_notification_count', nullif(p_state ->> 'cancelled_notification_count', '')::bigint
          )
        when p_action in ('member.handicap_changed') then
          pg_catalog.jsonb_build_object(
            'kind', 'handicap',
            'summary_available', true,
            'membership_id', p_state ->> 'membership_id',
            'membership_version', nullif(p_state ->> 'membership_version', '')::bigint,
            'handicap_record_id', coalesce(p_state ->> 'handicap_record_id', p_state ->> 'current_record_id'),
            'handicap_id', coalesce(p_state ->> 'handicap_id', p_state ->> 'current_handicap_id'),
            'handicap', coalesce(p_state ->> 'handicap', p_state ->> 'current_handicap'),
            'source', coalesce(p_state ->> 'source', p_state ->> 'current_source'),
            'as_of', coalesce(p_state ->> 'as_of', p_state ->> 'current_as_of'),
            'created_at', coalesce(p_state ->> 'created_at', p_state ->> 'current_created_at')
          )
        when p_action = 'member.private_contact_viewed' then
          pg_catalog.jsonb_build_object(
            'kind', 'member',
            'summary_available', true,
            'membership_id', p_state ->> 'membership_id',
            'contact_version', nullif(p_state ->> 'contact_version', '')::bigint
          )
        when p_action = 'membership.role_changed' then
          pg_catalog.jsonb_build_object(
            'kind', 'member',
            'summary_available', true,
            'membership_id', p_state ->> 'membership_id',
            'membership_version', nullif(p_state ->> 'membership_version', '')::bigint,
            'status', p_state ->> 'status',
            'role', p_state ->> 'role'
          )
        when p_action like 'membership.invitation_%' then
          pg_catalog.jsonb_build_object(
            'kind', 'invitation',
            'summary_available', true,
            'membership_id', p_state ->> 'membership_id',
            'invitation_id', coalesce(p_state ->> 'invitation_id', p_state ->> 'fresh_invitation_id'),
            'version', nullif(p_state ->> 'version', '')::bigint,
            'status', p_state ->> 'status',
            'role', p_state ->> 'role',
            'accepted_at', p_state ->> 'accepted_at',
            'expires_at', p_state ->> 'expires_at',
            'email_matches', case when p_state ? 'email_matches' then (p_state ->> 'email_matches')::boolean else null end
          )
        when p_action = 'membership.administrator_transferred' then
          pg_catalog.jsonb_build_object(
            'kind', 'group',
            'summary_available', true,
            'group_version', nullif(p_state ->> 'group_version', '')::bigint,
            'previous_membership_id', p_state -> 'previous_administrator' ->> 'membership_id',
            'replacement_membership_id', p_state -> 'replacement' ->> 'membership_id',
            'role', p_state -> 'replacement' ->> 'role'
          )
        when p_action = 'group.bootstrap' then
          pg_catalog.jsonb_build_object(
            'kind', 'group',
            'summary_available', true,
            'membership_id', p_state ->> 'administrator_membership_id',
            'role', p_state ->> 'membership_role',
            'status', p_state ->> 'membership_status'
          )
        when p_action = 'group.quota_rules_configured' then
          pg_catalog.jsonb_build_object(
            'kind', 'group',
            'summary_available', true,
            'version', nullif(p_state ->> 'version', '')::bigint,
            'band_count', case
              when pg_catalog.jsonb_typeof(p_state -> 'bands') = 'array'
                then pg_catalog.jsonb_array_length(p_state -> 'bands')
              else null
            end
          )
        when p_action = 'membership.quota_bootstrap_configured' then
          pg_catalog.jsonb_build_object(
            'kind', 'member',
            'summary_available', true,
            'membership_id', p_state ->> 'membership_id',
            'projection_version', nullif(p_state ->> 'projection_version', '')::bigint,
            'settings_version', nullif(p_state ->> 'settings_version', '')::bigint,
            'projection_ready', case when p_state ? 'projection_ready' then (p_state ->> 'projection_ready')::boolean else null end,
            'quota', p_state ->> 'projected_quota'
          )
        when p_action like 'member_csv_import.%' then
          pg_catalog.jsonb_build_object(
            'kind', 'import',
            'summary_available', true,
            'import_job_id', p_state ->> 'import_job_id',
            'state', p_state ->> 'state',
            'total_rows', nullif(p_state ->> 'total_rows', '')::bigint,
            'valid_rows', nullif(p_state ->> 'valid_rows', '')::bigint,
            'invalid_rows', nullif(p_state ->> 'invalid_rows', '')::bigint,
            'skipped_rows', nullif(p_state ->> 'skipped_rows', '')::bigint,
            'applied_rows', nullif(p_state ->> 'applied_rows', '')::bigint,
            'revision', nullif(p_state ->> 'revision', '')::bigint
          )
        when p_action = 'account.email_changed' then
          pg_catalog.jsonb_build_object(
            'kind', 'security',
            'summary_available', true,
            'email_present', case when p_state ? 'email_present' then (p_state ->> 'email_present')::boolean else null end,
            'email_verified', case when p_state ? 'email_verified' then (p_state ->> 'email_verified')::boolean else null end
          )
        when p_action = 'identity.password_recovered' then
          pg_catalog.jsonb_build_object(
            'kind', 'security',
            'summary_available', true,
            'state', 'recovered'
          )
        when p_action = 'profile.first_run_completed' then
          pg_catalog.jsonb_build_object(
            'kind', 'profile',
            'summary_available', true,
            'complete', case when p_state ? 'complete' then (p_state ->> 'complete')::boolean else null end
          )
        else pg_catalog.jsonb_build_object(
          'kind', 'unknown',
          'summary_available', false
        )
      end
  end;
$$;

comment on function app.safe_group_activity_state(text, jsonb) is
  'Private fixed-shape audit redaction. Only whitelisted operational metadata is returned; raw audit state never crosses the service projection.';

revoke all on function app.safe_group_activity_state(text, jsonb)
from public, anon, authenticated, service_role;

create function public.resolve_group_roles_activity(
  p_actor_user_id uuid,
  p_target_type text default null,
  p_target_id uuid default null,
  p_activity_limit integer default 50,
  p_activity_before_occurred_at timestamptz default null,
  p_activity_before_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_group_id uuid;
  actor_role public.membership_role;
  group_record public.groups%rowtype;
  normalized_target_type text;
  v_now timestamptz := pg_catalog.statement_timestamp();
begin
  if p_actor_user_id is null then
    raise exception 'actor_identity_required' using errcode = '22004';
  end if;

  select actor.group_id, actor.actor_role
  into actor_group_id, actor_role
  from app.resolve_member_management_actor(p_actor_user_id) as actor
  limit 1;
  if actor_group_id is null then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  if exists (
    select 1
    from auth.users as identity
    where identity.id = p_actor_user_id
      and coalesce(identity.raw_app_meta_data, '{}'::jsonb) ? 'greenroster_password_recovery'
  ) then
    raise exception 'recovery_session_forbidden' using errcode = 'P0003';
  end if;

  if p_activity_limit is null or p_activity_limit < 1 or p_activity_limit > 100 then
    raise exception 'activity_limit_invalid' using errcode = '22023';
  end if;
  if (p_activity_before_occurred_at is null) <> (p_activity_before_id is null) then
    raise exception 'activity_cursor_incomplete' using errcode = '22023';
  end if;

  normalized_target_type := nullif(pg_catalog.lower(pg_catalog.btrim(p_target_type)), '');
  if normalized_target_type is not null
    and (pg_catalog.length(normalized_target_type) > 64
      or normalized_target_type !~ '^[a-z][a-z0-9_]*$')
  then
    raise exception 'activity_target_type_invalid' using errcode = '22023';
  end if;
  if p_target_id is not null and normalized_target_type is null then
    raise exception 'activity_target_filter_incomplete' using errcode = '22023';
  end if;

  select group_row.*
  into group_record
  from public.groups as group_row
  where group_row.id = actor_group_id;
  if not found then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  return (
    with role_rows as (
      select
        membership.id as membership_id,
        coalesce(nullif(pg_catalog.btrim(golfer.first_name), ''), nullif(pg_catalog.btrim(profile.first_name), ''), '') as first_name,
        coalesce(nullif(pg_catalog.btrim(golfer.last_name), ''), nullif(pg_catalog.btrim(profile.last_name), ''), '') as last_name,
        membership.role,
        membership.status,
        membership.version as membership_version,
        invitation.id as invitation_id,
        case
          when invitation.status = 'pending' and invitation.expires_at <= v_now then 'expired'
          else invitation.status::text
        end as invitation_state,
        invitation.issued_at as invitation_issued_at,
        invitation.expires_at as invitation_expires_at,
        invitation.accepted_at as invitation_accepted_at,
        invitation.revoked_at as invitation_revoked_at
      from public.memberships as membership
      left join public.membership_golfer_profiles as golfer
        on golfer.membership_id = membership.id
       and golfer.group_id = membership.group_id
      left join public.user_profiles as profile
        on profile.user_id = membership.user_id
      left join lateral (
        select invitation.*
        from public.membership_invitations as invitation
        where invitation.membership_id = membership.id
          and invitation.group_id = actor_group_id
        order by invitation.issued_at desc, invitation.created_at desc, invitation.id desc
        limit 1
      ) as invitation on true
      where membership.group_id = actor_group_id
        and membership.role in ('administrator', 'coordinator')
    ),
    role_envelope as (
      select coalesce(
        pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'membership_id', role_rows.membership_id,
            'first_name', role_rows.first_name,
            'last_name', role_rows.last_name,
            'role', role_rows.role,
            'status', role_rows.status,
            'membership_version', role_rows.membership_version,
            'invitation_state', role_rows.invitation_state,
            'invitation_issued_at', role_rows.invitation_issued_at,
            'invitation_expires_at', role_rows.invitation_expires_at,
            'invitation_accepted_at', role_rows.invitation_accepted_at,
            'invitation_revoked_at', role_rows.invitation_revoked_at
          )
          order by role_rows.last_name nulls last, role_rows.first_name nulls last, role_rows.membership_id
        ),
        '[]'::jsonb
      ) as roles
      from role_rows
    ),
    scoped_activity as (
      select
        event.id,
        event.group_id,
        event.actor_user_id,
        event.action,
        case
          when event.target_type in ('user', 'user_profile') then 'membership'
          else event.target_type
        end as target_type,
        case
          when event.target_type in ('user', 'user_profile') then target_membership.id
          else event.target_id
        end as target_id,
        event.target_version,
        event.source,
        event.correlation_id,
        event.reason,
        event.occurred_at,
        app.safe_group_activity_state(event.action, event.before_state) as safe_before,
        app.safe_group_activity_state(event.action, event.after_state) as safe_after,
        actor_membership.id as actor_membership_id,
        actor_membership.role as actor_membership_role,
        coalesce(
          nullif(pg_catalog.btrim(actor_golfer.first_name || ' ' || actor_golfer.last_name), ''),
          nullif(pg_catalog.btrim(actor_profile.display_name), ''),
          nullif(pg_catalog.btrim(actor_profile.first_name || ' ' || actor_profile.last_name), ''),
          'Unnamed member'
        ) as actor_display_name
      from public.audit_events as event
      left join public.memberships as actor_membership
        on actor_membership.user_id = event.actor_user_id
       and actor_membership.group_id = actor_group_id
      left join public.membership_golfer_profiles as actor_golfer
        on actor_golfer.membership_id = actor_membership.id
       and actor_golfer.group_id = actor_group_id
      left join public.user_profiles as actor_profile
        on actor_profile.user_id = actor_membership.user_id
      left join public.memberships as target_membership
        on event.target_type in ('user', 'user_profile')
       and target_membership.user_id = event.target_id
       and target_membership.group_id = actor_group_id
      where event.group_id = actor_group_id
        and (actor_role = 'administrator' or event.action in (
          'group.bootstrap',
          'member.created',
          'member.updated',
          'member.self_profile_updated',
          'member.status_changed',
          'member.private_contact_viewed',
          'member.handicap_changed',
          'membership.invitation_issued',
          'membership.invitation_address_corrected',
          'membership.invitation_regenerated',
          'membership.invitation_revoked',
          'membership.invitation_accepted',
          'membership.role_changed',
          'membership.administrator_transferred',
          'member_csv_import.uploaded',
          'member_csv_import.settings_drift_requeued',
          'member_csv_import.validated',
          'member_csv_import.apply_requested',
          'member_csv_import.completed'
        ))
        and (
          normalized_target_type is null
          or (
            event.target_type = normalized_target_type
            and (p_target_id is null or event.target_id = p_target_id)
          )
          or (
            normalized_target_type = 'membership'
            and event.target_type = 'membership_invitation'
            and p_target_id is not null
            and exists (
              select 1
              from public.membership_invitations as invitation_target
              where invitation_target.id = event.target_id
                and invitation_target.group_id = actor_group_id
                and invitation_target.membership_id = p_target_id
            )
          )
          or (
            normalized_target_type = 'membership'
            and event.target_type in ('user', 'user_profile')
            and p_target_id is not null
            and exists (
              select 1
              from public.memberships as user_target
              where user_target.id = p_target_id
                and user_target.group_id = actor_group_id
                and user_target.user_id = event.target_id
            )
          )
          or (
            normalized_target_type = 'membership'
            and p_target_id is not null
            and event.action = 'membership.administrator_transferred'
            and event.target_type = 'group'
            and (
              event.before_state -> 'previous_administrator' ->> 'membership_id' = p_target_id::text
              or event.before_state -> 'replacement' ->> 'membership_id' = p_target_id::text
              or event.after_state -> 'previous_administrator' ->> 'membership_id' = p_target_id::text
              or event.after_state -> 'replacement' ->> 'membership_id' = p_target_id::text
            )
          )
        )
        and (
          p_activity_before_occurred_at is null
          or (event.occurred_at, event.id) < (p_activity_before_occurred_at, p_activity_before_id)
        )
      order by event.occurred_at desc, event.id desc
      limit (p_activity_limit + 1)
    ),
    activity_page as (
      select *
      from scoped_activity
      order by occurred_at desc, id desc
      limit p_activity_limit
    ),
    activity_next as (
      select scoped_activity.occurred_at, scoped_activity.id
      from scoped_activity
      order by occurred_at desc, id desc
      offset p_activity_limit
      limit 1
    ),
    activity_last as (
      select activity_page.occurred_at, activity_page.id
      from activity_page
      order by activity_page.occurred_at asc, activity_page.id asc
      limit 1
    ),
    activity_envelope as (
      select
        coalesce(
          (
            select pg_catalog.jsonb_agg(
              pg_catalog.jsonb_build_object(
                'event_id', activity_page.id,
                'group_id', activity_page.group_id,
                'actor', case
                  when activity_page.actor_membership_id is null then null::jsonb
                  else pg_catalog.jsonb_build_object(
                    'membership_id', activity_page.actor_membership_id,
                    'display_name', activity_page.actor_display_name,
                    'role', activity_page.actor_membership_role
                  )
                end,
                'action', activity_page.action,
                'target', case
                  when activity_page.target_type is null and activity_page.target_id is null then null::jsonb
                  else pg_catalog.jsonb_build_object(
                    'type', activity_page.target_type,
                    'id', activity_page.target_id,
                    'version', activity_page.target_version
                  )
                end,
                'occurred_at', activity_page.occurred_at,
                'source', activity_page.source,
                'correlation_id', activity_page.correlation_id,
                'reason', activity_page.reason,
                'before', activity_page.safe_before,
                'after', activity_page.safe_after
              )
              order by activity_page.occurred_at desc, activity_page.id desc
            )
            from activity_page
          ),
          '[]'::jsonb
        ) as items,
        exists (select 1 from activity_next) as has_more,
        case
          when exists (select 1 from activity_next) then (
            select pg_catalog.jsonb_build_object(
              'occurred_at', activity_last.occurred_at,
              'event_id', activity_last.id
            )
            from activity_last
          )
          else null::jsonb
        end as next_cursor
    )
    select pg_catalog.jsonb_build_object(
      'group', pg_catalog.jsonb_build_object(
        'group_id', group_record.id,
        'name', group_record.name,
        'time_zone', group_record.time_zone::text,
        'version', group_record.version
      ),
      'roles', role_envelope.roles,
      'activity', pg_catalog.jsonb_build_object(
        'items', activity_envelope.items,
        'has_more', activity_envelope.has_more,
        'next_cursor', activity_envelope.next_cursor
      )
    )
    from role_envelope, activity_envelope
  );
end;
$$;

comment on function public.resolve_group_roles_activity(uuid, text, uuid, integer, timestamptz, uuid) is
  'Service-only tenant-scoped role directory and keyset-paginated safe activity projection. Actor Auth IDs, private contact values, secrets, and raw audit snapshots never cross this boundary.';

revoke all on function public.resolve_group_roles_activity(uuid, text, uuid, integer, timestamptz, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.resolve_group_roles_activity(uuid, text, uuid, integer, timestamptz, uuid)
to service_role;
