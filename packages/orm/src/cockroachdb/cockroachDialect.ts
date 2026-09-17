import { COUNT_ALIAS } from '../dialect/aliases.js';
import { PG_FEATURES, PG_VECTOR_METRICS, PgLikeSqlDialect } from '../dialect/pgLikeSqlDialect.js';
import { getMeta } from '../entity/index.js';
import type { QueryContext, SqlDialectFeatures, Type } from '../type/index.js';

/** CockroachDB: the Postgres wire and SQL, without `xmax` (so no upsert `created`) and with native vectors. */
export class CockroachDialect extends PgLikeSqlDialect {
  override readonly dialectName = 'cockroachdb';

  /**
   * pgvector's but `l1`: `<+>` and `vector_l1_ops` answer "unimplemented: operator class ... is not
   * supported" (verified live on v26.2), tracked at https://github.com/cockroachdb/cockroach/issues/147839.
   * Re-check that issue before adding it.
   */
  override readonly vectorMetrics = new Map([...PG_VECTOR_METRICS].filter(([metric]) => metric !== 'l1'));

  /** An upsert batch mixing an update and an insert returns the update first (verified on v26.2). */
  override readonly features: SqlDialectFeatures = { ...PG_FEATURES, orderedUpsertReturning: false };

  /**
   * Not Postgres' `pg_class.reltuples`, which CockroachDB answers `NULL` for even straight after an
   * `ANALYZE` (verified live on v26.2) - it keeps its optimizer's row counts in its own statistics
   * instead, and `SHOW STATISTICS` is how they are read. Bracketed so it can be selected from; the
   * newest row wins, and a table never analyzed has none at all, which reads as `0`.
   */
  override estimatedCount<E>(ctx: QueryContext, entity: Type<E>): void {
    const table = this.escapedTableName(getMeta(entity));
    ctx.append(
      `SELECT row_count ${this.escapeId(COUNT_ALIAS, true)} FROM [SHOW STATISTICS FOR TABLE ${table}] ORDER BY created DESC LIMIT 1`,
    );
  }
}
