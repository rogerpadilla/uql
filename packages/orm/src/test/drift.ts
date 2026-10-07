import { detectDrift } from '../migrate/drift/driftDetector.js';
import { Migrator } from '../migrate/migrator.js';
import { SqlSchemaGenerator } from '../migrate/schemaGenerator.js';
import type { SqlQuerierPool, SyncOptions, Type } from '../type/index.js';

/** What `drift:check` reports for `entity`'s table, wired as the CLI wires it, in the fields a test compares. */
export async function driftOf(pool: SqlQuerierPool, entity: Type<object>, table: string) {
  const migrator = new Migrator(pool, { entities: [entity] });
  const generator = new SqlSchemaGenerator(pool.dialect);
  const { drifts } = detectDrift(generator.buildAST([entity]), await migrator.schemaIntrospector.introspect([table]), {
    ...generator.diffOptions(),
    dialect: pool.dialect,
  });
  return drifts.map(({ type, column, index, expected, actual }) => ({ type, column, index, expected, actual }));
}

/** Syncs `entity` alone. */
export function syncOf(pool: SqlQuerierPool, entity: Type<object>, options: SyncOptions) {
  return new Migrator(pool, { entities: [entity] }).sync(options);
}

/** The statements a sync of `entity` alone would run. */
export function planOf(pool: SqlQuerierPool, entity: Type<object>, options: SyncOptions) {
  return new Migrator(pool, { entities: [entity] }).planSync(options);
}
