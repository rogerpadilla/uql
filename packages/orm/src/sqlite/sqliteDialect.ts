import {
  AbstractSqlDialect,
  type CarriedFields,
  type DerivedRelation,
  type HydrateKind,
  type RelationRows,
} from '../dialect/abstractSqlDialect.js';
import { BYTES_PREFIX } from '../dialect/hydrateColumn.js';
import {
  chainedCall,
  groupsPerCall,
  jsonSetCall,
  type JsonAccessMode,
  jsonPath,
  jsonArraySlotArgs,
  type JsonSlot,
  jsonSlotArgs,
  jsonRemoveCall,
  jsonSetTarget,
} from '../dialect/jsonSql.js';
import {
  type EntityMeta,
  type FieldOptions,
  type Query,
  type QueryContext,
  type QueryPager,
  QueryRaw,
  type QueryTextSearchOptions,
  type QueryWhere,
  type SqlDialectFeatures,
  type VectorDistance,
  type VectorMetric,
} from '../type/index.js';
import { indexDistance, isVectorIndexType } from '../type/vector.js';
import { declaredIndexName } from '../util/ddlExpression.util.js';
import { findVectorIndex, findVectorSort, textSearchFields, vectorCandidates } from '../util/dialect.util.js';
import { columnFamily, isIntegerColumn } from '../util/field.util.js';

/**
 * An FTS5 query over `columns` for what a person typed: each word a quoted string, which FTS5 reads as a
 * term to match and never as syntax, and every one required, as the other engines read plain words.
 */
function ftsQuery(columns: readonly string[], value: string): string {
  const quote = (text: string) => `"${text.replaceAll('"', '""')}"`;
  const words = value.split(/\s+/).filter(Boolean);
  return `{${columns.map(quote).join(' ')}} : (${words.map(quote).join(' ') || '""'})`;
}

/** What SQLite and the engines derived from it have. */
export const SQLITE_FEATURES: SqlDialectFeatures = {
  indexIfNotExists: true,
  schemas: false, // SQLite's namespaces are attached database files, not declared objects
  dropTableCascade: false,
  foreignKeyAlter: false, // SQLite does not support adding FKs to existing tables
  primaryKeyAlter: false, // nor changing a key: the only route is rebuilding the table
  generatedColumnAdd: false, // accepted in a CREATE TABLE, rejected in an ALTER
  commentSyntax: 'none',
  vectorIndexRequiresNotNull: false,
  vectorSupportsLength: true,
  vectorBytes: true,
  supportsTimestamptz: false,
  stringSizing: 'text',
  supportsUnsigned: false,
  serverSideCursors: false,
  correlatedWrites: true,
  rowLocks: false,
  nullsOrdering: 'clause',
  textScoreIndexes: false,
  orderedUpsertReturning: true,
  orderedJsonAggregates: true,
  narrowVectorTypes: false,
  vectorTuningNeedsTransaction: false,
  serialDeclaresPrimaryKey: true,
  triggers: {
    preamble: '',
    assignsRow: false,
    body: 'inline',
    guards: 'clause',
    layout: 'timingFirst',
    rows: 'row',
    scope: 'schema',
    before: true,
  },
};

export class SqliteDialect extends AbstractSqlDialect {
  override readonly features: SqlDialectFeatures = SQLITE_FEATURES;

  override readonly dialectName = 'sqlite';

  override readonly escapeIdChar = '`';

  override readonly autoIncrementSuffix = 'PRIMARY KEY AUTOINCREMENT';

  override readonly tableOptions = '';

  override readonly beginTransactionCommand = 'BEGIN TRANSACTION';

  override readonly commitTransactionCommand = 'COMMIT';

  override readonly rollbackTransactionCommand = 'ROLLBACK';

  override readonly isolationLevelStrategy = 'none';

  override readonly alterColumnSyntax = 'none';

  override readonly booleanLiteral = 'integer';

  /** SQLite's own cap on a function call before 3.48, which libSQL and `bun:sqlite`'s build still have. */
  override readonly maxFunctionArgs: number = 127;

  // SQLite supports `RETURNING` (including on `INSERT ... ON CONFLICT`), so IDs are exact per row.
  override readonly insertIdSource = 'returning';

  /**
   * The [sqlite-vec](https://github.com/asg017/sqlite-vec) functions, which need that extension
   * loaded on the connection (see `Sqlite3QuerierPool`'s `extensions` option). libSQL and Turso ship
   * their own vector functions instead, so `LibsqlDialect` overrides this.
   */
  override readonly vectorMetrics: ReadonlyMap<VectorDistance, VectorMetric> = new Map([
    ['cosine', { fn: 'vec_distance_cosine' }],
    ['l2', { fn: 'vec_distance_L2' }],
    ['l1', { fn: 'vec_distance_L1' }],
  ]);

