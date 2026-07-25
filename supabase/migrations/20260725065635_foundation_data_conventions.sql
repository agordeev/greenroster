create schema app;

revoke all on schema app from public, anon, authenticated;

create domain app.entity_id as uuid;
create domain app.utc_instant as timestamp with time zone;

create domain app.quota_value as numeric
  check (value <> 'NaN'::numeric and value between 0 and 100 and value = round(value, 2));

create domain app.handicap_value as numeric
  check (value <> 'NaN'::numeric and value between -10 and 54 and value = round(value, 1));

create domain app.golf_points_value as numeric
  check (value <> 'NaN'::numeric and value between 0 and 100 and value = round(value, 2));

create domain app.manual_merit_value as numeric
  check (value <> 'NaN'::numeric and value between -1000 and 1000 and value = round(value, 2));

create domain app.generated_merit_value as numeric
  check (value <> 'NaN'::numeric and value between 0 and 1000 and value = round(value, 2));

create domain app.participation_merit_value as numeric
  check (value <> 'NaN'::numeric and value between 0 and 100 and value = round(value, 2));

create domain app.placement_merit_value as numeric
  check (value <> 'NaN'::numeric and value between 0 and 500 and value = round(value, 2));

create domain app.quota_adjustment_value as numeric
  check (value <> 'NaN'::numeric and value between -20 and 20 and value = round(value, 2));

create domain app.plus_minus_value as numeric
  check (value <> 'NaN'::numeric and value between -100 and 100 and value = round(value, 2));

create domain app.golf_score_value as numeric
  check (
    value <> 'NaN'::numeric
    and value between 0 and 300
    and value = trunc(value)
  );

comment on schema app is
  'Non-exposed GreenRoster database contract. Public API exposure is granted deliberately by later feature migrations.';
comment on domain app.utc_instant is
  'An absolute instant stored by PostgreSQL in UTC. Display time zones are separate snapshotted IANA identifiers.';

revoke usage on type
  app.entity_id,
  app.utc_instant,
  app.quota_value,
  app.handicap_value,
  app.golf_points_value,
  app.manual_merit_value,
  app.generated_merit_value,
  app.participation_merit_value,
  app.placement_merit_value,
  app.quota_adjustment_value,
  app.plus_minus_value,
  app.golf_score_value
from public;

create function app.reject_id_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  id_column text := coalesce(tg_argv[0], 'id');
begin
  if (to_jsonb(new) -> id_column) is distinct from (to_jsonb(old) -> id_column) then
    raise exception 'immutable identifier % cannot be changed', id_column
      using errcode = '22000';
  end if;

  return new;
end;
$$;

comment on function app.reject_id_change() is
  'Attach as a BEFORE UPDATE trigger to every persisted immutable identifier.';

revoke all on function app.reject_id_change() from public, anon, authenticated;
