import { PostgresQuerierIt } from '../querier/postgresQuerier-test.js';
import { createSpec, postgresConnection } from '../test/index.js';
import { PgQuerierPool } from './pgQuerierPool.js';

class PgQuerierIt extends PostgresQuerierIt {
  constructor() {
    super(new PgQuerierPool(postgresConnection('test_pg')));
  }
}

createSpec(new PgQuerierIt());
