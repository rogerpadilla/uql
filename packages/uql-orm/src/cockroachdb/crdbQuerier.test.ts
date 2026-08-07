import { PgLikeQuerierIt } from '../querier/pgLikeQuerier-test.js';
import { createSpec } from '../test/index.js';
import { CrdbQuerierPool } from './crdbQuerierPool.js';

/**
 * CockroachDB has no `xmax`/`ctid` system columns, so `created` cannot be derived the way
 * Postgres does (see `CockroachDialect.upsert`); `shouldUpsertOne`'s default `created: undefined`
 * expectation (in `AbstractSqlQuerierIt`) already covers this, so no override is needed here.
 *
 * Shares every expectation with Postgres. It has only the `vector` type, so a `halfvec`/`sparsevec`
 * field lands there as a dense vector, but the ORM decodes by the cast the dialect actually wrote, so
 * that difference no longer reaches a caller and no per-family suite is needed for it.
 */
export class CockroachQuerierIt extends PgLikeQuerierIt {
  constructor() {
    super(
      new CrdbQuerierPool({
        host: '0.0.0.0',
        port: 26257,
        user: 'root',
        database: 'defaultdb',
      }),
    );
  }
}

createSpec(new CockroachQuerierIt());
