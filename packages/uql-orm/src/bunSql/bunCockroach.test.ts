import { CockroachLikeQuerierIt } from '../querier/cockroachQuerier-test.js';
import { createSpec } from '../test/index.js';
import { BunSqlQuerierPool } from './bunSqlQuerierPool.js';

class BunCockroachIt extends CockroachLikeQuerierIt {
  constructor() {
    super(
      new BunSqlQuerierPool({
        url: 'cockroachdb://root@0.0.0.0:26257/defaultdb',
      }),
    );
  }
}

createSpec(new BunCockroachIt());
