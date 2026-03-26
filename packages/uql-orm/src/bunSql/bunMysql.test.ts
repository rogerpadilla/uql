import { AbstractSqlQuerierIt } from '../querier/abstractSqlQuerier-test.js';
import { createSpec } from '../test/index.js';
import { BunSqlQuerierPool } from './bunSqlQuerierPool.js';

class BunMysqlIt extends AbstractSqlQuerierIt {
  constructor() {
    super(
      new BunSqlQuerierPool({
        url: 'mysql://test:test@0.0.0.0:3316/test',
      }),
      'BIGINT AUTO_INCREMENT PRIMARY KEY',
    );
  }
}

createSpec(new BunMysqlIt());
