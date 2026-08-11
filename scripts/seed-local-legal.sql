-- Local-only development markers for the organizer signup smoke flow.
-- These are version labels, not production legal approval or document text.
insert into app.current_legal_documents (
  singleton,
  terms_version,
  privacy_version
)
values (true, 'local-dev-terms-1', 'local-dev-privacy-1')
on conflict (singleton) do update
set
  terms_version = excluded.terms_version,
  privacy_version = excluded.privacy_version,
  configured_at = pg_catalog.now();
