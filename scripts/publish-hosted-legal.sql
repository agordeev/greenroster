-- Publish the checked-in public Terms of Use and Privacy Policy versions.
-- Run this only against the hosted GreenRoster database after deploying the
-- matching legal pages.
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
