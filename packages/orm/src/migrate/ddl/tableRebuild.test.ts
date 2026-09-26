import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteDialect } from '../../sqlite/sqliteDialect.js';
import { Sqlite3QuerierPool } from '../../sqlite/sqliteQuerierPool.js';
import { migrationTargetFor } from '../migrationTarget.js';
import { rebuildTable } from './tableRebuild.js';

/** `parent.code` retyped from text to integer, which SQLite does only by rebuilding `parent`. */
const STATEMENTS = rebuildTable(
  new SqliteDialect(),
  'parent',
  {
    from: { statements: [], columns: ['id', 'code'] },
    to: { statements: ['CREATE TABLE `parent` (`id` INTEGER PRIMARY KEY, `code` INTEGER);'], columns: ['id', 'code'] },
  },
  { renames: [], fills: new Map() },
);

describe('rebuildTable on SQLite', () => {
  let pool: Sqlite3QuerierPool;

  /** Every statement in one migration session, which is how the migrator runs a rebuild. */
  const migrate = (statements: readonly string[]) =>
    migrationTargetFor(pool).withSession(({ run, transaction }) =>
      transaction(async () => {
        for (const statement of statements) {
          await run(statement);
        }
      }),
    );

  const rows = (table: string) => pool.all<{ id: number }>(`SELECT * FROM \`${table}\``);

  beforeEach(async () => {
    pool = new Sqlite3QuerierPool(':memory:');
    await pool.run('CREATE TABLE `parent` (`id` INTEGER PRIMARY KEY, `code` TEXT)');
    await pool.run(
      'CREATE TABLE `child` (`id` INTEGER PRIMARY KEY, `parentId` INTEGER REFERENCES `parent` (`id`) ON DELETE CASCADE)',
    );
    await pool.run("INSERT INTO `parent` VALUES (1, '12')");
    await pool.run('INSERT INTO `child` VALUES (1, 1)');
  });

  afterEach(() => pool.end());

  /** Where foreign keys stay on, dropping `parent` would cascade into `child`, so the guard fails it first. */
  it('should refuse a rebuild while foreign keys are on and a table references the one rebuilt', async () => {
    await expect(
      pool.transaction(async (querier) => {
        for (const statement of STATEMENTS) {
          await querier.run(statement);
        }
      }),
    ).rejects.toThrow('turn foreign keys off to rebuild parent: the rows referencing it would be lost');

    expect(await rows('parent')).toEqual([{ id: 1, code: '12' }]);
    expect(await rows('child')).toEqual([{ id: 1, parentId: 1 }]);
  });

  it('should rebuild in a migration session, which turns foreign keys off, keeping the rows pointing at it', async () => {
    await migrate(STATEMENTS);

    expect(await rows('parent')).toEqual([{ id: 1, code: 12 }]);
    expect(await rows('child')).toEqual([{ id: 1, parentId: 1 }]);
    expect(await pool.all('PRAGMA foreign_keys')).toEqual([{ foreign_keys: 1 }]);
  });

  it('should roll back a migration that leaves a row referencing a missing one', async () => {
    await expect(migrate(['DELETE FROM `parent`;'])).rejects.toThrow(
      'The migration leaves 1 row(s) referencing a missing one, the first in "child" pointing at "parent".',
    );

    expect(await rows('parent')).toEqual([{ id: 1, code: '12' }]);
    expect(await pool.all('PRAGMA foreign_keys')).toEqual([{ foreign_keys: 1 }]);
  });
});
