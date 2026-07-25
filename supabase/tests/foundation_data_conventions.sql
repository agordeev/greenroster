begin;

create extension if not exists pgtap with schema extensions;

select plan(77);

select has_schema('app', 'the non-exposed application schema exists');
select domain_type_is(
  'app'::name,
  'entity_id',
  'uuid',
  'entity identifiers use UUID'
);
select domain_type_is(
  'app'::name,
  'utc_instant',
  'timestamp with time zone',
  'instants use timestamp with time zone'
);
select domain_type_is(
  'app'::name,
  'quota_value',
  'numeric',
  'quota uses exact numeric storage'
);
select domain_type_is('app'::name, 'handicap_value', 'numeric', 'handicap uses exact numeric storage');
select domain_type_is('app'::name, 'golf_points_value', 'numeric', 'golf points use exact numeric storage');
select domain_type_is('app'::name, 'manual_merit_value', 'numeric', 'manual merit uses exact numeric storage');
select domain_type_is('app'::name, 'generated_merit_value', 'numeric', 'generated merit uses exact numeric storage');
select domain_type_is('app'::name, 'participation_merit_value', 'numeric', 'participation merit uses exact numeric storage');
select domain_type_is('app'::name, 'placement_merit_value', 'numeric', 'placement merit uses exact numeric storage');
select domain_type_is('app'::name, 'quota_adjustment_value', 'numeric', 'quota adjustments use exact numeric storage');
select domain_type_is('app'::name, 'plus_minus_value', 'numeric', 'plus-minus uses exact numeric storage');
select domain_type_is('app'::name, 'golf_score_value', 'numeric', 'golf scores use exact whole-number storage');

select has_table('app', 'fixture_dataset', 'the synthetic fixture manifest exists');
select col_type_is('app', 'fixture_dataset', 'id', 'app.entity_id', 'fixture identifiers use the entity ID domain');
select col_type_is(
  'app',
  'fixture_dataset',
  'created_at',
  'app.utc_instant',
  'fixture instants use the UTC instant domain'
);
select has_pk('app', 'fixture_dataset', 'fixture records have a primary key');
select results_eq(
  $$ select fixture_key from app.fixture_dataset order by fixture_key $$,
  $$ values ('foundation-boundaries'::text), ('foundation-primary'::text) $$,
  'the deterministic synthetic dataset is loaded by the seed'
);
select is(
  (select count(distinct id) from app.fixture_dataset),
  2::bigint,
  'synthetic fixture identifiers are unique'
);
select throws_ok(
  $$ update app.fixture_dataset set id = pg_catalog.gen_random_uuid() where fixture_key = 'foundation-primary' $$,
  '22000',
  null,
  'persisted synthetic fixture identifiers are immutable'
);

select lives_ok(
  $$ select 100.00::app.quota_value $$,
  'quota accepts its exact upper boundary'
);
select lives_ok($$ select 0.00::app.quota_value $$, 'quota accepts its lower boundary');
select throws_ok($$ select (-0.01)::app.quota_value $$, '23514', null, 'quota rejects values below its lower boundary');
select throws_ok(
  $$ select 100.001::app.quota_value $$,
  '23514',
  null,
  'quota rejects values with more than two decimal places'
);
select throws_ok(
  $$ select 100.01::app.quota_value $$,
  '23514',
  null,
  'quota rejects values above its upper boundary'
);
select throws_ok(
  $$ select 'NaN'::app.quota_value $$,
  '23514',
  null,
  'quota rejects non-finite numeric values'
);

