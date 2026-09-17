import { MySqlLikeQuerierIt } from '../querier/mysqlLikeQuerier-test.js';
import { createSpec, mysqlConnection } from '../test/index.js';
import { MySql2QuerierPool } from './mysql2QuerierPool.js';

export class MySql2QuerierIt extends MySqlLikeQuerierIt {
  constructor() {
    super(new MySql2QuerierPool(mysqlConnection()));
  }
}

createSpec(new MySql2QuerierIt());
