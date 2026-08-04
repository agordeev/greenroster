-- Phase 04: expose the guest rows already represented by the round participant
-- contract to the coordinator detail projection.  Guest creation, withdrawal,
-- sponsor changes, and scoring remain separate lifecycle decisions.

alter function public.read_coordinator_round_detail(uuid, uuid)
rename to read_coordinator_round_detail_base;

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
  base_payload jsonb;
  actor_group_id uuid;
  guest_participants jsonb;
  combined_participants jsonb;
  guest_count bigint;
begin
  -- The renamed boundary performs the complete actor, membership, recovery,
  -- role, and cross-tenant checks before this wrapper reads guest rows.
  base_payload := public.read_coordinator_round_detail_base(
    p_actor_user_id,
    p_round_id
  );
  actor_group_id := (base_payload -> 'round' ->> 'group_id')::uuid;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'round_id', participant.round_id,
        'participant_id', participant.id,
        'group_id', participant.group_id,
        'participant_kind', participant.participant_kind,
        'membership_id', participant.membership_id,
        'sponsor_membership_id', participant.sponsor_membership_id,
        'first_name', participant.guest_first_name,
        'last_name', participant.guest_last_name,
        'rsvp_status', participant.rsvp_status,
        'version', participant.version,
        'quota_snapshot', participant.quota_snapshot::text,
        'quota_snapshot_source', participant.quota_snapshot_source,
        'handicap_snapshot', participant.handicap_snapshot::text,
        'handicap_snapshot_source', participant.handicap_snapshot_source,
        'handicap_snapshot_as_of', participant.handicap_snapshot_as_of,
        'tee_snapshot', participant.tee_snapshot
      )
      order by
        pg_catalog.lower(participant.guest_last_name),
        pg_catalog.lower(participant.guest_first_name),
        participant.id
    ),
    '[]'::jsonb
  )
  into guest_participants
  from public.round_participants as participant
  where participant.round_id = p_round_id
    and participant.group_id = actor_group_id
    and participant.participant_kind = 'guest'::public.round_participant_kind;

  select count(*)
  into guest_count
  from public.round_participants as participant
  where participant.round_id = p_round_id
    and participant.group_id = actor_group_id
    and participant.participant_kind = 'guest'::public.round_participant_kind;

  select coalesce(
    pg_catalog.jsonb_agg(
      enriched.item
      order by
        pg_catalog.lower(coalesce(enriched.item ->> 'last_name', '')),
        pg_catalog.lower(coalesce(enriched.item ->> 'first_name', '')),
        enriched.item ->> 'participant_id'
    ),
    '[]'::jsonb
  )
  into combined_participants
  from (
    select
      member_item.item || pg_catalog.jsonb_build_object(
        'participant_kind', 'member',
        'sponsor_membership_id', null
      ) as item
    from pg_catalog.jsonb_array_elements(
      coalesce(base_payload -> 'participants', '[]'::jsonb)
    ) as member_item(item)
    where member_item.item ->> 'membership_id' is not null

    union all

    select guest_item.item
    from pg_catalog.jsonb_array_elements(guest_participants) as guest_item(item)
  ) as enriched;

  base_payload := pg_catalog.jsonb_set(
    base_payload,
    array['participants'],
    combined_participants,
    true
  );
  base_payload := pg_catalog.jsonb_set(
    base_payload,
    array['counts', 'guest_count'],
    pg_catalog.to_jsonb(guest_count),
    true
  );

  return base_payload;
end;
$$;

comment on function public.read_coordinator_round_detail(uuid, uuid) is
  'Service-only tenant-authorized round-detail envelope with existing member and guest participant snapshots; guest lifecycle mutations remain separate.';

revoke all on function public.read_coordinator_round_detail_base(uuid, uuid)
from public, anon, authenticated, service_role;
comment on function public.read_coordinator_round_detail_base(uuid, uuid) is
  'Internal member-only base for the tenant-authorized coordinator detail projection; the public service boundary appends existing guest snapshots.';
