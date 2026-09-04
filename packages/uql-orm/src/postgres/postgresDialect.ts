import { COUNT_ALIAS } from '../dialect/aliases.js';
import { PgLikeSqlDialect } from '../dialect/pgLikeSqlDialect.js';
import { getMeta } from '../entity/index.js';
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

  /** pgvector is the only engine with `halfvec` and `sparsevec`; every other maps them onto `vector`. */
  protected override readonly hasNarrowVectorTypes = true;

  override upsert<E>(ctx: QueryContext, entity: Type<E>, conflictPaths: QueryConflictPaths<E>, payload: E | E[]): void {
    // The xmax system column is 0 for a newly inserted row and non-zero for an updated one (MVCC).
    super.upsert(ctx, entity, conflictPaths, payload, `, (xmax = 0) AS ${this.escapeId('_created')}`);
  }

  /**
   * `to_regclass` rather than a `::regclass` cast: it answers `NULL` for a table that does not exist
   * (mid-migration, say) where the cast throws. `GREATEST` because a table nothing has analyzed yet
   * carries `reltuples = -1`, Postgres' "no statistic" (not `NULL`, and not `0`) since PG 14 - handed
   * back raw it would read as a negative row count.
   */
  override estimatedCount<E>(ctx: QueryContext, entity: Type<E>): void {
    ctx.append(
      `SELECT GREATEST(reltuples, 0)::bigint ${this.escapeId(COUNT_ALIAS, true)} FROM pg_class WHERE oid = to_regclass(`,
    );
    ctx.addValue(this.escapedTableName(getMeta(entity)));
    ctx.append(')');
  }
}
