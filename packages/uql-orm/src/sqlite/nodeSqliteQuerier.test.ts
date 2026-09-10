import { getLoadablePath } from 'sqlite-vec';
import { expect } from 'vitest';
import type { WideRow } from '../querier/abstractSqlQuerier-test.js';
import { createSpec } from '../test/index.js';
import { NodeSqliteQuerierPool } from './nodeSqliteQuerierPool.js';
import { Sqlite3QuerierIt } from './sqliteQuerier.test.js';

/**
 * Replays the whole better-sqlite3 suite against Node's built-in driver. `node:sqlite` is specified
 * to behave identically here, so any divergence - bind coercion, `RETURNING` rows, extension loading
 * - is a real bug rather than an expected per-driver difference, and gets no overridable hook. The one
 * exception is where the drivers themselves are specified apart: an integer past 2^53, which
 * better-sqlite3 rounds and `node:sqlite` refuses.
 */
class NodeSqliteQuerierIt extends Sqlite3QuerierIt {
  constructor() {
    super(new NodeSqliteQuerierPool(':memory:', { extensions: [getLoadablePath()] }));
  }

  protected override async assertWideInteger(read: Promise<WideRow[]>) {
    await expect(read).rejects.toThrow('too large');
  }
}

createSpec(new NodeSqliteQuerierIt());