  /**
   * A read ranked by the metric its field's vector index measures, and paged, narrowed to the rowids of
   * that index's nearest rows, which libSQL's `vector_top_k` answers: `$candidates` of them, else as many
   * as the page reaches. Their exact distance still orders them. Unchanged on an engine with no such index.
   */
  protected override rankedWhere<E>(
    meta: EntityMeta<E>,
    q: Query<E>,
    prefix: string | undefined,
  ): QueryWhere<E> | undefined {
    const ranked = findVectorSort(q.$sort);
    const k = vectorCandidates(q) ?? (q.$limit === undefined ? undefined : (q.$skip ?? 0) + q.$limit);
    const index = ranked && findVectorIndex(meta, ranked.key);
    if (!ranked || !index || !isVectorIndexType(index.type) || k === undefined) {
      return q.$where;
    }
    const { colName, distance, field } = this.resolveVectorDistance(meta, ranked.key, ranked.search);
    if (indexDistance(index) !== distance || !this.vectorMetrics.get(distance)?.index) {
      return q.$where;
    }
    const name = declaredIndexName(index.name, this.resolveTableName(meta), [{ column: colName }]);
    const table = this.escapeId(prefix ?? this.resolveTableAlias(meta), true, true);
    const nearest = new QueryRaw(({ ctx }) => {
      ctx.append(`${table}rowid IN (SELECT id FROM vector_top_k(`);
      ctx.addValue(name);
      ctx.append(', ');
      this.appendVectorValue(ctx, ranked.search.$vector, field);
      ctx.append(', ');
      ctx.addValue(k);
      ctx.append('))');
    });
    const where: QueryWhere<E> = {};
    where.$and = q.$where ? [q.$where, nearest] : [nearest];
    return where;
  }

  /**
   * SQLite does not support the `DEFAULT` keyword inside `VALUES`. Inline the metadata default
   * when declared, else `NULL` (which is also how SQLite auto-generates INTEGER PRIMARY KEYs).
   */
  protected override appendDefaultInsertValue(ctx: QueryContext, field: FieldOptions | undefined): void {
    if (field?.defaultValue !== undefined) {
      this.formatPersistableValue(ctx, field, field.defaultValue);
    } else {
      ctx.append('NULL');
    }
  }

  // SQLite's `LIKE` already ignores case on both sides, for ASCII - and only ASCII, with or without
  // `NOCASE`, so folding the pattern here would break the accented text the engine leaves alone.
  protected override readonly caseInsensitiveMatch = 'native';

  override neExpr(field: string, ph: string): string {
    return `${field} IS NOT ${ph}`;
  }

  override normalizeValue(value: unknown): unknown {
    if (value instanceof Date) return value.getTime();
    return super.normalizeValue(value);
  }

  /**
   * `OFFSET` is only legal after a `LIMIT` here too, so a bare `$skip` needs one - `-1` being
   * SQLite's own spelling of "no limit", where the MySQL family uses its largest `BIGINT`.
   */
  override pager(ctx: QueryContext, opts: QueryPager): void {
    if (opts.$limit === undefined && opts.$skip !== undefined) {
      ctx.append(' LIMIT -1');
    }
    super.pager(ctx, opts);
  }

  /** `json_group_array` of each row's object, ordered by the sort terms carried out beside them. */
  protected override appendRelationArray(ctx: QueryContext, rows: RelationRows): void {
    const { from, pairs, order } = this.derivedRelation(ctx, rows);
    ctx.append(`(SELECT json_group_array(${this.jsonObject(pairs)}${order ? ` ORDER BY ${order}` : ''}) FROM ${from})`);
  }

  /**
   * `json_object` of each key and its column. A row wider than one call takes inserts the rest into it,
   * addressing each key as one path segment.
   */
  protected jsonObject(pairs: DerivedRelation['pairs']): string {
    const perCall = groupsPerCall(this.maxFunctionArgs, 2);
    const object = `json_object(${this.jsonObjectArgs(pairs.slice(0, perCall))})`;
    const inserts = pairs.slice(perCall).map(([key, sql]) => `${this.escape(`$."${key}"`)}, ${sql}`);
    return chainedCall('json_insert', object, inserts, 2, this.maxFunctionArgs);
  }

  /**
   * An integer crosses JSON as its exact text, which JSON would round past 2^53, and bytes as hex, which
   * `json_object` cannot hold at all. A real stays a number, since SQLite writes one to text with 15 digits.
   */
  protected override readonly carriedFields = {
    numeric: (expr, field) => (isIntegerColumn(field) ? `CAST(${expr} AS TEXT)` : expr),
    blob: (expr) => this.bytesAsText(expr),
    // D1 keeps a vector as its text; every other engine here, as float32 bytes.
    vector: (expr) => (this.features.vectorBytes ? this.bytesAsText(expr) : expr),
  } satisfies CarriedFields;

