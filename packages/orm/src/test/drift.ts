import { detectDrift } from '../migrate/drift/driftDetector.js';
import { Migrator } from '../migrate/migrator.js';
import { SqlSchemaGenerator } from '../migrate/schemaGenerator.js';
import type { SqlQuerierPool, Type } from '../type/index.js';

/** What `drift:check` reports for `entity`'s table, wired as the CLI wires it, in the fields a test compares. */
export async function driftOf(pool: SqlQuerierPool, entity: Type<object>, table: string) {
  const migrator = new Migrator(pool, { entities: [entity] });
  const generator = new SqlSchemaGenerator(pool.dialect);
  const { drifts } = detectDrift(generator.buildAST([entity]), await migrator.schemaIntrospector.introspect([table]), {
    dialect: pool.dialect,
    defaultsEqual: generator.defaultsEqual,
  });
  return drifts.map(({ type, column, index, expected, actual }) => ({ type, column, index, expected, actual }));
}
