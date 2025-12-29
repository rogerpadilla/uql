import { AbstractQuerierPoolIt } from 'nukak/querier/abstractQuerierPool-it.js';
import { createSpec } from 'nukak/test';
import { types } from 'pg';
import type { PgQuerier } from './pgQuerier.js';
import { PgQuerierPool } from './pgQuerierPool.js';

types.setTypeParser(types.builtins.INT8, (value: string) => Number.parseInt(value, 10));
types.setTypeParser(types.builtins.FLOAT8, (value: string) => Number.parseFloat(value));
types.setTypeParser(types.builtins.NUMERIC, (value: string) => Number.parseFloat(value));
types.setTypeParser(types.builtins.INT8, (value: string) => Number.parseInt(value, 10));
types.setTypeParser(types.builtins.FLOAT8, (value: string) => Number.parseFloat(value));
types.setTypeParser(types.builtins.NUMERIC, (value: string) => Number.parseFloat(value));

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
