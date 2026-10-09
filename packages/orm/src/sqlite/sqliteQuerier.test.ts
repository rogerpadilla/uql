import { getLoadablePath } from 'sqlite-vec';
import { SqliteLikeQuerierIt } from '../querier/sqliteLikeQuerier-test.js';
import { createSpec } from '../test/index.js';
import { SqliteQuerierPool } from './sqliteQuerierPool.js';

// SQLite ships no vector functions, so sqlite-vec is loaded: the one way to catch a `vec_distance_*` it lacks.
createSpec(new SqliteLikeQuerierIt(new SqliteQuerierPool(':memory:', { extensions: [getLoadablePath()] })));
