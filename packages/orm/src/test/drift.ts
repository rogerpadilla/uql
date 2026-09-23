import { detectDrift } from '../migrate/drift/driftDetector.js';
import { Migrator } from '../migrate/migrator.js';
import { buildEntityAST } from '../migrate/schemaGenerator.js';
import type { Type } from '../type/index.js';

type MigratorPool = ConstructorParameters<typeof Migrator>[0];

/** What `drift:check` reports for `entity`'s table, wired as the CLI wires it, in the fields a test compares. */
export async function driftOf(pool: MigratorPool, entity: Type<object>, table: string) {
  const migrator = new Migrator(pool, { entities: [entity] });
  const generator = await migrator.getSchemaGenerator();
  const { drifts } = detectDrift(
    generator.buildAST?.([entity]) ?? buildEntityAST(generator, [entity]),
    await migrator.schemaIntrospector.introspect([table]),
    { dialect: pool.dialect, defaultsEqual: generator.defaultsEqual },
  );
  return drifts.map(({ type, column, index, expected, actual }) => ({ type, column, index, expected, actual }));
}
