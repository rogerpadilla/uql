import { COUNT_ALIAS } from '../dialect/abstractSqlDialect.js';
import { PgLikeSqlDialect } from '../dialect/pgLikeSqlDialect.js';
import { getMeta } from '../entity/index.js';
import type { IndexFeature, IndexSchema, QueryContext, Type, VectorDistance } from '../type/index.js';

/**
 * CockroachDB Dialect.
 * Shares AST/quoting/JSONB/full-text-search/vector-search/upsert logic with Postgres via
 * {@link PgLikeSqlDialect} (wire- and SQL-compatible for all of that, including pgvector's
 * `<=>`/`<->`/`<#>` operators, which CockroachDB implements natively). Unlike Postgres, CockroachDB
 * has no `xmax`/`ctid` system columns, so it uses `PgLikeSqlDialect.upsert`'s default as-is (no
 * `created` detection) rather than Postgres's `xmax`-based override; no `vectorExtension` either,
 * since the vector type is native (no `CREATE EXTENSION` needed); and vector indexes use
 * CockroachDB's own `CREATE VECTOR INDEX` syntax (no access-method keyword) rather than pgvector's
 * `CREATE INDEX ... USING ivfflat/hnsw`.
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
   * `NULLS FIRST/LAST` answers "unimplemented: this syntax" and `jsonb_path_ops` "operator class is
   * not supported" (both verified on v26.2), so neither is offered here.
   */
  protected override readonly indexFeatures = new Set<IndexFeature>(['expression', 'partial', 'include']);

  /**
   * `noKeyUpdate`/`keyShare` are omitted on purpose, not by oversight: CockroachDB parses both and
   * treats them as aliases of `FOR UPDATE`/`FOR SHARE`, so offering them would hand back a stronger
   * lock than was asked for, with nothing signalling it.
   */

  /**
   * CockroachDB's vector index is native and has its own syntax: `CREATE VECTOR INDEX ... ("col"
   * vector_cosine_ops)`, with no access-method keyword, and tuning knobs of its own names that UQL
   * does not map. `type: 'vector'` is its trigger, the same generic value MariaDB's inline index uses.
   */
  private isNativeVectorIndex(index: IndexSchema): boolean {
    return index.type === 'vector';
  }

  protected override isVectorIndex(index: IndexSchema): boolean {
    return this.isNativeVectorIndex(index) || super.isVectorIndex(index);
  }

  protected override indexKeyword(index: IndexSchema): string {
    return this.isNativeVectorIndex(index) ? 'VECTOR INDEX' : super.indexKeyword(index);
  }

  protected override indexAccessMethod(index: IndexSchema): string {
    return this.isNativeVectorIndex(index) ? '' : super.indexAccessMethod(index);
  }

  protected override indexTuning(index: IndexSchema): string {
    return this.isNativeVectorIndex(index) ? '' : super.indexTuning(index);
  }

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
