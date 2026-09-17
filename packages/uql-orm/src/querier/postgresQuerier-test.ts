import { expect } from 'vitest';
import { PgLikeQuerierIt } from './pgLikeQuerier-test.js';

/**
 * Shared expectations for PostgreSQL proper, whichever driver reaches it (node-`pg`, Bun SQL, PGlite);
 * {@link PgLikeQuerierIt} holds what CockroachDB shares. A driver suite adds its pool and nothing else,
 * since two drivers disagreeing here is a bug in one of them.
 */
export abstract class PostgresQuerierIt extends PgLikeQuerierIt {
  /** pgvector's extension exists before the fixture DDL declares a vector column. */
  override async beforeAll() {
    const querier = await this.pool.getQuerier();
    try {
      await querier.run('CREATE EXTENSION IF NOT EXISTS vector');
    } finally {
      await querier.release();
    }
    await super.beforeAll();
  }

  /** Postgres's `xmax` system column exposes the `created` flag on upsert. */
  protected override assertUpsertCreatedOnInsert(created: boolean | undefined): void {
    expect(created).toBe(true);
  }

  protected override assertUpsertCreatedOnUpdate(created: boolean | undefined): void {
    expect(created).toBe(false);
  }
}
