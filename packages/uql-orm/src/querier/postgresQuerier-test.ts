import { expect } from 'vitest';
import { PgLikeQuerierIt } from './pgLikeQuerier-test.js';

/**
 * Shared expectations for PostgreSQL proper, whichever driver reaches it: node-`pg`, Bun SQL, and
 * PGlite in process. Everything else Postgres-wire is {@link PgLikeQuerierIt}, which CockroachDB
 * also runs.
 *
 * A driver-specific suite is expected to add nothing but its pool. Postgres is Postgres, so a
 * divergence between two drivers on any of this is a bug in one of them rather than a hook either
 * gets - which is only enforceable while it lives here instead of being restated per driver, as both
 * the `xmax` expectations and the `CREATE EXTENSION` below were, three times each.
 */
export abstract class PostgresQuerierIt extends PgLikeQuerierIt {
  /** pgvector's extension has to exist before the fixture DDL can declare a vector column. */
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
