import { CockroachLikeQuerierIt } from '../querier/cockroachQuerier-test.js';
import { createSpec } from '../test/index.js';
import { configurePgNumericTypeParsers } from '../test/pgTypeParsers.util.js';
import { CrdbQuerierPool } from './crdbQuerierPool.js';

configurePgNumericTypeParsers();

/**
 * CockroachDB has no `xmax`/`ctid` system columns, so `created` cannot be derived the way
 * Postgres does (see `CockroachDialect.upsert`); `shouldUpsertOne`'s default `created: undefined`
 * expectation (in `AbstractSqlQuerierIt`) already covers this, so no override is needed here.
 */
export class CockroachQuerierIt extends CockroachLikeQuerierIt {
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
