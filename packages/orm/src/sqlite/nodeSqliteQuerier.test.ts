import { getLoadablePath } from 'sqlite-vec';
import { SqlQuerierPoolIt } from '../querier/abstractSqlQuerierPool-test.js';
import { SqliteLikeQuerierIt } from '../querier/sqliteLikeQuerier-test.js';
import { createSpec } from '../test/index.js';
import { NodeSqliteQuerierPool } from './nodeSqliteQuerierPool.js';

// The better-sqlite3 suite on Node's built-in driver, specified to behave identically: a divergence (bind
// coercion, `RETURNING` rows, extension loading, a wide integer) is a bug, not an overridable hook.
createSpec(new SqliteLikeQuerierIt(new NodeSqliteQuerierPool(':memory:', { extensions: [getLoadablePath()] })));
createSpec(new SqlQuerierPoolIt(() => new NodeSqliteQuerierPool(':memory:')));
