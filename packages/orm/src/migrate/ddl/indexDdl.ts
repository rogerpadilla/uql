import type { AbstractSqlDialect } from '../../dialect/abstractSqlDialect.js';
import { jsonTypeMode } from '../../dialect/jsonSql.js';
import type { IndexType } from '../../schema/types.js';
import {
  INDEX_FEATURE_LABELS,
  type IndexColumnSchema,
  type IndexFeature,
  type IndexJsonPath,
  type IndexSchema,
} from '../../type/index.js';
import { indexDistance, unsupportedVectorMetric } from '../../type/vector.js';
import { fulltextConfig, getKeys } from '../../util/index.js';
import { UqlUsageError } from '../../util/uqlError.js';
import { INDEX_CAPABILITIES, type IndexCapabilities } from './indexCapabilities.js';

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

/** Refuses an index of a type `types` lacks, `hints` naming what to declare instead. */
export function assertIndexType(
  index: IndexSchema,
  types: ReadonlySet<IndexType>,
  dialectName: string,
  hints: ReadonlyMap<IndexType, string> = new Map(),
): void {
  if (index.type && !types.has(index.type)) {
    throw new UqlUsageError(
      `${dialectName} has no ${index.type} index (index "${index.name}")` + (hints.get(index.type) ?? ''),
    );
  }
}

/** Refuses an index asking for a feature `features` lacks. */
export function assertIndexFeatures(
  index: IndexSchema,
  features: ReadonlySet<IndexFeature>,
  dialectName: string,
): void {
  for (const feature of getKeys(INDEX_FEATURE_PROBES)) {
    if (INDEX_FEATURE_PROBES[feature](index) && !features.has(feature)) {
      throw new UqlUsageError(
        `${dialectName} does not support ${INDEX_FEATURE_LABELS[feature]} (index "${index.name}")`,
      );
    }
  }
}

/**
 * `CREATE INDEX` in its portable form, which the SQLite family takes as is; the engines with more override
 * the fragments. The migrator's own, so no runtime entry carries it.
 */
export class IndexDdl {
  /** What this engine's `CREATE INDEX` can say. */
  protected readonly capabilities: IndexCapabilities;

  constructor(protected readonly dialect: AbstractSqlDialect) {
    this.capabilities = INDEX_CAPABILITIES[dialect.dialectName];
  }

  getCreateIndexStatement(tableName: string, index: IndexSchema, opts: { ifNotExists?: boolean } = {}): string {
    const { types, features, hints } = this.capabilities;
    assertIndexType(index, types, this.dialect.dialectName, hints);
    assertIndexFeatures(index, features, this.dialect.dialectName);
    const unique = index.unique ? 'UNIQUE ' : '';
    const ifNotExists = (opts.ifNotExists ?? this.dialect.features.indexIfNotExists) ? 'IF NOT EXISTS ' : '';
    const columns = this.indexTarget(index);
    return (
      `CREATE ${unique}${this.indexKeyword(index)} ${ifNotExists}${this.dialect.escapeId(index.name)} ` +
      `ON ${this.dialect.escapeId(tableName)}${this.indexAccessMethod(index)} (${columns})` +
      `${this.indexInclude(index)}${this.indexTuning(index)}${this.indexPredicate(index)};`
    );
  }

  /** What an index added to a table that has rows needs run after it to serve queries; nothing, mostly. */
  settleStatements(_tableName: string, _index: IndexSchema): string[] {
    return [];
  }

  /** The keyword an index type replaces `INDEX` with, or `INDEX` for the types that do not. */
  protected indexKeyword(index: IndexSchema): string {
    return (index.type && this.capabilities.keywords.get(index.type)) || 'INDEX';
  }

  /** ` USING <type>`, or nothing for no type or one spelled as its own keyword. */
  protected usingType(index: IndexSchema): string {
    return index.type && !this.capabilities.keywords.has(index.type) ? ` USING ${index.type}` : '';
  }

  /** What the index is over, between the parentheses: a fulltext one's columns as a search matches them, else its entries. */
  protected indexTarget(index: IndexSchema): string {
    if (index.type === 'fulltext' && !index.entries.some((entry) => entry.expression)) {
      const columns = index.entries.map((entry) => this.dialect.escapeId(entry.column));
      return this.dialect.textSearchTarget(columns, fulltextConfig(index));
    }
    return index.entries.map((entry) => this.indexColumn(entry, index)).join(', ');
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
      return `(${this.jsonPathIndexExpr(column, entry.jsonPath)})`;
    }
    return entry.length === undefined ? column : `${column}(${entry.length})`;
  }

  /** The path read the way a query comparing it reads it, which is how the planner matches the two. */
  protected jsonPathIndexExpr(escapedColumn: string, json: IndexJsonPath): string {
    return this.dialect.jsonPathExpr(escapedColumn, json.path, jsonTypeMode(json.type));
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

  /** The metric this engine's vector index names for the index's distance, refusing a distance it has none for. */
  protected indexMetric(index: IndexSchema): string {
    const distance = indexDistance(index);
    const metric = this.dialect.vectorMetrics.get(distance)?.index;
    if (!metric) {
      throw unsupportedVectorMetric(this.dialect.dialectName, distance, index.name);
    }
    return metric;
  }

  /** ` USING <method>`, which SQLite's grammar has no place for at all. */
  protected indexAccessMethod(_index: IndexSchema): string {
    return '';
  }

  /** What trails the columns: pgvector's ` WITH (m = ...)`, MySQL's ` USING btree`, MariaDB's ` M=8`. */
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
