import { AbstractSqlQuerierIt } from 'nukak/querier/abstractSqlQuerier-it.js';
import { createSpec } from 'nukak/test';
import { types } from 'pg';
import { PgQuerierPool } from './pgQuerierPool.js';

types.setTypeParser(types.builtins.INT8, (value: string) => Number.parseInt(value));
types.setTypeParser(types.builtins.FLOAT8, (value: string) => Number.parseFloat(value));
types.setTypeParser(types.builtins.NUMERIC, (value: string) => Number.parseFloat(value));

export class PostgresQuerierIt extends AbstractSqlQuerierIt {
  constructor() {
    super(
      new PgQuerierPool({
        host: '0.0.0.0',
        port: 5442,
        user: 'test',
        password: 'test',
        database: 'test',
      }),
      'SERIAL PRIMARY KEY',
    );
  }
}

createSpec(new PostgresQuerierIt());
