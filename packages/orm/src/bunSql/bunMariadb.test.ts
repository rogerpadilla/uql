import { SqlQuerierPoolIt } from '../querier/abstractSqlQuerierPool-test.js';
import { MySqlLikeQuerierIt } from '../querier/mysqlLikeQuerier-test.js';
import { createSpec } from '../test/index.js';
import { BunSqlQuerierPool } from './bunSqlQuerierPool.js';

const url = 'mariadb://test:test@0.0.0.0:3326/test_bun_maria';

createSpec(new MySqlLikeQuerierIt(new BunSqlQuerierPool({ url })));
createSpec(new SqlQuerierPoolIt(() => new BunSqlQuerierPool({ url })));
