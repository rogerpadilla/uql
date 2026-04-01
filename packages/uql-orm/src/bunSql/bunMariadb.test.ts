import { AbstractSqlQuerierIt } from '../querier/abstractSqlQuerier-test.js';
import { createSpec } from '../test/index.js';
import { BunSqlQuerierPool } from './bunSqlQuerierPool.js';

class BunMariadbIt extends AbstractSqlQuerierIt {
  constructor() {
    super(
      new BunSqlQuerierPool({
        url: 'mariadb://test:test@0.0.0.0:3326/test_bun_maria',
      }),
      'BIGINT AUTO_INCREMENT PRIMARY KEY',
    );
  }
}

createSpec(new BunMariadbIt());
