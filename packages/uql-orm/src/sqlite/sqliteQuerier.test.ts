import { getLoadablePath } from 'sqlite-vec';
import { expect } from 'vitest';
import type { AbstractSqlQuerierPool } from '../querier/index.js';
import { VectorQuerierIt } from '../querier/vectorQuerier-test.js';
import { createSpec, VectorItem } from '../test/index.js';
import type { WithDistance } from '../type/index.js';
import type { SqliteDialect } from './sqliteDialect.js';
import type { SqliteQuerier } from './sqliteQuerier.js';
import { Sqlite3QuerierPool } from './sqliteQuerierPool.js';

// SQLite ships no vector functions, so the shared vector suite only runs with sqlite-vec loaded -
// the one way to catch a `vec_distance_*` name that extension does not actually define.
export class Sqlite3QuerierIt extends VectorQuerierIt {
  /**
   * Takes the pool so the whole suite can be replayed against another SQLite driver with the same
   * specified behaviour - see `nodeSqliteQuerier.test.ts`, which runs it on `node:sqlite`.
   */
  constructor(
    pool: AbstractSqlQuerierPool<SqliteQuerier, SqliteDialect> = new Sqlite3QuerierPool(':memory:', {
      extensions: [getLoadablePath()],
    }),
  ) {
    super(pool);
  }

  override async beforeEach() {
    await super.beforeEach();
    await Promise.all([
      this.querier.run('PRAGMA foreign_keys = ON'),
      this.querier.run('PRAGMA journal_mode = WAL'),
      this.querier.run('PRAGMA synchronous = normal'),
      this.querier.run('PRAGMA temp_store = memory'),
    ]);
  }

  /** L1 (Manhattan) is sqlite-vec's alone: no libSQL or Turso build has that metric. */
  async shouldSortByL1Distance() {
    await this.querier.insertMany(VectorItem, [
      { name: 'near', vec: [1, 0, 0] },
      { name: 'far', vec: [0, 1, 0] },
    ]);

    const results = (await this.querier.findMany(VectorItem, {
      $select: { name: true },
      $sort: { vec: { $vector: [1, 0, 0], $distance: 'l1', $project: 'distance' } },
    })) as WithDistance<VectorItem, 'distance'>[];

    expect(results.map((r) => r.name)).toEqual(['near', 'far']);
    expect(results[1].distance).toBeCloseTo(2, 5); // |1-0| + |0-1| = 2
  }
}

createSpec(new Sqlite3QuerierIt());
