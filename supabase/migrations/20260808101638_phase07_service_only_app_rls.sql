-- Deployment-owned app-schema tables are never client-readable. Force RLS as
-- defense in depth in case a future grant or exposed-schema change slips in.
alter table app.fixture_dataset enable row level security;
alter table app.fixture_dataset force row level security;

alter table app.current_legal_documents enable row level security;
alter table app.current_legal_documents force row level security;
