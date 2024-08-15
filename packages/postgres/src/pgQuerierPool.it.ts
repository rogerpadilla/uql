import { types } from 'pg';
import { createSpec } from 'nukak/test';
import { AbstractQuerierPoolIt } from 'nukak/querier/abstractQuerierPool-it.js';
import { PgQuerierPool } from './pgQuerierPool.js';
import { PgQuerier } from './pgQuerier.js';

types.setTypeParser(types.builtins.INT8, (value: string) => parseInt(value));
types.setTypeParser(types.builtins.FLOAT8, (value: string) => parseFloat(value));
types.setTypeParser(types.builtins.NUMERIC, (value: string) => parseFloat(value));

export class PostgresQuerierPoolIt extends AbstractQuerierPoolIt<PgQuerier> {
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
