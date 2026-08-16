-- Local-only current legal versions for the organizer signup smoke flow.
-- This mirrors the checked-in legal pages. It does not publish hosted legal
-- documents or change the hosted database.
insert into app.current_legal_documents (
  singleton,
  terms_version,
  privacy_version
)
values (true, '2026-08-16', '2026-08-16')
on conflict (singleton) do update
set
  terms_version = excluded.terms_version,
  privacy_version = excluded.privacy_version,
  configured_at = pg_catalog.now();
