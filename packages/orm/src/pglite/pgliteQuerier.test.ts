import { vector } from '@electric-sql/pglite-pgvector';
import { PostgresQuerierIt } from '../querier/postgresQuerier-test.js';
import { createSpec } from '../test/index.js';
import { PgliteQuerierPool } from './pgliteQuerierPool.js';

/**
 * The whole Postgres suite, in process: no container, and the only difference from `pgQuerier.test.ts`
 * is the pool. `extensions` is what makes `CREATE EXTENSION vector` resolvable, since PGlite loads an
 * extension's WASM bundle at construction rather than on demand.
 */
class PgliteQuerierIt extends PostgresQuerierIt {
  constructor() {
    super(new PgliteQuerierPool('memory://', { extensions: { vector } }));
  }
}

createSpec(new PgliteQuerierIt());
