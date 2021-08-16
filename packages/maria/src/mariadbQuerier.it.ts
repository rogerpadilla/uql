import { createSpec } from '@uql/core/test';
import { AbstractSqlQuerierIt } from '@uql/core/querier/abstractSqlQuerier-it';
import { MariadbQuerierPool } from './mariadbQuerierPool';

export class MariadbQuerierIt extends AbstractSqlQuerierIt {
  readonly idType = 'SERIAL PRIMARY KEY';

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
