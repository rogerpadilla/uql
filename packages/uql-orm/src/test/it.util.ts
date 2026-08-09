import { getEntities } from '../entity/index.js';
import { SqlSchemaGenerator } from '../migrate/schemaGenerator.js';
import type { AbstractSqlQuerier } from '../querier/index.js';
import { buildSchemaAST } from '../schema/schemaASTBuilder.js';

/**
 * The same generator migrations use, so the integration suites run against the columns a real migration
 * would create rather than a hand-rolled approximation of them (which mapped a vector column to
 * `vector(3)` everywhere, a type no SQLite-family engine has).
 */
function generatorFor(querier: AbstractSqlQuerier) {
  return new SqlSchemaGenerator(querier.dialect);
}

/**
 * Runs `fn` with referential integrity relaxed.
 *
 * The mock graph is cyclic, as most real ones are: `User` points at `Company` and `Company` points back
 * at `User` through the inherited `creator`. No delete or drop order satisfies both directions, so the
 * only way through is to stop the constraints being checked for the duration.
 *
 * Each engine relaxes it differently, and Postgres-wire cannot at all (its constraints are not
 * `DEFERRABLE`), which is why the callers there pass `CASCADE` on the statement itself instead. SQLite
 * takes `defer_foreign_keys` rather than `foreign_keys`, because the latter is a no-op inside a
 * transaction; the deferred flag resets itself at commit.
 */
async function withRelaxedForeignKeys(querier: AbstractSqlQuerier, fn: () => Promise<void>) {
  switch (querier.dialect.dialectName) {
    case 'mysql':
    case 'mariadb':
      await querier.run('SET FOREIGN_KEY_CHECKS = 0');
      try {
        await fn();
      } finally {
        await querier.run('SET FOREIGN_KEY_CHECKS = 1');
      }
      return;
    case 'sqlite':
      await querier.run('PRAGMA defer_foreign_keys = ON');
      await fn();
      return;
    default:
      await fn();
  }
}

/**
 * The same statements a migration would run: `generateCreateSchema` spans the whole entity graph, so
 * cross-entity foreign keys resolve and land as `ALTER TABLE ... ADD CONSTRAINT` after every table
 * exists (inline on SQLite, which cannot alter one in but resolves targets lazily). Sharing that
 * routine is the point: a fixture that builds its schema some other way cannot catch a bug in the one
 * users actually get, which is exactly how a cascade running in the wrong order stayed invisible.
 */
export async function createTables(querier: AbstractSqlQuerier) {
  const generator = generatorFor(querier);
  await querier.transaction(async () => {
    // `foreignKeys: false` for now: several shared suites assert that deleting a parent with live
    // children succeeds, and insert rows whose `companyId`/`creatorId` point at nothing, both of which
    // only hold on an unconstrained schema. Turning the constraints on is a semantic change to what
    // those tests claim, not a data tidy-up, so it is tracked separately. The DDL is otherwise exactly
    // what a migration produces.
    for (const sql of generator.generateCreateSchema(getEntities(), { ifNotExists: true, foreignKeys: false })) {
      await querier.run(sql);
    }
  });
}

export async function dropTables(querier: AbstractSqlQuerier) {
  // The same routine `syncForce` runs: dependents first, and `cascade` gated on
  // `features.dropTableCascade`, so it is the Postgres-wire answer to the cycle and a no-op elsewhere.
  const statements = generatorFor(querier).generateDropSchema(getEntities(), { ifExists: true, cascade: true });
  await querier.transaction(async () => {
    await withRelaxedForeignKeys(querier, async () => {
      for (const sql of statements) {
        await querier.run(sql);
      }
    });
  });
}

/**
 * Creates a parent/child pair on `querier` and reports what the connection did with the constraint.
 *
 * Returned as data rather than asserted here so one probe serves both runtimes: vitest and `bun:test`
 * share no matcher for "this promise rejected". A connection that enforces gives
 * `{ dangling: 'rejected', orphans: [] }`.
 *
 * Deliberately not built on the shared fixtures, which create their tables without constraints. That is
 * precisely what let `bun:sqlite` and Turso ship with enforcement off without a single test noticing,
 * and the drivers disagree: `better-sqlite3`, `node:sqlite` and libSQL default to on, those two to off.
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

  // The declared `ON DELETE CASCADE` is the other half: an unenforced connection leaves the child behind.
  await querier.run('DELETE FROM fkParent WHERE id = 1');
  const orphans = await querier.all<{ id: number }>('SELECT id FROM fkChild');

  return { dangling, orphans: orphans.map((row) => row.id) };
}

export async function clearTables(querier: AbstractSqlQuerier) {
  const ast = buildSchemaAST(getEntities(), { namingStrategy: querier.dialect.namingStrategy });
  const tables = ast.getDropOrder().map((table) => querier.dialect.escapeId(table.name));

  await querier.transaction(async () => {
    if (querier.dialect.dialectName === 'postgres' || querier.dialect.dialectName === 'cockroachdb') {
      // One statement for every table: `TRUNCATE` takes a list and resolves the cycle itself, which
      // per-table `DELETE` cannot, and it is markedly faster than 20 sequential deletes.
      await querier.run(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
      return;
    }

    await withRelaxedForeignKeys(querier, async () => {
      for (const table of tables) {
        await querier.run(`DELETE FROM ${table}`);
      }
      // `INTEGER PRIMARY KEY AUTOINCREMENT` keeps its high-water mark in `sqlite_sequence` across a
      // DELETE, so without this the ids a suite sees depend on which tests ran before it.
      if (querier.dialect.dialectName === 'sqlite') {
        await querier.run('DELETE FROM sqlite_sequence');
      }
    });
  });
}
