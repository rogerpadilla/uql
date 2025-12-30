import { AbstractQuerierPoolIt } from '../querier/abstractQuerierPool-test.js';
import { createSpec } from '../test/index.js';
import type { MySql2Querier } from './mysql2Querier.js';
import { MySql2QuerierPool } from './mysql2QuerierPool.js';

export class MySql2QuerierPoolIt extends AbstractQuerierPoolIt<MySql2Querier> {
  constructor() {
    super(
      new MySql2QuerierPool({
        host: '0.0.0.0',
        port: 3316,
        user: 'test',
        password: 'test',
        database: 'test',
      }),
    );
  }
}

createSpec(new MySql2QuerierPoolIt());
