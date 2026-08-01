import { getLoadablePath } from 'sqlite-vec';
import { createSpec } from '../test/index.js';
import { NodeSqliteQuerierPool } from './nodeSqliteQuerierPool.js';
import { Sqlite3QuerierIt } from './sqliteQuerier.test.js';

/**
 * Replays the whole better-sqlite3 suite against Node's built-in driver. `node:sqlite` is specified
 * to behave identically here, so any divergence - bind coercion, `RETURNING` rows, extension loading
 * - is a real bug rather than an expected per-driver difference, and gets no overridable hook.
 */
class NodeSqliteQuerierIt extends Sqlite3QuerierIt {
  constructor() {
    super(new NodeSqliteQuerierPool(':memory:', { extensions: [getLoadablePath()] }));
  }
}

createSpec(new NodeSqliteQuerierIt());
