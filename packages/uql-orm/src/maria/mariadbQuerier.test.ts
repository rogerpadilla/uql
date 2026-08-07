import { VectorQuerierIt } from '../querier/vectorQuerier-test.js';
import { createSpec } from '../test/index.js';
import { MariadbQuerierPool } from './mariadbQuerierPool.js';

export class MariadbQuerierIt extends VectorQuerierIt {
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
      }),
    );
  }
}

createSpec(new MariadbQuerierIt());
