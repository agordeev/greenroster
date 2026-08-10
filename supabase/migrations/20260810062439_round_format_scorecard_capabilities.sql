-- Expose the draft's final-total capability snapshot to the coordinator round
-- list. The score-capability mutation already owns the write boundary; this
-- projection lets the draft UI render the server-confirmed values after a
-- refresh without reading the rounds table directly.

drop function public.list_rounds(uuid);

create function public.list_rounds(
  p_actor_user_id uuid
)
returns table (
  round_id app.entity_id,
  group_id app.entity_id,
  group_name text,
  group_time_zone app.iana_time_zone,
  description text,
  scheduled_at app.utc_instant,
  venue text,
  round_url text,
  notes text,
  notes_visible_to_players boolean,
  rsvp_deadline_at app.utc_instant,
  format public.round_format,
  enable_gross_score boolean,
  enable_net_score boolean,
  state public.round_state,
  version bigint,
  created_at app.utc_instant,
  updated_at app.utc_instant
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_group_id uuid;
begin
  if p_actor_user_id is null then
    raise exception 'actor_identity_required' using errcode = '22004';
  end if;

  select actor.group_id
  into actor_group_id
  from app.resolve_member_management_actor(p_actor_user_id) as actor
  limit 1;
  if actor_group_id is null then
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

  return query
  select
    round_record.id,
    round_record.group_id,
    group_record.name,
    round_record.group_time_zone,
    round_record.description,
    round_record.scheduled_at,
    round_record.venue,
    round_record.round_url,
    round_record.notes,
    round_record.notes_visible_to_players,
    round_record.rsvp_deadline_at,
    round_record.format,
    round_record.enable_gross_score,
    round_record.enable_net_score,
    round_record.state,
    round_record.version,
    round_record.created_at,
    round_record.updated_at
  from public.rounds as round_record
  join public.groups as group_record
    on group_record.id = round_record.group_id
  where round_record.group_id = actor_group_id
  order by round_record.scheduled_at desc, round_record.id desc;
end;
$$;

comment on function public.list_rounds(uuid) is
  'Coordinator/administrator round projection including draft final-total capabilities. Draft rows are never exposed through a member-facing path.';

revoke all on function public.list_rounds(uuid)
from public, anon, authenticated;
grant execute on function public.list_rounds(uuid)
to service_role;
