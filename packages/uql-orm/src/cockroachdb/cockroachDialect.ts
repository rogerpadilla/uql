import { COUNT_ALIAS } from '../dialect/aliases.js';
import { PgLikeSqlDialect } from '../dialect/pgLikeSqlDialect.js';
import { getMeta } from '../entity/index.js';
import type { QueryContext, Type, VectorDistance } from '../type/index.js';

/**
 * CockroachDB Dialect.
 * Shares AST/quoting/JSONB/full-text-search/vector-search/upsert logic with Postgres via
 * {@link PgLikeSqlDialect} (wire- and SQL-compatible for all of that, including pgvector's
 * `<=>`/`<->`/`<#>` operators, which CockroachDB implements natively). Unlike Postgres, CockroachDB
 * has no `xmax`/`ctid` system columns, so it uses `PgLikeSqlDialect.upsert`'s default as-is (no
 * `created` detection) rather than Postgres's `xmax`-based override; and no `vectorExtension`
 * either, since the vector type is native (no `CREATE EXTENSION` needed). Its `CREATE VECTOR INDEX`
 * syntax is the migrator's `CockroachIndexDdl`.
 */
export class CockroachDialect extends PgLikeSqlDialect {
  override readonly dialectName = 'cockroachdb';

  // CockroachDB implements 3 of pgvector's 4 metrics: `<+>` and `vector_l1_ops` throw
  // "unimplemented: operator class ... is not supported" (verified live on v26.2), which its own docs
  // list under "Known limitations": https://www.cockroachlabs.com/docs/stable/vector-indexes -
  // tracked upstream at https://github.com/cockroachdb/cockroach/issues/147839. Re-check that issue
  // before adding `l1` here; it is omitted on purpose, not an oversight.
  override readonly vectorMetrics: ReadonlyMap<VectorDistance, { op: string; opsSuffix: string }> = new Map([
    ['cosine', { op: '<=>', opsSuffix: 'cosine' }],
    ['l2', { op: '<->', opsSuffix: 'l2' }],
    ['inner', { op: '<#>', opsSuffix: 'ip' }],
  ]);

  /**
   * `noKeyUpdate`/`keyShare` are omitted on purpose, not by oversight: CockroachDB parses both and
   * treats them as aliases of `FOR UPDATE`/`FOR SHARE`, so offering them would hand back a stronger
   * lock than was asked for, with nothing signalling it.
   */

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
