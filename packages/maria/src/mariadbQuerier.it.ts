import { createSpec } from '@uql/core/test';
import { AbstractSqlQuerierIt } from '@uql/core/querier/abstractSqlQuerier-it';
import { MariadbQuerierPool } from './mariadbQuerierPool';

export class MariadbQuerierIt extends AbstractSqlQuerierIt {
  constructor() {
    super(
      new MariadbQuerierPool({
        host: '0.0.0.0',
        port: 3326,
        user: 'test',
        password: 'test',
        database: 'test',
      }),
      'INT AUTO_INCREMENT PRIMARY KEY'
    );
  }
}

createSpec(new MariadbQuerierIt());
