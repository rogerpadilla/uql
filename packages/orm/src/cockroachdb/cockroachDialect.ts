import { AGGREGATE_VALUE_ALIAS } from '../dialect/aliases.js';
import { PG_FEATURES, PG_VECTOR_METRICS, PgLikeSqlDialect } from '../dialect/pgLikeSqlDialect.js';
import { getMeta } from '../entity/index.js';
import type { IndexType } from '../schema/types.js';
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

  /** Neither `regconfig` nor `WEBSEARCH_TO_TSQUERY` exist here (v26.3): the config goes as text, the search as plain words. */
  protected override readonly textConfigCast = '';
  protected override readonly textQueryFn = 'PLAINTO_TSQUERY';

  /** Its own beam for either type that builds its vector index; it refuses pgvector's `hnsw.ef_search`. */
  protected override readonly annSettings: ReadonlyMap<IndexType, string> = new Map<IndexType, string>([
    ['hnsw', 'vector_search_beam_size'],
    ['vector', 'vector_search_beam_size'],
  ]);

  /** An upsert batch mixing an update and an insert returns the update first (verified on v26.2). */
  override readonly features: SqlDialectFeatures = {
    ...PG_FEATURES,
    orderedUpsertReturning: false,
    triggers: { ...PG_FEATURES.triggers, fires: 'eachRowIf' },
  };

  /**
   * Not Postgres' `pg_class.reltuples`, which CockroachDB answers `NULL` for even straight after an
   * `ANALYZE` (verified live on v26.2) - it keeps its optimizer's row counts in its own statistics
   * instead, and `SHOW STATISTICS` is how they are read. Bracketed so it can be selected from; the
   * newest row wins, and a table never analyzed has none at all, which reads as `0`.
   */
  override estimatedCount<E>(ctx: QueryContext, entity: Type<E>): void {
    const table = this.escapedTableName(getMeta(entity));
    ctx.append(
      `SELECT row_count ${this.escapeId(AGGREGATE_VALUE_ALIAS, true)} FROM [SHOW STATISTICS FOR TABLE ${table}] ORDER BY created DESC LIMIT 1`,
    );
  }
}
