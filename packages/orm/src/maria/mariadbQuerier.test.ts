import { MySqlLikeQuerierIt } from '../querier/mysqlLikeQuerier-test.js';
import { createSpec, mariadbConnection } from '../test/index.js';
import { MariadbQuerierPool } from './mariadbQuerierPool.js';

createSpec(new MySqlLikeQuerierIt(new MariadbQuerierPool({ ...mariadbConnection(), trace: true })));
