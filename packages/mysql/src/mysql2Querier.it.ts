import { createSpec } from '@uql/core/test';
import { BaseSqlQuerierIt } from '@uql/core/sql/baseSqlQuerier-it';
import { MySql2QuerierPool } from './mysql2QuerierPool';

export class MySql2QuerierIt extends BaseSqlQuerierIt {
  constructor() {
    super(
      new MySql2QuerierPool({
        host: '0.0.0.0',
        port: 3307,
        user: 'test',
        password: 'test',
        database: 'test',
      })
    );
  }
}

createSpec(new MySql2QuerierIt());
