drop policy if exists audit_events_read_group_administrator on public.audit_events;

revoke select on table public.audit_events from public, anon, authenticated;
grant select on table public.audit_events to service_role;

comment on table public.audit_events is
  'Append-only investigation record. Raw audit rows are service-only; authenticated clients read the privacy-safe group activity projection.';
