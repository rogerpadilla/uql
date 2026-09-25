import { MariadbLikeQuerierIt } from '../querier/mysqlLikeQuerier-test.js';
import { createSpec, mariadbConnection } from '../test/index.js';
import { MariadbQuerierPool } from './mariadbQuerierPool.js';

export class MariadbQuerierIt extends MariadbLikeQuerierIt {
  constructor() {
    super(new MariadbQuerierPool({ ...mariadbConnection(), trace: true }));
  }
}

createSpec(new MariadbQuerierIt());
