-- Phase 00 has no business entities yet. This deterministic manifest proves the
-- local fixture path is active; later phases extend this file with synthetic
-- identities and tenant data only. Never reference hosted credentials or data.
insert into app.fixture_dataset (id, fixture_key, description, created_at)
values
  (
    '00000000-0000-4000-8000-000000000001',
    'foundation-primary',
    'Primary deterministic local-development dataset',
    '2026-01-01 00:00:00+00'
  ),
  (
    '00000000-0000-4000-8000-000000000002',
    'foundation-boundaries',
    'Boundary-value dataset extended by focused database tests',
    '2026-01-01 00:00:01+00'
  )
on conflict (fixture_key) do update
set
  description = excluded.description,
  created_at = excluded.created_at;
