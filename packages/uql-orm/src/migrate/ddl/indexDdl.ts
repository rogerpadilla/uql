import type { AbstractSqlDialect } from '../../dialect/abstractSqlDialect.js';
import { jsonTypeMode } from '../../dialect/jsonSql.js';
import type { IndexType } from '../../schema/types.js';
import {
  INDEX_FEATURE_LABELS,
  type IndexColumnSchema,
  type IndexFeature,
  type IndexJsonArray,
  type IndexSchema,
} from '../../type/index.js';
import { getKeys } from '../../util/index.js';

/**
 * What in an index asks for each feature. A `Record` over the feature union rather than a list, so a
 * feature added to {@link INDEX_FEATURE_LABELS} cannot reach a dialect without the test that decides
 * whether an index wants it - which is how a JSON path once slipped past the entry comparison.
 */
const INDEX_FEATURE_PROBES: Record<IndexFeature, (index: IndexSchema) => boolean> = {
  expression: (index) => index.entries.some((entry) => entry.expression),
  jsonPath: (index) => index.entries.some((entry) => entry.jsonPath),
  jsonArray: (index) => index.entries.some((entry) => entry.jsonArray),
  partial: (index) => index.where !== undefined,
  prefixLength: (index) => index.entries.some((entry) => entry.length !== undefined),
  nullsOrder: (index) => index.entries.some((entry) => entry.nulls !== undefined),
  opsClass: (index) => index.entries.some((entry) => entry.opsClass !== undefined),
  include: (index) => Boolean(index.include?.length),
};

/**
 * `CREATE INDEX` for SQL dialects: the statement and the fragments each engine spells differently.
 * The migrator's rather than the dialect's, since {@link SqlSchemaGenerator} is the only thing that
 * emits DDL - which is what keeps a `CAST(... ARRAY)` table out of every runtime consumer's entry.
 * The form here is the portable one, which SQLite (and so libSQL, Turso and D1) takes verbatim: no
 * access-method clause, no operator classes, no tuning parameters.
 */
export class IndexDdl<D extends AbstractSqlDialect = AbstractSqlDialect> {
  constructor(protected readonly dialect: D) {}

  getCreateIndexStatement(tableName: string, index: IndexSchema, opts: { ifNotExists?: boolean } = {}): string {
    this.assertIndexFeatures(index);
    const unique = index.unique ? 'UNIQUE ' : '';
    const ifNotExists = (opts.ifNotExists ?? this.dialect.features.indexIfNotExists) ? 'IF NOT EXISTS ' : '';
    const columns = index.entries.map((entry) => this.indexColumn(entry, index)).join(', ');
    return (
      `CREATE ${unique}${this.indexKeyword(index)} ${ifNotExists}${this.dialect.escapeId(index.name)} ` +
      `ON ${this.dialect.escapeId(tableName)}${this.indexAccessMethod(index)} (${columns})` +
      `${this.indexInclude(index)}${this.indexTuning(index)}${this.indexPredicate(index)};`
    );
  }

  /**
   * Index features this dialect can express. Everything here is supported by at least one engine and
   * refused by at least one other, so an index asking for a missing one is rejected rather than
   * emitted: each of them is a hard error at the server, not a slower plan.
   */
  protected readonly indexFeatures: ReadonlySet<IndexFeature> = new Set<IndexFeature>([
    'expression',
    'partial',
    'jsonPath',
  ]);

  private assertIndexFeatures(index: IndexSchema): void {
    for (const feature of getKeys(INDEX_FEATURE_PROBES)) {
      if (INDEX_FEATURE_PROBES[feature](index) && !this.indexFeatures.has(feature)) {
        throw new TypeError(
          `${this.dialect.dialectName} does not support ${INDEX_FEATURE_LABELS[feature]} (index "${index.name}")`,
        );
      }
    }
  }

  /**
   * Index types this dialect spells as a keyword of their own (`FULLTEXT INDEX`, `VECTOR INDEX`)
   * rather than as an access method after the table. One table drives both, so a type that is a
   * keyword here can never also leak out as a ` USING` clause the engine has no word for.
   */
  protected readonly indexTypeKeywords: ReadonlyMap<IndexType, string> = new Map();

  /** The keyword an index type replaces `INDEX` with, or `INDEX` for the types that do not. */
  protected indexKeyword(index: IndexSchema): string {
    return (index.type && this.indexTypeKeywords.get(index.type)) || 'INDEX';
  }

  /** One index entry: what is indexed, its operator class if any, then its stored order. */
  protected indexColumn(entry: IndexColumnSchema, index: IndexSchema): string {
    return `${this.indexColumnTarget(entry)}${this.indexColumnOpsClass(entry, index)}${this.indexColumnOrder(entry)}`;
  }

  /**
   * A quoted column, optionally prefix-limited, or an expression in its own parentheses - the form
   * `((lower("email")))` that MySQL requires and Postgres, CockroachDB and SQLite all accept, so one
   * rendering serves every engine that has expression indexes. A JSON entry is one of those too, its
   * expression compiled from the path rather than written out by the caller.
   */
  protected indexColumnTarget(entry: IndexColumnSchema): string {
    if (entry.expression) {
      return `(${entry.column})`;
    }
    const column = this.dialect.escapeId(entry.column);
    if (entry.jsonPath) {
      return `(${this.dialect.jsonPathExpr(column, entry.jsonPath.path, jsonTypeMode(entry.jsonPath.type))})`;
    }
    if (entry.jsonArray) {
      return `(${this.jsonArrayIndexExpr(column, entry.jsonArray)})`;
    }
    return entry.length === undefined ? column : `${column}(${entry.length})`;
  }

  /**
   * One key per *element* of the JSON array, which is MySQL's multi-valued index and nothing else's -
   * every other dialect refuses `jsonArray` in {@link assertIndexFeatures} and never reaches this.
   */
  protected jsonArrayIndexExpr(_escapedColumn: string, _json: IndexJsonArray): string {
    throw new TypeError(`${this.dialect.dialectName} has no multi-valued index`);
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
   * The partial-index predicate. Engines without one reject the index in {@link assertIndexFeatures}
   * rather than reaching here: silently widening a partial unique index changes which rows the
   * database accepts.
   */
  protected indexPredicate(index: IndexSchema): string {
    return index.where ? ` WHERE ${index.where}` : '';
  }
}
