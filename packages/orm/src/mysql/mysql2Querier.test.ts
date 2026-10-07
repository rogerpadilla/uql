import { MySqlQuerierIt } from '../querier/mysqlLikeQuerier-test.js';
import { createSpec, mysqlConnection } from '../test/index.js';
import { MySql2QuerierPool } from './mysql2QuerierPool.js';

createSpec(new MySqlQuerierIt(new MySql2QuerierPool(mysqlConnection())));
