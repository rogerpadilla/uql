import { AbstractSqlQuerierPoolIt } from '../querier/abstractSqlQuerierPool-test.js';
import { PostgresQuerierIt } from '../querier/postgresQuerier-test.js';
import { createSpec } from '../test/index.js';
import type { BunSqlQuerier } from './bunSqlQuerier.js';
import { BunSqlQuerierPool } from './bunSqlQuerierPool.js';

const url = 'postgres://test:test@0.0.0.0:5442/test_bun_pg';

class BunPostgresIt extends PostgresQuerierIt {
  constructor() {
    super(new BunSqlQuerierPool({ url }));
  }
}

class BunPostgresPoolIt extends AbstractSqlQuerierPoolIt<BunSqlQuerier> {
  constructor() {
    super(new BunSqlQuerierPool({ url }));
  }
}

createSpec(new BunPostgresIt());
createSpec(new BunPostgresPoolIt());
