import type { AbstractSqlDialect } from '../dialect/index.js';
import { getEntities } from '../entity/index.js';
import { Migrator } from '../migrate/migrator.js';
import type { AbstractSqlQuerier } from '../querier/index.js';
import { buildSchemaAST } from '../schema/schemaASTBuilder.js';
import type { QuerierPool } from '../type/index.js';

/**
 * Every fixture table dropped and created again as a user's forced sync does it, foreign keys included,
 * so a suite runs on the schema a migration really produces and a bug in that routine fails it.
 */
export function recreateTables(pool: QuerierPool<AbstractSqlQuerier, AbstractSqlDialect>): Promise<void> {
  return new Migrator(pool, { entities: getEntities() }).sync({ force: true });
}

/**
 * Creates a parent/child pair of its own on `querier`, so it runs on a bare connection, and reports what the
 * connection did with the foreign key and its `ON DELETE CASCADE`: `{ dangling: 'rejected', orphans: [] }`
 * where it enforces. The drivers disagree, `better-sqlite3`, `node:sqlite` and libSQL defaulting to on,
 * `bun:sqlite` and Turso to off.
 */
export async function probeForeignKeys(querier: AbstractSqlQuerier) {
  await querier.run('CREATE TABLE fkParent (id INTEGER PRIMARY KEY)');
  await querier.run(
    'CREATE TABLE fkChild (id INTEGER PRIMARY KEY, parentId INTEGER REFERENCES fkParent(id) ON DELETE CASCADE)',
  );
  await querier.run('INSERT INTO fkParent (id) VALUES (1)');
  await querier.run('INSERT INTO fkChild (id, parentId) VALUES (1, 1)');

  const dangling = await querier.run('INSERT INTO fkChild (id, parentId) VALUES (2, 999)').then(
    () => 'accepted' as const,
    () => 'rejected' as const,
  );

  await querier.run('DELETE FROM fkParent WHERE id = 1');
  const orphans = await querier.all<{ id: number }>('SELECT id FROM fkChild');

  return { dangling, orphans: orphans.map((row) => row.id) };
}

/**
 * Breaks a foreign key, a NOT NULL and a CHECK on a constrained pair of its own, and hands back each
 * rejection (`undefined` where one was accepted).
 */
export async function violateConstraints(querier: AbstractSqlQuerier) {
  const dropPair = async () => {
    await querier.run('DROP TABLE IF EXISTS uqlConstrainedChild');
    await querier.run('DROP TABLE IF EXISTS uqlConstrainedParent');
  };
  const rejection = (sql: string) =>
    querier.run(sql).then(
      () => undefined,
      (err: unknown) => err,
    );

  await dropPair();
  try {
    await querier.run('CREATE TABLE uqlConstrainedParent (id INTEGER PRIMARY KEY)');
    await querier.run(
      'CREATE TABLE uqlConstrainedChild (id INTEGER PRIMARY KEY, parentId INTEGER, price INTEGER NOT NULL CHECK (price > 0),' +
        ' FOREIGN KEY (parentId) REFERENCES uqlConstrainedParent (id))',
    );
    return {
      foreignKey: await rejection('INSERT INTO uqlConstrainedChild (id, parentId, price) VALUES (1, 999, 1)'),
      notNull: await rejection('INSERT INTO uqlConstrainedChild (id, price) VALUES (2, NULL)'),
      check: await rejection('INSERT INTO uqlConstrainedChild (id, price) VALUES (3, 0)'),
    };
  } finally {
    await dropPair();
  }
}

/**
 * Empties every fixture table, dependents first. The graph is cyclic (`User` and `Company` point at each
 * other), so the foreign keys that point back up that order, which no delete order satisfies, are cleared first.
 */
export async function clearTables(querier: AbstractSqlQuerier) {
  const { dialect } = querier;
  const tables = buildSchemaAST(getEntities(), {
    resolveTableName: (meta) => dialect.resolveTableAlias(meta),
    resolveColumnName: (key, field) => dialect.resolveColumnName(key, field),
  }).getDropOrder();
  const unlinks = tables.flatMap((table, at) => {
    const backward = table.outgoingRelations.filter((relation) => tables.indexOf(relation.to.table) <= at);
    const columns = backward.flatMap((relation) => relation.from.columns).filter((column) => column.nullable);
    const assignments = columns.map((column) => `${dialect.escapeId(column.name)} = NULL`);
    return assignments.length ? [`UPDATE ${dialect.escapeId(table.name)} SET ${assignments.join(', ')}`] : [];
  });
  const deletes = tables.map((table) => `DELETE FROM ${dialect.escapeId(table.name)}`);

  await querier.transaction(async () => {
    for (const sql of [...unlinks, ...deletes]) {
      await querier.run(sql);
    }
  });
}
