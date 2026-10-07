import { SqlQuerierPoolIt } from '../querier/abstractSqlQuerierPool-test.js';
import { PgLikeQuerierIt } from '../querier/pgLikeQuerier-test.js';
import { createSpec } from '../test/index.js';
import { BunSqlQuerierPool } from './bunSqlQuerierPool.js';

const url = 'cockroachdb://root@0.0.0.0:26257/test_bun_crdb';

createSpec(new PgLikeQuerierIt(new BunSqlQuerierPool({ url })));
createSpec(new SqlQuerierPoolIt(() => new BunSqlQuerierPool({ url })));
