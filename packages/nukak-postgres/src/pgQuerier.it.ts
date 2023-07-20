import { types } from 'pg';
import { createSpec } from 'nukak/test';
import { AbstractSqlQuerierIt } from 'nukak/querier/abstractSqlQuerier-it.js';
import { PgQuerierPool } from './pgQuerierPool.js';

types.setTypeParser(types.builtins.INT8, (value: string) => parseInt(value));
types.setTypeParser(types.builtins.FLOAT8, (value: string) => parseFloat(value));
types.setTypeParser(types.builtins.NUMERIC, (value: string) => parseFloat(value));

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

  override async afterAll() {
    await super.afterAll();
  }
}

createSpec(new PostgresQuerierIt());
