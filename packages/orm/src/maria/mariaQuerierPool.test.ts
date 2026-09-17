import { AbstractSqlQuerierPoolIt } from '../querier/abstractSqlQuerierPool-test.js';
import { createSpec, mariadbConnection } from '../test/index.js';
import type { MariadbQuerier } from './mariadbQuerier.js';
import { MariadbQuerierPool } from './mariadbQuerierPool.js';

export class MariadbQuerierPoolIt extends AbstractSqlQuerierPoolIt<MariadbQuerier> {
  constructor() {
    super(new MariadbQuerierPool({ ...mariadbConnection(), trace: true }));
  }
}

createSpec(new MariadbQuerierPoolIt());
