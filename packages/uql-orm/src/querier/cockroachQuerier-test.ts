import { PgLikeQuerierIt } from './pgLikeQuerier-test.js';

/**
 * Shared expectations for CockroachDB, whichever driver reaches it (`pg`, `bun:sql`). It speaks
 * pgvector's operators natively but has only the `vector` type, so everything Postgres stores in a
 * narrower one lands there as a dense vector.
 */
export abstract class CockroachLikeQuerierIt extends PgLikeQuerierIt {
  protected override get expectedSparsevecValue(): string {
    return '[0,0,1]';
  }
}
