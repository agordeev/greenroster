-- Coordinator contact reads must resolve an eligible actor before selecting
-- any tenant-owned messages. The mobile wrapper derives the actor from the
-- request JWT; the service-only reader receives an actor id from trusted
-- server code, but applies the same context validation.

create or replace function public.resolve_mobile_coordinator_contacts()
returns table (message_id uuid, group_id uuid, sender_display_name text, recipient_display_name text, body text, created_at timestamptz, sent_by_actor boolean)
language plpgsql stable security definer set search_path = ''
as $$
declare
  actor record;
  actor_user_id uuid := (select auth.uid());
begin
  select * into actor from app.content_actor_context(actor_user_id);
  if actor.group_id is null then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  return query
  select m.id::text::uuid, m.group_id::text::uuid, m.sender_display_name, m.recipient_display_name,
    m.body, m.created_at::text::timestamptz, m.sender_user_id = actor_user_id
  from public.coordinator_contact_messages as m
  where m.group_id = actor.group_id
    and (m.sender_user_id = actor_user_id or m.recipient_user_id = actor_user_id)
  order by m.created_at desc, m.id desc
  limit 100;
end;
$$;

revoke all on function public.resolve_mobile_coordinator_contacts() from public, anon, service_role;
grant execute on function public.resolve_mobile_coordinator_contacts() to authenticated;

create or replace function public.read_coordinator_contacts_for_actor(p_actor_user_id uuid)
returns table (message_id uuid, group_id uuid, sender_display_name text, recipient_display_name text, body text, created_at timestamptz, sent_by_actor boolean)
language plpgsql stable security definer set search_path = ''
as $$
declare
  actor record;
begin
  select * into actor from app.content_actor_context(p_actor_user_id);
  if actor.group_id is null then
    raise exception 'actor_not_authorized' using errcode = 'P0003';
  end if;

  return query
  select m.id::text::uuid, m.group_id::text::uuid, m.sender_display_name, m.recipient_display_name,
    m.body, m.created_at::text::timestamptz, m.sender_user_id = p_actor_user_id
  from public.coordinator_contact_messages as m
  where m.group_id = actor.group_id
    and (m.sender_user_id = p_actor_user_id or m.recipient_user_id = p_actor_user_id)
  order by m.created_at desc, m.id desc
  limit 100;
end;
$$;

revoke all on function public.read_coordinator_contacts_for_actor(uuid) from public, anon, authenticated, service_role;
grant execute on function public.read_coordinator_contacts_for_actor(uuid) to service_role;
