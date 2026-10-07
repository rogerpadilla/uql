import { SqlQuerierPoolIt } from '../querier/abstractSqlQuerierPool-test.js';
import { createSpec } from '../test/index.js';
import { Sqlite3QuerierPool } from './sqliteQuerierPool.js';

createSpec(new SqlQuerierPoolIt(() => new Sqlite3QuerierPool(':memory:')));
