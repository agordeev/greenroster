create table app.fixture_dataset (
  id app.entity_id primary key,
  fixture_key text not null unique,
  description text not null check (description = pg_catalog.btrim(description) and description <> ''),
  created_at app.utc_instant not null default now()
);

comment on table app.fixture_dataset is
  'Deterministic, synthetic local-development fixture manifest. Later phase seeds extend the dataset with their own product records.';

create trigger fixture_dataset_immutable_id
before update of id on app.fixture_dataset
for each row execute function app.reject_id_change('id');

revoke all on table app.fixture_dataset from public, anon, authenticated;
