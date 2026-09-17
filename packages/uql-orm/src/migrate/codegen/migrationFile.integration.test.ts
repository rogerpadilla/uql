import { describe, expect, it } from 'vitest';
import { LibsqlQuerierPool } from '../../libsql/libsqlQuerierPool.js';
import { Sqlite3QuerierPool } from '../../sqlite/sqliteQuerierPool.js';
import { loadTsDefaultExport } from '../../test/loadTsDefaultExport.js';
import type { MigrationDefinition, SqlQuerier, SqlQuerierPool } from '../../type/index.js';
import { buildMigrationModule, emitSqlRunCalls } from './migrationFile.js';

/**
 * Integration checks for GitHub #86 (generated TS must tolerate SQLite/LibSQL backticks and `${` in SQL)
 * and #87 (one `querier.run` per statement - matches sqld-over-HTTP behavior).
 */

/** SQLite/LibSQL DDL with backticks - would break if emitted inside an outer template literal (#86). */
const createTableSql =
  'CREATE TABLE `Article` (\n  `id` INTEGER PRIMARY KEY AUTOINCREMENT,\n  `title` TEXT NOT NULL\n);';
const createIndexSql = 'CREATE INDEX `Article_title_idx` ON `Article` (`title`);';

async function assertArticleTableAndIndex(querier: SqlQuerier): Promise<void> {
  const tables = await querier.all<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='Article'",
  );
  expect(tables).toHaveLength(1);

  const indexes = await querier.all<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='index' AND name='Article_title_idx'",
  );
  expect(indexes).toHaveLength(1);
}

const backends: {
  name: string;
  createPool: () => SqlQuerierPool;
}[] = [
  { name: 'SQLite (better-sqlite3)', createPool: () => new Sqlite3QuerierPool(':memory:') },
  { name: 'LibSQL', createPool: () => new LibsqlQuerierPool({ url: ':memory:' }) },
];

describe('generated SQL migration module (integration)', () => {
  /**
   * A generated migration loads through a plain `import()`, so it has to run on plain `node`, which
   * strips types and compiles nothing. Relies on `server.deps.external` in `vitest.config.ts` keeping
   * esbuild off the temp file. Vitest-only: bun compiles an enum happily.
   */
  it('should reject syntax plain node cannot strip, so generated migrations stay loadable', async () => {
    await expect(loadTsDefaultExport('enum E { A }\nexport default { e: E.A };')).rejects.toThrow();
  });

  it.each(backends)(
    'should run a generated migration with backticks, its split run() calls applying table and index: $name',
    async ({ createPool }) => {
      const upInner = emitSqlRunCalls([createTableSql, createIndexSql]);
      const downInner = emitSqlRunCalls([
        'DROP INDEX IF EXISTS `Article_title_idx`;',
        'DROP TABLE IF EXISTS `Article`;',
      ]);

      const source = buildMigrationModule({
        migrationName: 'integration_article',
        createdAt: new Date('2026-04-04T00:00:00.000Z'),
        docExtraLines: ['integration: backtick SQL + one run() per statement'],
        upInner,
        downInner,
      });

      const migration = await loadTsDefaultExport<MigrationDefinition>(source);
      const pool = createPool();
      const querier = await pool.getQuerier();
      try {
        await migration.up(querier);
        await assertArticleTableAndIndex(querier);

        await migration.down(querier);
        const afterDown = await querier.all<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='Article'",
        );
        expect(afterDown).toHaveLength(0);
      } finally {
        await querier.release();
        await pool.end();
      }
    },
  );
});
