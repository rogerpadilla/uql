import { AbstractSqlQuerierPoolIt } from '../querier/abstractSqlQuerierPool-test.js';
import { createSpec, postgresConnection } from '../test/index.js';
import type { PgQuerier } from './pgQuerier.js';
import { PgQuerierPool } from './pgQuerierPool.js';

export class PostgresQuerierPoolIt extends AbstractSqlQuerierPoolIt<PgQuerier> {
  constructor() {
    super(new PgQuerierPool(postgresConnection()));
  }
}

createSpec(new PostgresQuerierPoolIt());
