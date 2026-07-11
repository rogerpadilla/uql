import { PgLikeSqlDialect } from '../dialect/pgLikeSqlDialect.js';
import type { QueryConflictPaths, QueryContext, SqlDialectName, Type } from '../type/index.js';

/**
 * PostgreSQL dialect. For node-pg use PgDialect. Neon, Bun SQL, and Cockroach use driver-specific
 * subclasses. Shared Postgres-wire AST/quoting/JSONB/full-text-search/vector-search logic
 * (including BIGINT IDENTITY PKs) lives in {@link PgLikeSqlDialect}; this class adds what's
 * Postgres-only: the `vector` extension requirement, pgvector's index syntax, and `xmax`-based
 * upsert `created` detection.
 */
export class PostgresDialect extends PgLikeSqlDialect {
  override readonly dialectName: SqlDialectName = 'postgres';

  override readonly vectorExtension: string | undefined = 'vector';

  override upsert<E>(ctx: QueryContext, entity: Type<E>, conflictPaths: QueryConflictPaths<E>, payload: E | E[]): void {
    // xmax system column is 0 for newly inserted rows, non-zero for updated rows (MVCC).
    this.buildUpsertOnConflict(ctx, entity, conflictPaths, payload, `, (xmax = 0) AS ${this.escapeId('_created')}`);
  }
}
