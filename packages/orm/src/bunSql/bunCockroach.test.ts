import { AbstractSqlQuerierPoolIt } from '../querier/abstractSqlQuerierPool-test.js';
import { PgLikeQuerierIt } from '../querier/pgLikeQuerier-test.js';
import { createSpec } from '../test/index.js';
import type { BunSqlQuerier } from './bunSqlQuerier.js';
import { BunSqlQuerierPool } from './bunSqlQuerierPool.js';

const url = 'cockroachdb://root@0.0.0.0:26257/defaultdb';

class BunCockroachIt extends PgLikeQuerierIt {
  constructor() {
    super(new BunSqlQuerierPool({ url }));
  }
}

class BunCockroachPoolIt extends AbstractSqlQuerierPoolIt<BunSqlQuerier> {
  constructor() {
    super(new BunSqlQuerierPool({ url }));
  }
}

createSpec(new BunCockroachIt());
createSpec(new BunCockroachPoolIt());
