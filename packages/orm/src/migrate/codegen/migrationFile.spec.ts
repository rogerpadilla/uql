import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { describe, expect, it, onTestFinished } from 'vitest';
import { LibsqlQuerierPool } from '../../libsql/libsqlQuerierPool.js';
import { SqliteQuerierPool } from '../../sqlite/sqliteQuerierPool.js';
import { loadMigrationSource, loadTsDefaultExport } from '../../test/loadTsDefaultExport.js';
import type { MigrationDefinition, SqlQuerierPool } from '../../type/index.js';

import { buildMigrationModule, emitMongoCommandCalls, emitSqlRunCall, emitSqlRunCalls } from './migrationFile.js';

/** The SQL a generated `run`...`` line hands the querier once plain JS evaluates it. */
async function emittedSql(sql: string): Promise<string> {
  const run = vm.runInNewContext(`(async (querier) => {\n${emitSqlRunCall(sql)}\n})`);
  let ran = '';
  await run({ run: (strings: TemplateStringsArray) => (ran = strings.join('')) });
  return ran;
}

describe('emitMongoCommandCalls', () => {
  it('should await one driver call on the querier per command, as a parseable body', () => {
    const block = emitMongoCommandCalls([
      '{"action":"createCollection","name":"users"}',
      '{"action":"dropIndex","collection":"users","name":"users__email_idx"}',
    ]);

    expect(block).toBe(
      [
        '    await querier.db.createCollection("users");',
        '    await querier.db.collection("users").dropIndex("users__email_idx");',
      ].join('\n'),
    );
    expect(() => new vm.Script(`async function _up(querier) {\n${block}\n}`)).not.toThrow();
  });
});

describe('buildMigrationModule', () => {
  it('should type the migration on the querier it is written against', () => {
    const source = buildMigrationModule({
      migrationName: 'seed',
      createdAt: new Date('2026-09-12T00:00:00.000Z'),
      querier: 'MongoQuerier',
      upInner: '',
      downInner: '',
    });

    expect(source).toContain(`import type { MongoQuerier } from 'uql-orm/mongodb';`);
    expect(source).toContain('async up(querier: MongoQuerier): Promise<void> {');
    expect(source).toContain('async down(querier: MongoQuerier): Promise<void> {');
  });

  it('should default to the SQL querier, with doc extras and emitted run calls', () => {
    const src = buildMigrationModule({
      migrationName: 'add_foo',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      docExtraLines: ['Generated from entity definitions'],
      upInner: emitSqlRunCall('SELECT 1;'),
      downInner: emitSqlRunCall('SELECT 2;'),
    });
    expect(src).toContain(`import type { SqlQuerier } from 'uql-orm';`);
    expect(src).toContain('* Generated from entity definitions');
    expect(src).toContain('await querier.run`SELECT 1;`;');
    expect(src).toContain('await querier.run`SELECT 2;`;');
    expect(src).toContain('Migration: add_foo');
    expect(src).toContain('Created: 2026-01-01T00:00:00.000Z');
  });
});

describe('emitSqlRunCall', () => {
  it('should write the SQL as a tagged run, its lines and Postgres quotes as they are', () => {
    expect(emitSqlRunCall('CREATE TABLE "users" (\n  "id" INTEGER\n);')).toBe(
      '    await querier.run`CREATE TABLE "users" (\n  "id" INTEGER\n);`;',
    );
  });

  it.each([
    ['backtick identifiers', 'CREATE TABLE `Article` (\n  `id` INTEGER PRIMARY KEY AUTOINCREMENT\n);'],
    ['a literal ${', "INSERT INTO t VALUES ('${not_template_literal}');"],
    ['backslashes and quotes', String.raw`SELECT '\\' AS x, "'" AS y;`],
  ])('should hand the querier the SQL exactly, %s included', async (_name, sql) => {
    expect(await emittedSql(sql)).toBe(sql);
  });

  it('should emit one run() line per statement', () => {
    expect(emitSqlRunCalls(['SELECT 1;', 'SELECT 2;'])).toBe(
      [emitSqlRunCall('SELECT 1;'), emitSqlRunCall('SELECT 2;')].join('\n'),
    );
  });
});

describe('a generated SQL migration module', () => {
  /**
   * A generated migration loads through a plain `import()`, so it has to run on plain `node`, which
   * strips types and compiles nothing. Relies on `server.deps.external` in `vitest.config.ts` keeping
   * esbuild off the temp file. Vitest-only: bun compiles an enum happily.
   */
  it('should reject syntax plain node cannot strip, so generated migrations stay loadable', async () => {
    await expect(loadTsDefaultExport('enum E { A }\nexport default { e: E.A };')).rejects.toThrow();
  });

  it.each<[string, () => SqlQuerierPool]>([
    ['SQLite', () => new SqliteQuerierPool(':memory:')],
    ['libSQL', () => new LibsqlQuerierPool({ url: ':memory:' })],
  ])(
    'should strip on plain node and run on %s, its backticks intact and each statement a run() of its own',
    async (_name, connect) => {
      const pool = connect();
      onTestFinished(() => pool.end());
      const source = buildMigrationModule({
        migrationName: 'article',
        createdAt: new Date('2026-04-04T00:00:00.000Z'),
        upInner: emitSqlRunCalls([
          'CREATE TABLE `Article` (\n  `id` INTEGER PRIMARY KEY AUTOINCREMENT,\n  `title` TEXT NOT NULL\n);',
          'CREATE INDEX `Article_title_idx` ON `Article` (`title`);',
        ]),
        downInner: emitSqlRunCalls(['DROP INDEX IF EXISTS `Article_title_idx`;', 'DROP TABLE IF EXISTS `Article`;']),
      });

      // What plain node does to a migration before it runs one.
      expect(() => stripTypeScriptTypes(source)).not.toThrow();
      const migration = await loadMigrationSource<MigrationDefinition>(source);

      await pool.withQuerier(async (querier) => {
        const articles = () =>
          querier.all`SELECT type, name FROM sqlite_master WHERE name LIKE 'Article%' ORDER BY name`;
        await migration.up(querier);
        expect(await articles()).toEqual([
          { type: 'table', name: 'Article' },
          { type: 'index', name: 'Article_title_idx' },
        ]);
        await migration.down(querier);
        expect(await articles()).toEqual([]);
      });
    },
  );
});
