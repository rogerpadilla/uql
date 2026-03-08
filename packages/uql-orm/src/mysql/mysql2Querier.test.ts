import { AbstractSqlQuerierIt } from '../querier/abstractSqlQuerier-test.js';
import { createSpec } from '../test/index.js';
import { MySql2QuerierPool } from './mysql2QuerierPool.js';

export class MySql2QuerierIt extends AbstractSqlQuerierIt {
  constructor() {
    super(
      new MySql2QuerierPool({
        host: '0.0.0.0',
        port: 3316,
        user: 'test',
        password: 'test',
        database: 'test',
      }),
      'INT AUTO_INCREMENT PRIMARY KEY',
    );
  }
}

createSpec(new MySql2QuerierIt());
