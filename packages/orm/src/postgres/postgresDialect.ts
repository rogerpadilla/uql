import { AGGREGATE_VALUE_ALIAS, UPSERT_CREATED_ALIAS } from '../dialect/aliases.js';
import { PG_FEATURES, PG_SQL_VALUES, PgLikeSqlDialect } from '../dialect/pgLikeSqlDialect.js';
import { getMeta } from '../entity/index.js';
import type { QueryContext, SqlDialectFeatures, SqlDialectName, SqlValues, Type } from '../type/index.js';

/** PostgreSQL, under every driver: `pg`, Neon, PGlite, `bun:sql`. Adds pgvector and the `xmax` upsert `created`. */
export class PostgresDialect extends PgLikeSqlDialect {
  override readonly dialectName: SqlDialectName = 'postgres';

  override readonly vectorExtension: string | undefined = 'vector';

  /** pgvector is the only engine with `halfvec` and `sparsevec`. */
  override readonly features: SqlDialectFeatures = { ...PG_FEATURES, narrowVectorTypes: true };

  /** `uuidv7()` is Postgres 18+; an older server refuses it itself. */
  override readonly sqlValues: SqlValues = { ...PG_SQL_VALUES, uuidv7: 'uuidv7()' };

  /** The xmax system column is 0 for a newly inserted row and non-zero for an updated one (MVCC). */
  protected override readonly upsertCreatedReturning = `(xmax = 0) AS ${this.escapeId(UPSERT_CREATED_ALIAS)}`;

  /**
   * `to_regclass` rather than a `::regclass` cast: it answers `NULL` for a table that does not exist
   * (mid-migration, say) where the cast throws. `GREATEST` because a table nothing has analyzed yet
   * carries `reltuples = -1`, Postgres' "no statistic" (not `NULL`, and not `0`) since PG 14 - handed
   * back raw it would read as a negative row count.
   */
  override estimatedCount<E>(ctx: QueryContext, entity: Type<E>): void {
    ctx.append(
      `SELECT GREATEST(reltuples, 0)::bigint ${this.escapeId(AGGREGATE_VALUE_ALIAS, true)} FROM pg_class WHERE oid = to_regclass(`,
    );
    ctx.addValue(this.escapedTableName(getMeta(entity)));
    ctx.append(')');
  }
}
