import { PgLikeQuerierIt } from '../querier/pgLikeQuerier-test.js';
import { cockroachConnection, createSpec } from '../test/index.js';
import { CrdbQuerierPool } from './crdbQuerierPool.js';

/**
 * Shares every expectation with Postgres: `created` is `undefined` without `xmax`, as the shared suite
 * expects, and a `halfvec`/`sparsevec` stored as a dense `vector` decodes by the cast the dialect wrote.
 */
export class CockroachQuerierIt extends PgLikeQuerierIt {
  constructor() {
    super(new CrdbQuerierPool(cockroachConnection()));
  }
}

createSpec(new CockroachQuerierIt());
