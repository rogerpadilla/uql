import { AbstractSqlQuerierPoolIt } from '../querier/abstractSqlQuerierPool-test.js';
import { createSpec, mysqlConnection } from '../test/index.js';
import type { MySql2Querier } from './mysql2Querier.js';
import { MySql2QuerierPool } from './mysql2QuerierPool.js';

export class MySql2QuerierPoolIt extends AbstractSqlQuerierPoolIt<MySql2Querier> {
  constructor() {
    super(new MySql2QuerierPool(mysqlConnection()));
  }
}

createSpec(new MySql2QuerierPoolIt());
