import { AbstractSqlQuerierPoolIt } from '../querier/abstractSqlQuerierPool-test.js';
import { createSpec } from '../test/index.js';
import { configurePgNumericTypeParsers } from '../test/pgTypeParsers.util.js';
import type { PgQuerier } from './pgQuerier.js';
import { PgQuerierPool } from './pgQuerierPool.js';

configurePgNumericTypeParsers();

export class PostgresQuerierPoolIt extends AbstractSqlQuerierPoolIt<PgQuerier> {
  constructor() {
    super(
      new PgQuerierPool({
        host: '0.0.0.0',
        port: 5442,
        user: 'test',
        password: 'test',
        database: 'test',
      }),
    );
  }
}

createSpec(new PostgresQuerierPoolIt());
