import { INDEX_FEATURE_LABELS, type IndexColumnSchema, type IndexFeature, type IndexSchema } from '../type/index.js';
import { VectorSqlDialect } from './vectorSqlDialect.js';

/**
 * `CREATE INDEX` for SQL dialects: the statement and the fragments each engine spells differently.
 *
 * A layer of its own for the same reason as {@link VectorSqlDialect} below it - it needs only
 * `escapeId` and `features.indexIfNotExists` from the SQL dialect above, so keeping it here spares
 * that 2000-line class thirteen more members. What each engine can express at all is data
 * ({@link indexFeatures}), validated once, rather than a throw per feature per dialect.
 */
export abstract class IndexSqlDialect extends VectorSqlDialect {
  /**
   * The `CREATE INDEX` statement for this dialect. The form here is the portable one, which SQLite
   * (and so libSQL, Turso and D1) takes verbatim: no access-method clause, no operator classes, no
   * tuning parameters. Dialects that have those override the fragments below rather than this.
   */
  getCreateIndexStatement(tableName: string, index: IndexSchema, opts: { ifNotExists?: boolean } = {}): string {
    this.assertIndexFeatures(index);
    const unique = index.unique ? 'UNIQUE ' : '';
    const ifNotExists = (opts.ifNotExists ?? this.features.indexIfNotExists) ? 'IF NOT EXISTS ' : '';
    const columns = index.columns.map((entry) => this.indexColumn(entry, index)).join(', ');
    return (
      `CREATE ${unique}${this.indexKeyword(index)} ${ifNotExists}${this.escapeId(index.name)} ` +
      `ON ${this.escapeId(tableName)}${this.indexAccessMethod(index)} (${columns})` +
      `${this.indexInclude(index)}${this.indexTuning(index)}${this.indexPredicate(index)};`
    );
  }

  /**
   * Index features this dialect can express. Everything here is supported by at least one engine and
   * refused by at least one other, so an index asking for a missing one is rejected rather than
   * emitted: each of them is a hard error at the server, not a slower plan.
   */
  protected readonly indexFeatures: ReadonlySet<IndexFeature> = new Set<IndexFeature>(['expression']);

  private assertIndexFeatures(index: IndexSchema): void {
    const requested: readonly [IndexFeature, boolean][] = [
      ['expression', index.columns.some((entry) => entry.expression)],
      ['prefixLength', index.columns.some((entry) => entry.length !== undefined)],
      ['nullsOrder', index.columns.some((entry) => entry.nulls !== undefined)],
      ['opsClass', index.columns.some((entry) => entry.opsClass !== undefined)],
      ['include', Boolean(index.include?.length)],
    ];
    for (const [feature, needed] of requested) {
      if (needed && !this.indexFeatures.has(feature)) {
        throw new TypeError(
          `${this.dialectName} does not support ${INDEX_FEATURE_LABELS[feature]} (index "${index.name}")`,
        );
      }
    }
  }

  /**
   * The column-level declaration for a vector index that lives inside `CREATE TABLE` rather than in
   * its own statement, which the `inlineVectorIndex` feature flags. Only MariaDB has one.
   */
  getInlineVectorIndexDeclaration(index: IndexSchema): string {
    throw new TypeError(`${this.dialectName} has no inline vector index (index "${index.name}")`);
  }

  /** Only CockroachDB's native vector index replaces the `INDEX` keyword. */
  protected indexKeyword(_index: IndexSchema): string {
    return 'INDEX';
  }

  /** One index entry: what is indexed, its operator class if any, then its stored order. */
  protected indexColumn(entry: IndexColumnSchema, index: IndexSchema): string {
    return `${this.indexColumnTarget(entry)}${this.indexColumnOpsClass(entry, index)}${this.indexColumnOrder(entry)}`;
  }

  /**
   * A quoted column, optionally prefix-limited, or an expression in its own parentheses - the form
   * `((lower("email")))` that MySQL requires and Postgres, CockroachDB and SQLite all accept, so one
   * rendering serves every engine that has expression indexes.
   */
  protected indexColumnTarget(entry: IndexColumnSchema): string {
    if (entry.expression) {
      return `(${entry.column})`;
    }
    const column = this.escapeId(entry.column);
    return entry.length === undefined ? column : `${column}(${entry.length})`;
  }

  /** Postgres-wire dialects put a vector or user-declared operator class here. */
  protected indexColumnOpsClass(_entry: IndexColumnSchema, _index: IndexSchema): string {
    return '';
  }

  /** `ASC` is every engine's default, so only `DESC` is worth emitting. */
  protected indexColumnOrder(entry: IndexColumnSchema): string {
    const order = entry.order === 'desc' ? ' DESC' : '';
    return entry.nulls ? `${order} NULLS ${entry.nulls.toUpperCase()}` : order;
  }

  /** ` INCLUDE (...)`: non-key columns stored for index-only scans. Postgres-wire only. */
  protected indexInclude(_index: IndexSchema): string {
    return '';
  }

  /** ` USING <method>`, which SQLite's grammar has no place for at all. */
  protected indexAccessMethod(_index: IndexSchema): string {
    return '';
  }

  /** pgvector's ` WITH (m = ..., ef_construction = ..., lists = ...)`. */
  protected indexTuning(_index: IndexSchema): string {
    return '';
  }

  /**
   * The partial-index predicate. Dialects without partial indexes throw instead of dropping it:
   * silently widening a partial unique index changes which rows the database accepts.
   */
  protected indexPredicate(index: IndexSchema): string {
    return index.where ? ` WHERE ${index.where}` : '';
  }
}
