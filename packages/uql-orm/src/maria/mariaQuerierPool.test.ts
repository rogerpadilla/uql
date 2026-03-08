import { AbstractQuerierPoolIt } from '../querier/abstractQuerierPool-test.js';
import { createSpec } from '../test/index.js';
import type { MariadbQuerier } from './mariadbQuerier.js';
import { MariadbQuerierPool } from './mariadbQuerierPool.js';

export class MariadbQuerierPoolIt extends AbstractQuerierPoolIt<MariadbQuerier> {
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
    );
  }
}

createSpec(new MariadbQuerierPoolIt());
