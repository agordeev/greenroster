-- Phase 02: one protected read boundary for the selected member detail view.
--
-- The RPC deliberately returns safe JSON projections instead of exposing any
-- of the force-RLS source tables to client roles.  Invitation token digests,
-- delivery provider identifiers/claim tokens, outbox payloads, and audit state
-- snapshots never cross this boundary.

create function public.get_member_detail_projection(
  p_actor_user_id uuid,
  p_membership_id uuid
)
returns table (
  membership_id app.entity_id,
  group_id app.entity_id,
  actor_role public.membership_role,
  account_email text,
  invitations jsonb,
  deliveries jsonb,
  quota jsonb,
  handicaps jsonb,
  activity jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_group_id uuid;
  v_actor_role public.membership_role;
  target_membership public.memberships%rowtype;
  target_account_email text;
  v_now timestamptz := pg_catalog.statement_timestamp();
begin
  -- Resolve and authorize the actor before touching the requested target.  A
  -- disabled, banned, unverified, inactive, or ordinary member therefore gets
  -- the same denial for an existing and a guessed membership id.
  select actor.group_id, actor.actor_role
  into actor_group_id, v_actor_role
  from app.resolve_member_management_actor(p_actor_user_id) as actor
  limit 1;

  if actor_group_id is null then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  select membership.*
  into target_membership
  from public.memberships as membership
  where membership.id = p_membership_id
    and membership.group_id = actor_group_id;

  if not found then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;

  select identity.email
  into target_account_email
  from auth.users as identity
  where identity.id = target_membership.user_id;

  return query
  select
    target_membership.id,
    target_membership.group_id,
    v_actor_role,
    target_account_email,
    coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'invitation_id', invitation.id,
            'role', invitation.role,
            'status', case
              when invitation.status = 'pending' and invitation.expires_at <= v_now
                then 'expired'
              else invitation.status::text
            end,
            'invited_email', invitation.invited_email,
            'issued_at', invitation.issued_at,
            'expires_at', invitation.expires_at,
            'accepted_at', invitation.accepted_at,
            'revoked_at', invitation.revoked_at,
            'expired_at', case
              when invitation.status = 'expired' then invitation.expired_at
              when invitation.status = 'pending' and invitation.expires_at <= v_now
                then invitation.expires_at
              else null
            end,
            'version', invitation.version
          )
          order by invitation.issued_at desc, invitation.created_at desc, invitation.id
        )
        from public.membership_invitations as invitation
        where invitation.membership_id = target_membership.id
          and invitation.group_id = target_membership.group_id
      ),
      '[]'::jsonb
    ),
    coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'delivery_id', delivery.id,
            'event_type', outbox.event_type,
            'recipient_address', delivery.recipient_address,
            'channel', delivery.channel,
            'state', delivery.state,
            'attempts', delivery.attempts,
            'failure_reason', delivery.failure_reason,
            'suppression_reason', case
              when v_actor_role = 'administrator' then suppression.reason
              else null
            end,
            'sent_at', delivery.sent_at,
            'created_at', delivery.created_at,
            'updated_at', delivery.updated_at
          )
          order by delivery.created_at desc, delivery.id
        )
        from public.notification_deliveries as delivery
        join public.notification_outbox_jobs as outbox
          on outbox.id = delivery.outbox_job_id
         and outbox.group_id = delivery.group_id
        left join public.email_suppressions as suppression
          on suppression.normalized_address = delivery.recipient_address_normalized
        where delivery.group_id = target_membership.group_id
          and (
            delivery.recipient_membership_id = target_membership.id
            or (
              target_membership.user_id is not null
              and delivery.recipient_user_id = target_membership.user_id
            )
            or (
              outbox.aggregate_type = 'membership'
              and outbox.aggregate_id = target_membership.id
            )
            or exists (
              select 1
              from public.membership_invitations as invitation
              where invitation.id = outbox.aggregate_id
                and invitation.group_id = outbox.group_id
                and invitation.membership_id = target_membership.id
            )
          )
      ),
      '[]'::jsonb
    ),
    pg_catalog.jsonb_build_object(
      'current', pg_catalog.jsonb_build_object(
        'projection_version', coalesce(projection.projection_version, 0),
        'projection_ready', coalesce(projection.projection_ready, false),
        'projected_quota', projection.projected_quota::text,
        'projection_source', coalesce(projection.projection_source, '{}'::jsonb),
        'effective_at', projection.effective_at
      ),
      'history', coalesce(
        (
          select pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'event_id', event.id,
              'projection_version', nullif(event.after_state ->> 'projection_version', '')::bigint,
              'settings_version', coalesce(nullif(event.after_state ->> 'settings_version', '')::bigint, 0),
              'projection_ready', coalesce((event.after_state ->> 'projection_ready')::boolean, false),
              'projected_quota', nullif(event.after_state ->> 'projected_quota', '')::text,
              'projection_source', coalesce(event.after_state -> 'projection_source', '{}'::jsonb),
              'occurred_at', event.occurred_at,
              'reason', event.reason,
              'source', event.source,
              'admin', case
                when v_actor_role = 'administrator' then pg_catalog.jsonb_build_object(
                  'initial_quota', nullif(event.after_state ->> 'initial_quota', '')::text,
                  'uses_initial_quota', coalesce((event.after_state ->> 'uses_initial_quota')::boolean, false),
                  'initial_quota_provenance', event.after_state ->> 'initial_quota_provenance',
                  'seed_totals', coalesce(
                    (
                      select pg_catalog.jsonb_agg(
                        pg_catalog.jsonb_build_object(
                          'position', seed.ordinal,
                          'point_total', seed.value #>> '{}'
                        ) order by seed.ordinal
                      )
                      from pg_catalog.jsonb_array_elements(
                        coalesce(event.after_state -> 'seed_totals', '[]'::jsonb)
                      ) with ordinality as seed(value, ordinal)
                    ),
                    '[]'::jsonb
                  )
                )
                else null
              end
            )
            order by event.occurred_at desc, event.id
          )
          from public.audit_events as event
          where event.group_id = target_membership.group_id
            and event.action = 'membership.quota_bootstrap_configured'
            and event.target_type = 'membership'
            and event.target_id = target_membership.id
        ),
        '[]'::jsonb
      ),
      'admin', case
        when v_actor_role = 'administrator' then pg_catalog.jsonb_build_object(
          'initial_quota', target_membership.initial_quota::text,
          'uses_initial_quota', target_membership.uses_initial_quota,
          'initial_quota_provenance', target_membership.initial_quota_provenance,
          'seed_totals', coalesce(
            (
              select pg_catalog.jsonb_agg(
                pg_catalog.jsonb_build_object(
                  'position', seed.position,
                  'point_total', seed.point_total::text
                ) order by seed.position
              )
              from public.membership_quota_seed_totals as seed
              where seed.membership_id = target_membership.id
                and seed.group_id = target_membership.group_id
            ),
            '[]'::jsonb
          ),
          'settings', pg_catalog.jsonb_build_object(
            'version', coalesce(settings.version, 0),
            'method', settings.method,
            'history_length', settings.moving_average_history_length,
            'precision', settings.precision,
            'rounding_rule', settings.rounding_rule,
            'adjustment_bands', coalesce(
              (
                select pg_catalog.jsonb_agg(
                  pg_catalog.jsonb_build_object(
                    'position', band.position,
                    'lower_bound', band.lower_bound::text,
                    'lower_inclusive', band.lower_inclusive,
                    'upper_bound', band.upper_bound::text,
                    'upper_inclusive', band.upper_inclusive,
                    'adjustment', band.adjustment::text
                  ) order by band.position
                )
                from public.quota_adjustment_bands as band
                where band.group_id = target_membership.group_id
              ),
              '[]'::jsonb
            )
          )
        )
        else null
      end
    ),
    pg_catalog.jsonb_build_object(
      'current', (
        select pg_catalog.jsonb_build_object(
          'id', record.id,
          'handicap_id', record.handicap_id,
          'value', record.handicap::text,
          'source', record.source,
          'as_of', record.as_of,
          'created_at', record.created_at
        )
        from public.membership_handicap_records as record
        where record.membership_id = target_membership.id
          and record.group_id = target_membership.group_id
        order by record.as_of desc, record.created_at desc, record.id
        limit 1
      ),
      'all', coalesce(
        (
          select pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'id', record.id,
              'handicap_id', record.handicap_id,
              'value', record.handicap::text,
              'source', record.source,
              'as_of', record.as_of,
              'created_at', record.created_at
            )
            order by record.as_of desc, record.created_at desc, record.id
          )
          from public.membership_handicap_records as record
          where record.membership_id = target_membership.id
            and record.group_id = target_membership.group_id
        ),
        '[]'::jsonb
      )
    ),
    coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'event_id', event.id,
            'action', event.action,
            'occurred_at', event.occurred_at,
            'reason', event.reason,
            'source', event.source,
            'target_version', event.target_version
          )
          order by event.occurred_at desc, event.id
        )
        from public.audit_events as event
        where event.group_id = target_membership.group_id
          and (
            (
              event.target_type = 'membership'
              and event.target_id = target_membership.id
            )
            or exists (
              select 1
              from public.membership_invitations as invitation
              where event.target_type = 'membership_invitation'
                and event.target_id = invitation.id
                and invitation.group_id = target_membership.group_id
                and invitation.membership_id = target_membership.id
            )
          )
          and (
            v_actor_role = 'administrator'
            or event.action in (
              'member.created',
              'member.updated',
              'member.private_contact_viewed',
              'member.status_changed',
              'membership.invitation_issued',
              'membership.invitation_accepted',
              'membership.invitation_revoked',
              'membership.invitation_address_corrected',
              'membership.invitation_regenerated',
              'membership.role_changed'
            )
          )
      ),
      '[]'::jsonb
    )
  from public.memberships as target
  left join public.membership_quota_projections as projection
    on projection.membership_id = target.id
   and projection.group_id = target.group_id
  left join public.group_quota_settings as settings
    on settings.group_id = target.group_id
  where target.id = target_membership.id
    and target.group_id = target_membership.group_id;
end;
$$;

comment on function public.get_member_detail_projection(uuid, uuid) is
  'Service-only tenant-scoped member detail projection. Actor role controls admin-only quota inputs/history details and delivery suppression metadata; invitation-target activity is joined to the selected membership, and raw invitation tokens, provider identifiers, outbox payloads, and audit state snapshots are never returned.';

revoke all on function public.get_member_detail_projection(uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.get_member_detail_projection(uuid, uuid)
to service_role;
