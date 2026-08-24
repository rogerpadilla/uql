import { PostgresQuerierIt } from '../querier/postgresQuerier-test.js';
import { createSpec } from '../test/index.js';
import { PgQuerierPool } from './pgQuerierPool.js';

class PgQuerierIt extends PostgresQuerierIt {
  constructor() {
    super(
      new PgQuerierPool({
        host: '0.0.0.0',
        port: 5442,
        user: 'test',
        password: 'test',
        database: 'test_pg',
      }),
    );
  }
}

createSpec(new PgQuerierIt());
