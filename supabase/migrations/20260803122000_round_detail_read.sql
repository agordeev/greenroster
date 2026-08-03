-- Phase 03: service-only coordinator/admin round-detail projection.
--
-- Round configuration, rule snapshots, and member participant snapshots stay
-- in force-RLS tables.  The trusted server receives one tenant-authorized
-- envelope instead of direct table access.  Guest rows do not exist yet, so
-- the guest count is an explicit server-derived zero.

create function public.read_coordinator_round_detail(
  p_actor_user_id uuid,
  p_round_id uuid
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
  target_round public.rounds%rowtype;
begin
  if p_actor_user_id is null or p_round_id is null then
    raise exception 'round_detail_context_required' using errcode = '22004';
  end if;

  -- Password-recovery sessions are not an application session, even when
  -- the identity still has an otherwise active coordinator membership.
  if exists (
    select 1
    from auth.users as identity
    where identity.id = p_actor_user_id
      and coalesce(identity.raw_app_meta_data, '{}'::jsonb)
        ? 'greenroster_password_recovery'
  ) then
    raise exception 'recovery_session_forbidden' using errcode = 'P0003';
  end if;

  -- Resolve both role and tenant from the active, verified identity.  The
  -- requested round never supplies a tenant and a member cannot use this
  -- coordinator projection.
  select membership.group_id, membership.role
  into actor_group_id, actor_role
  from public.memberships as membership
  join public.user_profiles as profile
    on profile.user_id = membership.user_id
  join auth.users as identity
    on identity.id = membership.user_id
  where membership.user_id = p_actor_user_id
    and membership.status = 'active'
    and membership.role in ('coordinator', 'administrator')
    and profile.disabled_at is null
    and identity.email_confirmed_at is not null
    and identity.deleted_at is null
    and not identity.is_anonymous
    and not (
      coalesce(identity.raw_app_meta_data, '{}'::jsonb)
      ? 'greenroster_password_recovery'
    )
    and (
      identity.banned_until is null
      or identity.banned_until <= pg_catalog.statement_timestamp()
    )
  limit 1;

  if actor_group_id is null or actor_role is null then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  select round_record.*
  into target_round
  from public.rounds as round_record
  where round_record.id = p_round_id
    and round_record.group_id = actor_group_id;

  -- A cross-tenant id is intentionally indistinguishable from a missing
  -- round to the caller.
  if not found then
    raise exception 'round_not_found' using errcode = 'P0002';
  end if;

  return (
    select pg_catalog.jsonb_build_object(
      'round', pg_catalog.jsonb_build_object(
        'round_id', target_round.id,
        'group_id', target_round.group_id,
        'description', target_round.description,
        'scheduled_at', target_round.scheduled_at,
        'group_time_zone', target_round.group_time_zone,
        'venue', target_round.venue,
        'round_url', target_round.round_url,
        'notes', target_round.notes,
        'notes_visible_to_players', target_round.notes_visible_to_players,
        'rsvp_deadline_at', target_round.rsvp_deadline_at,
        'format', target_round.format,
        'state', target_round.state,
        'version', target_round.version,
        'published_at', target_round.published_at,
        'cancelled_at', target_round.cancelled_at,
        'cancellation_reason', target_round.cancellation_reason
      ),
      'rule_snapshot', (
        select pg_catalog.jsonb_build_object(
          'round_id', snapshot.round_id,
          'group_id', snapshot.group_id,
          'format', snapshot.format,
          'quota_method', snapshot.quota_method,
          'moving_average_history_length', snapshot.moving_average_history_length,
          'quota_precision', snapshot.quota_precision,
          'quota_rounding_rule', snapshot.quota_rounding_rule,
          'adjustment_bands', snapshot.adjustment_bands,
          'settings_version', snapshot.settings_version
        )
        from public.round_rule_snapshots as snapshot
        where snapshot.round_id = target_round.id
          and snapshot.group_id = target_round.group_id
      ),
      'participants', coalesce(
        (
          select pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'round_id', participant.round_id,
              'participant_id', participant.id,
              'group_id', participant.group_id,
              'membership_id', participant.membership_id,
              'first_name', coalesce(golfer.first_name, profile.first_name),
              'last_name', coalesce(golfer.last_name, profile.last_name),
              'rsvp_status', participant.rsvp_status,
              'version', participant.version,
              -- Numeric snapshots are returned as text, matching the other
              -- JSON projections and preventing client-side precision loss.
              'quota_snapshot', participant.quota_snapshot::text,
              'quota_snapshot_source', participant.quota_snapshot_source,
              'handicap_snapshot', participant.handicap_snapshot::text,
              'handicap_snapshot_source', participant.handicap_snapshot_source,
              'handicap_snapshot_as_of', participant.handicap_snapshot_as_of,
              'tee_snapshot', participant.tee_snapshot
            )
            order by
              pg_catalog.lower(coalesce(golfer.last_name, profile.last_name, '')),
              pg_catalog.lower(coalesce(golfer.first_name, profile.first_name, '')),
              participant.membership_id
          )
          from public.round_participants as participant
          left join public.membership_golfer_profiles as golfer
            on golfer.membership_id = participant.membership_id
           and golfer.group_id = participant.group_id
          left join public.memberships as membership
            on membership.id = participant.membership_id
           and membership.group_id = participant.group_id
          left join public.user_profiles as profile
            on profile.user_id = membership.user_id
          where participant.round_id = target_round.id
            and participant.group_id = target_round.group_id
        ),
        '[]'::jsonb
      ),
      'counts', pg_catalog.jsonb_build_object(
        'playing_count', (
          select count(*)
          from public.round_participants as participant
          where participant.round_id = target_round.id
            and participant.group_id = target_round.group_id
            and participant.rsvp_status = 'playing'
        ),
        'not_playing_count', (
          select count(*)
          from public.round_participants as participant
          where participant.round_id = target_round.id
            and participant.group_id = target_round.group_id
            and participant.rsvp_status = 'not_playing'
        ),
        'no_response_count', (
          select count(*)
          from public.round_participants as participant
          where participant.round_id = target_round.id
            and participant.group_id = target_round.group_id
            and participant.rsvp_status = 'no_response'
        ),
        -- Guest participants are not yet modeled in the schema.
        'guest_count', 0
      )
    )
  );
end;
$$;

comment on function public.read_coordinator_round_detail(uuid, uuid) is
  'Service-only tenant-authorized round-detail envelope for active verified coordinators and administrators; member and cross-group reads are denied.';

revoke all on function public.read_coordinator_round_detail(uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.read_coordinator_round_detail(uuid, uuid)
to service_role;
