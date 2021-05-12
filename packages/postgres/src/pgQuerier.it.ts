import { types } from 'pg';
import { createSpec } from '@uql/core/test';
import { BaseSqlQuerierIt } from '@uql/core/sql/baseSqlQuerier-it';
import { PgQuerierPool } from './pgQuerierPool';

types.setTypeParser(types.builtins.INT8, (value: string) => parseInt(value));
types.setTypeParser(types.builtins.FLOAT8, (value: string) => parseFloat(value));
types.setTypeParser(types.builtins.NUMERIC, (value: string) => parseFloat(value));

export class PostgresQuerierIt extends BaseSqlQuerierIt {
  readonly primaryKeyType = 'SERIAL PRIMARY KEY';

  constructor() {
    super(
      new PgQuerierPool({
        host: '0.0.0.0',
        port: 5432,
        user: 'test',
        password: 'test',
        database: 'test',
      })
    );
  }
}

createSpec(new PostgresQuerierIt());