select lives_ok($$ select (-10.0)::app.handicap_value $$, 'handicap accepts its lower boundary');
select lives_ok($$ select 54.0::app.handicap_value $$, 'handicap accepts its upper boundary');
select throws_ok($$ select (-10.1)::app.handicap_value $$, '23514', null, 'handicap rejects values below its lower boundary');
select throws_ok($$ select 54.1::app.handicap_value $$, '23514', null, 'handicap rejects values above its upper boundary');
select throws_ok($$ select 10.01::app.handicap_value $$, '23514', null, 'handicap rejects excess precision');
select lives_ok($$ select 0.00::app.golf_points_value $$, 'golf points accept their lower boundary');
select lives_ok($$ select 100.00::app.golf_points_value $$, 'golf points accept their upper boundary');
select throws_ok($$ select (-0.01)::app.golf_points_value $$, '23514', null, 'golf points reject values below their lower boundary');
select throws_ok($$ select 100.01::app.golf_points_value $$, '23514', null, 'golf points reject values above their upper boundary');
select throws_ok($$ select 1.001::app.golf_points_value $$, '23514', null, 'golf points reject excess precision');
select lives_ok($$ select (-1000.00)::app.manual_merit_value $$, 'manual merit accepts its lower boundary');
select lives_ok($$ select 1000.00::app.manual_merit_value $$, 'manual merit accepts its upper boundary');
select throws_ok($$ select (-1000.01)::app.manual_merit_value $$, '23514', null, 'manual merit rejects values below its lower boundary');
select throws_ok($$ select 1000.01::app.manual_merit_value $$, '23514', null, 'manual merit rejects values above its upper boundary');
select throws_ok($$ select 1.001::app.manual_merit_value $$, '23514', null, 'manual merit rejects excess precision');
select lives_ok($$ select 0.00::app.generated_merit_value $$, 'generated merit accepts its lower boundary');
select lives_ok($$ select 1000.00::app.generated_merit_value $$, 'generated merit accepts its upper boundary');
select throws_ok($$ select (-0.01)::app.generated_merit_value $$, '23514', null, 'generated merit rejects values below its lower boundary');
select throws_ok($$ select 1000.01::app.generated_merit_value $$, '23514', null, 'generated merit rejects values above its upper boundary');
select throws_ok($$ select 1.001::app.generated_merit_value $$, '23514', null, 'generated merit rejects excess precision');
select lives_ok($$ select 0.00::app.participation_merit_value $$, 'participation merit accepts its lower boundary');
select lives_ok($$ select 100.00::app.participation_merit_value $$, 'participation merit accepts its upper boundary');
select throws_ok($$ select (-0.01)::app.participation_merit_value $$, '23514', null, 'participation merit rejects values below its lower boundary');
select throws_ok($$ select 100.01::app.participation_merit_value $$, '23514', null, 'participation merit rejects values above its upper boundary');
select throws_ok($$ select 1.001::app.participation_merit_value $$, '23514', null, 'participation merit rejects excess precision');
select lives_ok($$ select 0.00::app.placement_merit_value $$, 'placement merit accepts its lower boundary');
select lives_ok($$ select 500.00::app.placement_merit_value $$, 'placement merit accepts its upper boundary');
select throws_ok($$ select (-0.01)::app.placement_merit_value $$, '23514', null, 'placement merit rejects values below its lower boundary');
select throws_ok($$ select 500.01::app.placement_merit_value $$, '23514', null, 'placement merit rejects values above its upper boundary');
select throws_ok($$ select 1.001::app.placement_merit_value $$, '23514', null, 'placement merit rejects excess precision');
select lives_ok($$ select (-20.00)::app.quota_adjustment_value $$, 'quota adjustment accepts its lower boundary');
select lives_ok($$ select 20.00::app.quota_adjustment_value $$, 'quota adjustment accepts its upper boundary');
select throws_ok($$ select (-20.01)::app.quota_adjustment_value $$, '23514', null, 'quota adjustment rejects values below its lower boundary');
select throws_ok($$ select 20.01::app.quota_adjustment_value $$, '23514', null, 'quota adjustment rejects values above its upper boundary');
select throws_ok($$ select 1.001::app.quota_adjustment_value $$, '23514', null, 'quota adjustment rejects excess precision');
select lives_ok($$ select (-100.00)::app.plus_minus_value $$, 'plus-minus accepts its lower boundary');
select lives_ok($$ select 100.00::app.plus_minus_value $$, 'plus-minus accepts its upper boundary');
select throws_ok($$ select (-100.01)::app.plus_minus_value $$, '23514', null, 'plus-minus rejects values below its lower boundary');
select throws_ok($$ select 100.01::app.plus_minus_value $$, '23514', null, 'plus-minus rejects values above its upper boundary');
select throws_ok($$ select 1.001::app.plus_minus_value $$, '23514', null, 'plus-minus rejects excess precision');
select lives_ok($$ select 0::app.golf_score_value $$, 'golf score accepts its lower boundary');
select lives_ok($$ select 300::app.golf_score_value $$, 'golf score accepts its upper boundary');
select throws_ok($$ select (-1)::app.golf_score_value $$, '23514', null, 'golf score rejects values below its lower boundary');
select throws_ok($$ select 301::app.golf_score_value $$, '23514', null, 'golf score rejects values above its upper boundary');
select throws_ok($$ select 1.5::app.golf_score_value $$, '23514', null, 'golf score rejects fractional strokes');
select is(
  round(2.345::numeric, 2),
  2.35::numeric,
  'PostgreSQL rounds positive exact halves away from zero'
);
select is(
  round(-2.345::numeric, 2),
  -2.35::numeric,
  'PostgreSQL rounds negative exact halves away from zero'
);

create temporary table foundation_contract_fixture (
  id app.entity_id primary key default pg_catalog.gen_random_uuid(),
  idempotency_key text not null unique,
  created_at app.utc_instant not null default now()
);

create trigger foundation_contract_fixture_immutable_id
before update of id on foundation_contract_fixture
for each row execute function app.reject_id_change('id');

select lives_ok(
  $$ insert into foundation_contract_fixture (idempotency_key) values ('synthetic-operation-1') $$,
  'a unique client operation identifier is accepted'
);
select throws_ok(
  $$ insert into foundation_contract_fixture (idempotency_key) values ('synthetic-operation-1') $$,
  '23505',
  null,
  'a duplicate client operation identifier is rejected'
);
select throws_ok(
  $$ update foundation_contract_fixture set id = pg_catalog.gen_random_uuid() $$,
  '22000',
  null,
  'an immutable entity identifier cannot change'
);
select ok(
  (select created_at is not null from foundation_contract_fixture limit 1),
  'server time supplies the creation instant'
);

select * from finish();

rollback;
