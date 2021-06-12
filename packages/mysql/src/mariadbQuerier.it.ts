import { createSpec } from '@uql/core/test';
import { BaseSqlQuerierIt } from '@uql/core/sql/baseSqlQuerier-it';
import { MariadbQuerierPool } from './mariadbQuerierPool';

export class MariadbQuerierIt extends BaseSqlQuerierIt {
  readonly primaryKeyType = 'SERIAL PRIMARY KEY';

  constructor() {
    super(
      new MariadbQuerierPool({
        host: '0.0.0.0',
        port: 3310,
        user: 'test',
        password: 'test',
        database: 'test',
      })
    );
  }
}

createSpec(new MariadbQuerierIt());