  private bytesAsText(expr: string): string {
    return `${this.escape(BYTES_PREFIX)} || hex(${expr})`;
  }

  /** A date reads back as SQLite stored it, a number or text, which JSON carries unchanged. */
  protected override hydrateKind(field: FieldOptions | undefined): HydrateKind | undefined {
    return columnFamily(field?.type) === 'date' ? undefined : super.hydrateKind(field);
  }

  /**
   * FTS5 matches the table itself, so this works only where the table *is* an FTS5 virtual table (UQL does
   * not create those; declare it outside your entities). The whole query is bound, column filter and all.
   */
  protected override appendTextSearch<E>(
    ctx: QueryContext,
    meta: EntityMeta<E>,
    search: QueryTextSearchOptions<E>,
  ): void {
    const columns = textSearchFields(meta, search).map((key) => this.resolveColumnName(key, meta.fields[key]));
    ctx.append(`${this.escapedTableName(meta)} MATCH `);
    ctx.addValue(ftsQuery(columns, search.$value));
  }

  /** FTS5's `BM25` of the match, lower for a better one, so negated to rank as every other engine does. */
  protected override appendTextScore<E>(ctx: QueryContext, meta: EntityMeta<E>): void {
    ctx.append(`-BM25(${this.escapedTableName(meta)})`);
  }

  protected override jsonLength(slot: JsonSlot): string {
    return `JSON_ARRAY_LENGTH(${jsonArraySlotArgs(slot, this.jsonIsArray(slot))})`;
  }

  /** `JSON_EACH` walks the array at the path itself, each element's `fullkey` naming it from the column. */
  protected override jsonElemFrom(slot: JsonSlot, alias: string): string {
    return `JSON_EACH(${jsonArraySlotArgs(slot, this.jsonIsArray(slot))}) ${alias}`;
  }

  protected override jsonIsArray(slot: JsonSlot): string {
    return `JSON_TYPE(${jsonSlotArgs(slot)}) = 'array'`;
  }

  /** An object element's `value` is its JSON text, which its fields are paths into. */
  protected override jsonElemDoc(alias: string): string {
    return `${alias}.value`;
  }

  /**
   * A scalar element's `value` is already typed, so a number and a string compare as such. Its JSON form
   * is read back from the column at the element's own `fullkey`, since `value` flattens a boolean to 0/1.
   */
  protected override jsonElemValue(slot: JsonSlot, alias: string, mode: JsonAccessMode): string {
    if (mode === 'json') {
      return `${slot.base} -> ${alias}.fullkey`;
    }
    const value = this.jsonElemDoc(alias);
    return mode === 'numeric' ? this.numericCast(value) : value;
  }

  /** `JSON_EXTRACT` already answers a number as one, and orders it by value. */
  protected override readonly jsonSortModes: readonly JsonAccessMode[] = ['text'];

  /** `->` for the JSON value, and `JSON_EXTRACT` for SQLite's own: a number as a number, a string as text. */
  protected override jsonPathReading(escapedColumn: string, path: string, mode: 'json' | 'text'): string {
    return mode === 'json'
      ? `(${escapedColumn} -> ${jsonPath(path)})`
      : `JSON_EXTRACT(${escapedColumn}, ${jsonPath(path)})`;
  }

  protected override numericCast(expr: string): string {
    return `CAST(${expr} AS REAL)`;
  }

  protected override jsonCast(operand: string): string {
    return `JSON(${operand})`;
  }

  /** `JSON` keeps each element's JSON type in the array, which answers `[]` for no rows. */
  protected override jsonArrayOf(elem: string): string {
    return `JSON_GROUP_ARRAY(JSON(${elem}))`;
  }

  protected override jsonSet(
    ctx: QueryContext,
    expr: string,
    set: Record<string, unknown>,
    field?: FieldOptions,
  ): string {
    return jsonSetCall(
      (value) => this.jsonScalarParam(ctx, value),
      jsonSetTarget(expr, field, `'{}'`),
      set,
      this.maxFunctionArgs,
    );
  }

  /** `[#]` appends, creating the array where it is absent: `JSON_SET`, since Turso's `JSON_INSERT` will not touch an existing array. */
  protected override jsonPush(ctx: QueryContext, expr: string, push: Record<string, unknown>): string {
    return jsonSetCall((value) => this.jsonScalarParam(ctx, value), expr, push, this.maxFunctionArgs, '[#]');
  }

  protected override jsonUnset(_ctx: QueryContext, expr: string, unset: readonly string[]): string {
    return jsonRemoveCall(expr, unset, this.maxFunctionArgs);
  }
}
