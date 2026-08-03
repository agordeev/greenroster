-- Phase 05: the actor-derived mobile round list.
--
-- Mobile receives only rounds the authenticated identity can see.  Members
-- need a participant row; coordinators and administrators may see the whole
-- tenant roster so their operational warnings do not silently disappear.

create function public.list_mobile_rounds(
  p_completed_before app.utc_instant default null,
  p_completed_limit integer default 25
)
returns table (
  round_id app.entity_id,
  group_id app.entity_id,
  description text,
  scheduled_at app.utc_instant,
  group_time_zone app.iana_time_zone,
  venue text,
  format public.round_format,
  state public.round_state,
  version bigint,
  participant_status public.round_rsvp_status,
  participant_version bigint,
  participant_count bigint,
  playing_count bigint,
  updated_at app.utc_instant
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := (select auth.uid());
  actor_membership public.memberships%rowtype;
begin
  if actor_user_id is null then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  if exists (
    select 1
    from auth.users as identity
    where identity.id = actor_user_id
      and coalesce(identity.raw_app_meta_data, '{}'::jsonb)
        ? 'greenroster_password_recovery'
  ) then
    raise exception 'recovery_session_forbidden' using errcode = 'P0003';
  end if;

  select membership.*
  into actor_membership
  from public.memberships as membership
  join public.user_profiles as profile
    on profile.user_id = membership.user_id
  join auth.users as identity
    on identity.id = membership.user_id
  where membership.user_id = actor_user_id
    and membership.status = 'active'
    and profile.disabled_at is null
    and identity.email_confirmed_at is not null
    and identity.deleted_at is null
    and not identity.is_anonymous
    and (
      identity.banned_until is null
      or identity.banned_until <= pg_catalog.statement_timestamp()
    )
  order by membership.id
  limit 1;
  if not found then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  if p_completed_limit is null or p_completed_limit < 1 or p_completed_limit > 100 then
    raise exception 'round_list_limit_invalid' using errcode = '22023';
  end if;

  return query
  with visible_rounds as (
    select
      round_record.id as round_id,
      round_record.group_id,
      round_record.description,
      round_record.scheduled_at,
      round_record.group_time_zone,
      round_record.venue,
      round_record.format,
      round_record.state,
      round_record.version,
      coalesce(actor_participant.rsvp_status, 'no_response'::public.round_rsvp_status)
        as participant_status,
      actor_participant.version as participant_version,
      counts.participant_count,
      counts.playing_count,
      round_record.updated_at,
      case round_record.state
        when 'live' then 0
        when 'published' then 1
        when 'completed' then 2
        else 3
      end as state_order,
      case
        when round_record.state = 'completed'
          then coalesce(round_record.updated_at, round_record.scheduled_at)
        else round_record.scheduled_at
      end as display_order
    from public.rounds as round_record
    left join public.round_participants as actor_participant
      on actor_participant.round_id = round_record.id
     and actor_participant.group_id = round_record.group_id
     and actor_participant.membership_id = actor_membership.id
    cross join lateral (
      select
        count(*)::bigint as participant_count,
        count(*) filter (where participant.rsvp_status = 'playing')::bigint
          as playing_count
      from public.round_participants as participant
      where participant.round_id = round_record.id
        and participant.group_id = round_record.group_id
    ) as counts
    where round_record.group_id = actor_membership.group_id
      and round_record.state <> 'draft'
      and (
        actor_membership.role in ('coordinator', 'administrator')
        or actor_participant.id is not null
        or exists (
          select 1
          from public.round_participants as sponsor_participant
          where sponsor_participant.round_id = round_record.id
            and sponsor_participant.group_id = round_record.group_id
            and sponsor_participant.sponsor_membership_id = actor_membership.id
        )
      )
      and (
        round_record.state <> 'completed'
        or p_completed_before is null
        or coalesce(round_record.updated_at, round_record.scheduled_at)
          < p_completed_before
      )
  ), numbered_completed as (
    select
      visible_rounds.*,
      case when visible_rounds.state = 'completed' then
        pg_catalog.row_number() over (
          partition by visible_rounds.state
          order by visible_rounds.display_order desc nulls last, visible_rounds.round_id
        )
      end as completed_position
    from visible_rounds
  )
  select
    numbered_completed.round_id,
    numbered_completed.group_id,
    numbered_completed.description,
    numbered_completed.scheduled_at,
    numbered_completed.group_time_zone,
    numbered_completed.venue,
    numbered_completed.format,
    numbered_completed.state,
    numbered_completed.version,
    numbered_completed.participant_status,
    numbered_completed.participant_version,
    numbered_completed.participant_count,
    numbered_completed.playing_count,
    numbered_completed.updated_at
  from numbered_completed
  where numbered_completed.state <> 'completed'
    or numbered_completed.completed_position <= p_completed_limit
  order by
    numbered_completed.state_order,
    case
      when numbered_completed.state = 'live'
        and numbered_completed.participant_status = 'playing' then 0
      when numbered_completed.state = 'live' then 1
      else 2
    end,
    numbered_completed.display_order desc nulls last,
    numbered_completed.round_id;
end;
$$;

comment on function public.list_mobile_rounds(app.utc_instant, integer) is
  'Authenticated actor-derived mobile round list. Live and upcoming rounds are ordered first; completed history accepts a stable time cursor and never exposes drafts or another tenant.';

revoke all on function public.list_mobile_rounds(app.utc_instant, integer)
from public, anon, authenticated, service_role;
grant execute on function public.list_mobile_rounds(app.utc_instant, integer)
to authenticated;
