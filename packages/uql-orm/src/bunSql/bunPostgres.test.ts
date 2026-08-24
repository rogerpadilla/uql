import { PostgresQuerierIt } from '../querier/postgresQuerier-test.js';
import { createSpec } from '../test/index.js';
import { BunSqlQuerierPool } from './bunSqlQuerierPool.js';

class BunPostgresIt extends PostgresQuerierIt {
  constructor() {
    super(
      new BunSqlQuerierPool({
        url: 'postgres://test:test@0.0.0.0:5442/test_bun_pg',
      }),
    );
  }
}

createSpec(new BunPostgresIt());
