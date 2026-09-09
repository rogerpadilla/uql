import { AbstractSqlQuerierPoolIt } from '../querier/abstractSqlQuerierPool-test.js';
import { VectorQuerierIt } from '../querier/vectorQuerier-test.js';
import { createSpec } from '../test/index.js';
import type { BunSqlQuerier } from './bunSqlQuerier.js';
import { BunSqlQuerierPool } from './bunSqlQuerierPool.js';

const url = 'mariadb://test:test@0.0.0.0:3326/test_bun_maria';

class BunMariadbIt extends VectorQuerierIt {
  constructor() {
    super(new BunSqlQuerierPool({ url }));
  }
}

class BunMariadbPoolIt extends AbstractSqlQuerierPoolIt<BunSqlQuerier> {
  constructor() {
    super(new BunSqlQuerierPool({ url }));
  }
}

createSpec(new BunMariadbIt());
createSpec(new BunMariadbPoolIt());
