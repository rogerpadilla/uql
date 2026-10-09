import { SqlQuerierPoolIt } from '../querier/abstractSqlQuerierPool-test.js';
import { createSpec } from '../test/index.js';
import { SqliteQuerierPool } from './sqliteQuerierPool.js';

createSpec(new SqlQuerierPoolIt(() => new SqliteQuerierPool(':memory:')));
