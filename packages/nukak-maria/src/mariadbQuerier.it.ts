import { AbstractSqlQuerierIt } from 'nukak/querier/abstractSqlQuerier-it.js';
import { createSpec } from 'nukak/test/index.js';
import { MariadbQuerierPool } from './mariadbQuerierPool.js';

export class MariadbQuerierIt extends AbstractSqlQuerierIt {
  constructor() {
    super(
      new MariadbQuerierPool({
        host: '0.0.0.0',
        port: 3326,
        user: 'test',
        password: 'test',
        database: 'test',
        connectionLimit: 5,
        trace: true,
        bigIntAsNumber: true,
      }),
      'INT AUTO_INCREMENT PRIMARY KEY'
    );
  }
}

createSpec(new MariadbQuerierIt());