revoke all on function public.read_coordinator_round_detail(uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.read_coordinator_round_detail(uuid, uuid)
to service_role;

-- The RSVP read is also used by the member web view. Coordinators and
-- administrators receive the tenant roster; a member receives their own
-- participant plus guests they sponsor, and never another member's guest.
drop function public.read_round_participants(uuid, uuid);

create function public.read_round_participants(
  p_actor_user_id uuid,
  p_round_id uuid
)
returns table (
  round_id app.entity_id,
  participant_id app.entity_id,
  group_id app.entity_id,
  participant_kind public.round_participant_kind,
  membership_id app.entity_id,
  sponsor_membership_id app.entity_id,
  first_name text,
  last_name text,
  rsvp_status public.round_rsvp_status,
  version bigint,
  quota_snapshot app.quota_value,
  quota_snapshot_source jsonb,
  handicap_snapshot app.handicap_value,
  handicap_snapshot_source public.member_handicap_source,
  handicap_snapshot_as_of date,
  tee_snapshot text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_group_id uuid;
  actor_membership_id uuid;
  actor_role public.membership_role;
  target_round public.rounds%rowtype;
begin
  if p_actor_user_id is null or p_round_id is null then
    raise exception 'publication_context_required' using errcode = '22004';
  end if;

  select membership.group_id, membership.id, membership.role
  into actor_group_id, actor_membership_id, actor_role
  from public.memberships as membership
  join public.user_profiles as profile
    on profile.user_id = membership.user_id
  join auth.users as identity
    on identity.id = membership.user_id
  where membership.user_id = p_actor_user_id
    and membership.status = 'active'
    and profile.disabled_at is null
    and identity.email_confirmed_at is not null
    and identity.deleted_at is null
    and not identity.is_anonymous
    and not (coalesce(identity.raw_app_meta_data, '{}'::jsonb) ? 'greenroster_password_recovery')
    and (identity.banned_until is null or identity.banned_until <= pg_catalog.statement_timestamp())
  limit 1;
  if actor_group_id is null then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  select round_record.*
  into target_round
  from public.rounds as round_record
  where round_record.id = p_round_id
    and round_record.group_id = actor_group_id;
  if not found or target_round.state = 'draft' then
    raise exception 'round_not_found' using errcode = 'P0002';
  end if;

  return query
  select
    participant.round_id,
    participant.id,
    participant.group_id,
    participant.participant_kind,
    participant.membership_id,
    participant.sponsor_membership_id,
    coalesce(participant.guest_first_name, profile.first_name),
    coalesce(participant.guest_last_name, profile.last_name),
    participant.rsvp_status,
    participant.version,
    participant.quota_snapshot,
    participant.quota_snapshot_source,
    participant.handicap_snapshot,
    participant.handicap_snapshot_source,
    participant.handicap_snapshot_as_of,
    participant.tee_snapshot
  from public.round_participants as participant
  left join public.membership_golfer_profiles as profile
    on profile.membership_id = participant.membership_id
   and profile.group_id = participant.group_id
  where participant.round_id = target_round.id
    and participant.group_id = target_round.group_id
    and (
      actor_role in ('coordinator', 'administrator')
      or participant.membership_id = actor_membership_id
      or participant.sponsor_membership_id = actor_membership_id
    )
  order by
    pg_catalog.lower(coalesce(participant.guest_last_name, profile.last_name, '')),
    pg_catalog.lower(coalesce(participant.guest_first_name, profile.first_name, '')),
    participant.id;
end;
$$;

comment on function public.read_round_participants(uuid, uuid) is
  'Authenticated actor-derived participant read. Members see their own row and sponsored guests; coordinators and administrators see their tenant roster, including the RSVP version.';

revoke all on function public.read_round_participants(uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.read_round_participants(uuid, uuid)
to service_role;
