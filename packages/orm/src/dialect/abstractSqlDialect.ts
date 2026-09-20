import { fieldOf, getMeta, relationOf, soleIdOf } from '../entity/index.js';
import {
  type AggregateCall,
  type ColumnFamily,
  COUNT_RESULT_KEY,
  type EntityData,
  type EntityMeta,
  type EntityWhereMeta,
  type FieldKey,
  type FieldMeta,
  type FieldOptions,
  type FieldUpdateOp,
  type IsolationLevel,
  type JsonColumnType,
  type JsonUpdateOp,
  parseQueryLock,
  type Query,
  type QueryAggMap,
  type QueryAggregate,
  type QueryAggregateOp,
  type QueryBuildFn,
  type QueryCompareOp,
  type QueryComparisonOptions,
  type QueryConflictPaths,
  type QueryContext,
  type QueryContextOptions,
  type QueryCount,
  type QueryExclude,
  type QueryGroupMap,
  type QueryGroupOp,
  type QueryHavingMap,
  type QueryLikeOp,
  type QueryOptions,
  type QueryPage,
  type QueryPager,
  type QueryPopulate,
  QueryRaw,
  type QueryRawFnOptions,
  type QuerySearch,
  type QuerySelectValue,
  type QuerySizeComparisonOps,
  type QuerySortDirection,
  type QuerySortMap,
  type QueryTextSearchOptions,
  type QueryVectorNear,
  type QueryWhere,
  type QueryWhereArray,
  type QueryWhereOptions,
  RAW_ALIAS,
  type RelationKey,
  type RelationAggregateOp,
  type RelationAggregateProjection,
  type RelationAggregateSpec,
  type RelationMeta,
  type RelationQuery,
  type SqlDialectName,
  type SqlQueryDialect,
  type Type,
  type UpdatePayload,
  VECTOR_QUERY_KEYS,
} from '../type/index.js';
import { isInlinedExpression } from '../util/field.util.js';
import {
  asSelectMap,
  assertNonNegativeInteger,
  escapeSqlId,
  fillOnFields,
  filterFieldKeys,
  getInsertFieldKeys,
  getKeys,
  getRelationRequestSummary,
  getSoftDeleteValue,
  hasKeys,
  idOnlyQuery,
  columnFamily,
  countedRelations,
  fieldUpdateOf,
  fulltextIndexOver,
  fulltextWeights,
  isFieldUpdateOp,
  isJsonObject,
  isJsonUpdateOp,
  isOperatorMap,
  isOperatorKey,
  isVectorSearch,
  normalizeScalarFieldSelection,
  parentJoins,
  rankedTextSearch,
  targetKeyColumns,
  textSearchFields,
  textSortOf,
  textWeightSteps,
  type ParsedGroupEntry,
  parseGroupMap,
  parseRelationAtKey,
  parseRelationSize,
  populatesRelations,
  aggregateOf,
  raw,
  refs,
  throwUnknownAggregateColumn,
  withoutSoftDeleteFilter,
} from '../util/index.js';
import { escapeAnsiSqlLiteral } from '../util/sqlLiteral.js';
import { UqlUsageError } from '../util/uqlError.js';
import {
  AGGREGATE_PAGE_ALIAS,
  AGGREGATE_VALUE_ALIAS,
  ROWS_ALIAS,
  JSON_ELEM_ALIAS,
  JSON_PULL_ALIAS,
  relationSortColumn,
} from './aliases.js';
import type { HydrateKind } from './hydrateColumn.js';
import {
  holdsOperator,
  isJsonScalar,
  type JsonAccessMode,
  jsonCompareMode,
  jsonElemExists,
  jsonPath,
  type JsonSlot,
} from './jsonSql.js';
import { SqlQueryContext } from './queryContext.js';
import {
  groupPathField,
  NO_JOINS,
  type QueryJoins,
  type QuerySortOptions,
  aggregateColumnField,
  resolveGroupJoins,
  resolveQueryJoins,
  relationSortTerms,
  resolveSortableJoin,
} from './queryJoins.js';
import { resolveVectorCast } from './vectorCast.js';
import { VectorSqlDialect } from './vectorSqlDialect.js';

/** A scalar field's operator as the SQL arithmetic computing it. */
const SQL_ARITHMETIC = { $inc: '+', $mul: '*' } as const satisfies Record<keyof FieldUpdateOp, string>;

/** How a column's values are bound: see {@link AbstractSqlDialect.persistKind}. */
type PersistKind = 'plain' | 'json' | 'vector';

/** What {@link AbstractSqlDialect.insertShape} resolves once for a write, indexed in step. */
type InsertShape<E> = {
  readonly meta: EntityMeta<E>;
  readonly payloads: EntityData<E>[];
  readonly keys: FieldKey<E>[];
  readonly fields: (FieldOptions | undefined)[];
  readonly columns: string[];
  readonly kinds: PersistKind[];
};

/** One entry of {@link AbstractSqlDialect.LIKE_OPS}: how the pattern is built, and whether it ignores case. */
type LikeOp = { readonly pattern: (value: string) => string; readonly insensitive: boolean };

/** One entry of {@link AbstractSqlDialect.hydratableFields}: a field key and how it decodes. */
type HydratableField = readonly [string, HydrateKind];

/**
 * A JSON value a condition compares: `read` spells it the way each operator reads it, and `slot` is
 * where an array operator finds it. A path of a column, an array element, or a field of one.
 */
type JsonTarget = { readonly read: (mode: JsonAccessMode) => string; readonly slot: JsonSlot };

/** A direction as a statement writes it: the suffix, and where the caller asked nulls to land. */
type SortOrder = { readonly direction?: string; readonly nulls?: 'first' | 'last' };

/**
 * One `ORDER BY` term, taken apart: `key` is the path it sorts by, and `output` says `expr` already
 * names a column of the result.
 */
type SortTerm = SortOrder & {
  readonly key: string;
  readonly expr: string;
  readonly output: boolean;
};

/** A `$sort` walk's options: {@link QuerySortOptions}, and what the sorted query settles for every level of it. */
type SortWalk = QuerySortOptions & { readonly distinct?: boolean; readonly rankText: QueryBuildFn };

/** A sort term of a relation's rows as their aggregate orders by it: the column carrying it out. */
export type SortRef = SortOrder & { readonly ref: string };

/**
 * One column of a read's projection: the key its row answers under, none for a raw expression written
 * without an alias, and whether `sql` already answers under it, being a column of that very name.
 */
export type SelectTerm = { readonly sql: string; readonly key?: string; readonly bare?: boolean };

/** What an aggregate reads for one entry, and whether a bare column it can name inline. */
type AggregateValue = { readonly sql: string; readonly bare: boolean };

/** What a read selected, and for a relation's rows, the columns carrying their sort terms out. */
export type ReadProjection = { readonly terms: readonly SelectTerm[]; readonly order?: readonly SortRef[] };

/**
 * A read's options as its statement takes them: the caller's and the alias its table reads as. A
 * relation's rows read inside the parent's statement cross JSON, and where their aggregate orders them,
 * carry their sort terms out as columns.
 */
type ReadOptions = QueryOptions & {
  readonly alias?: string;
  readonly json?: boolean;
  readonly carried?: boolean;
};

/**
 * A projection's options: the alias its columns are qualified by, whether its values cross JSON, and
 * whether it is a joined row's, which keeps its id.
 */
type SelectOptions = { readonly prefix?: string; readonly json?: boolean; readonly joined?: boolean };

/** A to-many's rows as the parent's statement reads them: an ordinary read of the related entity. */
export type RelationRows = {
  readonly entity: Type<object>;
  readonly query: Query<object>;
  readonly alias: string;
  readonly joins: QueryJoins;
  /** Whether the parent deduplicates its rows, which compares this value with the rest. */
  readonly distinct: boolean;
};

/**
 * A relation's rows as a derived table: `from` is the table clause, `pairs` each key of a row with the
 * column holding it, and `order` what their aggregate orders them by.
 */
export type DerivedRelation = {
  readonly from: string;
  readonly pairs: readonly (readonly [key: string, sql: string])[];
  readonly order: string;
};

/** How each column family's value is spelled to cross JSON: see {@link AbstractSqlDialect.carriedFields}. */
export type CarriedFields = { readonly [F in ColumnFamily]?: (expr: string, field: FieldOptions) => string };

/** The key a term answers under in a populated relation's row, which a raw expression has only once aliased. */
export function relationTermKey({ sql, key }: SelectTerm): string {
  return orRefuse(key, `a raw $select in a populated relation needs an alias, the key its value lands under: ${sql}`);
}

/**
 * What a projection reads: its raw expressions, or its fields past any `$exclude`, and every field where
 * none is left of a row crossing JSON, which answers only under keys.
 */
function projectedKeys<E>(
  meta: EntityMeta<E>,
  select: QuerySelectValue<E> | undefined,
  exclude: QueryExclude<E> | undefined,
  json: boolean | undefined,
): readonly (FieldKey<E> | QueryRaw)[] {
  const selected: readonly (FieldKey<E> | QueryRaw)[] = Array.isArray(select)
    ? select
    : normalizeScalarFieldSelection(meta, asSelectMap(select), exclude);
  return selected.length || !json ? selected : normalizeScalarFieldSelection(meta);
}

export type { HydrateKind };

/** `value`, where there is one; a `UqlUsageError` saying `refusal` where there is none. */
function orRefuse<T>(value: T | undefined, refusal: string): T {
  if (value === undefined) {
    throw new UqlUsageError(refusal);
  }
  return value;
}

/** An `$in`/`$nin` operand, which the types require to be an array but `/http` hands over untyped. */
function inOperands(op: string, value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new UqlUsageError(`${op} expects an array, got ${value === null ? 'null' : typeof value}`);
  }
  return value;
}

/**
 * What a relation subquery selects: `exists` for a relation operator that only asks whether a row is
 * there, `value` for the column a capped aggregate carries out to the page wrapping it, and otherwise
 * the aggregate itself.
 */
type RelationSubqueryProjection = { readonly op: 'exists'; readonly field?: never } | RelationAggregateProjection;

/** One relation subquery as its caller states it: what to select, and which of the rows to read. */
type RelationSubqueryRead = RelationSubqueryProjection & Pick<AggregateCall, 'where'>;

export abstract class AbstractSqlDialect extends VectorSqlDialect implements SqlQueryDialect {
  // Narrow dialect type from Dialect to SqlDialect
  abstract override readonly dialectName: SqlDialectName;

  abstract readonly escapeIdChar: '"' | '`';
  /**
   * The column type of a database-generated key: only the type, never the key itself, which the table
   * declares over its columns as one named constraint. SQLite is the exception: see
   * `SqlDialectFeatures.serialDeclaresPrimaryKey`.
   */
  abstract readonly autoIncrementSuffix: string;

  abstract readonly tableOptions: string;
  abstract readonly beginTransactionCommand: string;
  abstract readonly commitTransactionCommand: string;
  abstract readonly rollbackTransactionCommand: string;

  /**
   * How this engine declares a namespace, so a generated migration creates the schemas its tables
   * need before creating them. Only reached where {@link DialectFeatures.schemas} is on. MySQL and
   * MariaDB accept the same statement, where it means a database.
   */
  createSchemaSql(schema: string): string {
    return `CREATE SCHEMA IF NOT EXISTS ${this.escapeId(schema, true)}`;
  }

  readonly isolationLevelStrategy: 'inline' | 'set-before' | 'none' = 'inline';

  readonly alterColumnStrategy: 'separate-clauses' | 'single-statement' = 'single-statement';

  readonly alterColumnSyntax: 'ALTER COLUMN' | 'MODIFY COLUMN' | 'none' = 'ALTER COLUMN';

  readonly dropForeignKeySyntax: 'DROP CONSTRAINT' | 'DROP FOREIGN KEY' = 'DROP CONSTRAINT';

  /**
   * `DROP CONSTRAINT <name>` where a primary key is a named constraint like any other; MySQL spells
   * it `DROP PRIMARY KEY` and takes no name, since a table's key is always called `PRIMARY` there.
   */
  readonly dropPrimaryKeySyntax: 'DROP CONSTRAINT' | 'DROP PRIMARY KEY' = 'DROP CONSTRAINT';

  readonly dropIndexSyntax: 'on-table' | 'standalone' = 'standalone';

  readonly booleanLiteral: 'native' | 'integer' = 'native';

  /**
   * Maximum number of bind parameters the driver accepts in a single statement.
   * `insertMany` splits larger batches into multiple statements based on this limit.
   */
  readonly maxBindValues: number = 32766;

  /**
   * The most arguments one SQL function call takes. A variadic call past it, a wide relation row or JSON
   * update, is spread over nested calls. No cap binds unless a dialect declares one.
   */
  readonly maxFunctionArgs: number = Infinity;

  getBeginTransactionStatements(isolationLevel?: IsolationLevel): string[] {
    const level = isolationLevel?.toUpperCase();
    const strategy = this.isolationLevelStrategy;
    if (!level || strategy === 'none') {
      return [this.beginTransactionCommand];
    }
    if (strategy === 'inline') {
      return [`${this.beginTransactionCommand} ISOLATION LEVEL ${level}`];
    }
    // 'set-before' - MySQL/MariaDB pattern
    return [`SET TRANSACTION ISOLATION LEVEL ${level}`, this.beginTransactionCommand];
  }

  createContext(options: QueryContextOptions = {}): QueryContext {
    return new SqlQueryContext(this, [], undefined, options.inlineValues);
  }

  /**
   * The SQL `build` writes, as text to embed rather than appended to `ctx`. It binds into `ctx`'s own values
   * and aliases, so `$n` placeholders number against the whole statement.
   */
  protected buildFragment(ctx: QueryContext, build: QueryBuildFn): string {
    const fragmentCtx = ctx.createFragment();
    build(fragmentCtx);
    return fragmentCtx.sql;
  }

  /** A `raw()` rendered in place, an operand or a projected term: bound, the driver would get the object. */
  protected rawFragment(ctx: QueryContext, value: QueryRaw, prefix?: string, entity?: Type<unknown>): string {
    return this.buildFragment(ctx, (fragmentCtx) => this.getRawValue(fragmentCtx, { value, prefix, entity }));
  }

  /**
   * Each operand rendered on its own, keeping those that emitted SQL: an empty one leaves no dangling
   * separator, and the count of what emitted decides the parentheses.
   */
  protected renderOperands<T>(
    ctx: QueryContext,
    operands: readonly T[],
    render: (ctx: QueryContext, operand: T) => void,
  ): string[] {
    return operands
      .map((operand) => this.buildFragment(ctx, (fragmentCtx) => render(fragmentCtx, operand)))
      .filter((part) => part !== '');
  }

  addValue(ctx: QueryContext, value: unknown): string {
    if (value instanceof QueryRaw) {
      return this.rawFragment(ctx, value);
    }
    if (ctx.inlineValues) {
      return this.escape(this.normalizeValue(value));
    }
    ctx.values.push(this.normalizeValue(value));
    return this.placeholder(ctx.values.length);
  }

  /**
   * A parameter value as this engine's driver takes it: a boolean as the integer an engine with no
   * boolean type stores, and everything else as it is - a `bigint` included, which every driver here
   * binds exactly, where a number would round it past 2^53. A driver that refuses one (D1) overrides.
   */
  normalizeValue(value: unknown): unknown {
    if (typeof value === 'boolean' && this.booleanLiteral !== 'native') {
      return value ? 1 : 0;
    }
    return value;
  }

  /**
   * Normalizes a list of parameter values.
   */
  normalizeValues(values: unknown[] | undefined): unknown[] | undefined {
    return values?.map((v) => this.normalizeValue(v));
  }

  placeholder(_index: number): string {
    return '?';
  }

  /** `RETURNING <id column> id`, or nothing on a composite key, whose every column the payload already names. */
  returningId<E>(meta: EntityMeta<E>): string {
    const expression = this.returningIdExpression(meta);
    return expression ? `RETURNING ${expression}` : '';
  }

  /** `<id column> AS id` on its own, for a statement composing a `RETURNING` list of several items. */
  protected returningIdExpression<E>(meta: EntityMeta<E>): string {
    const [idKey] = meta.ids;
    return meta.ids.length === 1 ? `${this.escapeId(this.columnOf(meta, idKey))} ${this.escapeId('id')}` : '';
  }

  search<E>(
    ctx: QueryContext,
    entity: Type<E>,
    q: Query<E> = {},
    opts: ReadOptions = {},
    joins = NO_JOINS,
    order?: readonly SortRef[],
  ): void {
    const meta = getMeta(entity);
    const prefix = this.resolveRelationAwarePrefix(this.resolveTableAlias(meta), meta, opts, q.$populate, joins);
    if (opts.prefix !== prefix) {
      opts = { ...opts, prefix };
    }
    this.where<E>(ctx, entity, this.rankedWhere(meta, q, prefix), opts);
    const sorted = order ? this.orderCarried(ctx, q, order) : this.sort<E>(ctx, entity, q, { prefix, joins });
    this.pager(ctx, q, sorted);
  }

  /**
   * A relation's rows ordered by the columns their sort terms were carried out in, where they are
   * paged: otherwise the aggregate reading them orders them, and sorting them first is wasted work.
   */
  private orderCarried(ctx: QueryContext, q: QueryPager, order: readonly SortRef[]): boolean {
    if (!order.length || (q.$limit === undefined && q.$skip === undefined)) {
      return false;
    }
    ctx.append(` ORDER BY ${order.map(({ ref, ...term }) => this.orderByTerm(ref, term)).join(', ')}`);
    return true;
  }

  /**
   * The columns a projection reads: each field under its key, a raw expression under its alias, and
   * `*` where nothing is left, or every field in a row crossing JSON, which answers only under keys. A
   * joined row keeps its key, every column of a composite past any subtraction: it is what tells a
   * matched row from no match.
   */
  selectTerms<E>(
    ctx: QueryContext,
    entity: Type<E>,
    select: QuerySelectValue<E> | undefined,
    opts: SelectOptions = {},
    exclude?: QueryExclude<E>,
  ): SelectTerm[] {
    const meta = getMeta(entity);
    const selected = projectedKeys(meta, select, exclude, opts.json);
    const missingIds = opts.joined ? meta.ids.filter((key) => !selected.includes(key)) : [];
    const keys = missingIds.length ? [...missingIds, ...selected] : selected;
    if (!keys.length) {
      return [{ sql: `${this.escapeId(opts.prefix, true, true)}*`, bare: true }];
    }
    return keys.map((key) =>
      key instanceof QueryRaw
        ? { sql: this.rawFragment(ctx, key, opts.prefix), key: key[RAW_ALIAS] }
        : this.fieldTerm(ctx, meta, key, opts),
    );
  }

  /** One field's column, or the expression an inlined one stands for, as the projection reads it. */
  private fieldTerm<E>(ctx: QueryContext, meta: EntityMeta<E>, key: FieldKey<E>, opts: SelectOptions): SelectTerm {
    const field = fieldOf(meta, key);
    if (isInlinedExpression(field)) {
      // Qualified even when nothing else in this statement is: the expression is spliced in, and one
      // that opens a correlated subquery has the inner table's columns in scope, so a bare `"id"`
      // would bind to *that* table instead of this one.
      const sql = this.rawFragment(ctx, field.computed, opts.prefix ?? this.resolveTableAlias(meta), meta.entity);
      return { sql: opts.json ? this.carried(`(${sql})`, field) : sql, key };
    }
    const columnName = this.resolveColumnName(key, field);
    const column = this.escapeId(opts.prefix, true, true) + this.escapeId(columnName);
    const sql = opts.json ? this.carried(column, field) : this.selectFieldExpr(column, field);
    return { sql, key, bare: sql === column && columnName === key };
  }

  /**
   * What follows `SELECT` before the projection. Empty everywhere but SQL Server, whose `FETCH` will
   * not take a zero and which spells "no rows" as `TOP (0)` instead.
   */
  protected selectModifier<E>(_q: Query<E>): string {
    return '';
  }

  /**
   * The expression a scalar field is read through in the statement's own rows, the plain column by
   * default. MariaDB reads a vector column back as hex, since selecting it raw yields its binary form.
   * A related row's column crosses JSON through {@link carriedFields} instead.
   */
  protected selectFieldExpr(escapedColumn: string, _field: FieldOptions): string {
    return escapedColumn;
  }

  /**
   * The `$text` full-text predicate, which every engine spells differently: `MATCH ... AGAINST`
   * (MySQL family), `TO_TSVECTOR @@ WEBSEARCH_TO_TSQUERY` (Postgres-wire), an FTS5 `MATCH` against
   * the table itself (SQLite). No portable form exists, so a dialect without one says so here rather
   * than inheriting another engine's syntax.
   */
  protected appendTextSearch<E>(
    _ctx: QueryContext,
    _meta: EntityMeta<E>,
    _search: QueryTextSearchOptions<E>,
    _prefix: string | undefined,
  ): void {
    throw new UqlUsageError(`${this.dialectName} does not support $text full-text search`);
  }

  /**
   * A row's relevance to a `$text` search, what `$sort: { $text }` orders by. Where the fulltext index
   * weighs its columns, a match counts its column's weight, as MongoDB's `textScore` counts it: the score
   * over every column times the lightest weight, plus each heavier column's own times what it weighs more.
   */
  private appendTextRank<E>(
    ctx: QueryContext,
    meta: EntityMeta<E>,
    search: QueryTextSearchOptions<E>,
    prefix: string | undefined,
  ): void {
    const keys = textSearchFields(meta, search);
    const index = fulltextIndexOver(meta, keys);
    const weights = index && fulltextWeights({ type: index.type, entries: index.columns });
    if (!weights) {
      this.appendTextScore(ctx, meta, search, keys, prefix);
      return;
    }
    const { lightest, extra } = textWeightSteps(weights);
    ctx.append(`(${lightest} * `);
    this.appendTextScore(ctx, meta, search, keys, prefix);
    keys.forEach((key, at) => {
      if (extra[at]) {
        ctx.append(` + ${extra[at]} * `);
        this.appendTextScore(ctx, meta, search, [key], prefix);
      }
    });
    ctx.append(')');
  }

  /**
   * How relevant the `keys` of a row are to a `$text` search, higher for a better match. Each engine that
   * searches scores too, so a dialect overrides this beside {@link appendTextSearch}.
   */
  protected appendTextScore<E>(
    _ctx: QueryContext,
    _meta: EntityMeta<E>,
    _search: QueryTextSearchOptions<E>,
    _keys: readonly string[],
    _prefix: string | undefined,
  ): void {
    throw new UqlUsageError(`${this.dialectName} does not support $text full-text search`);
  }

  /** The columns a `$text` over `keys` reads, qualified by `prefix` where the statement joins, as any column is. */
  protected textColumns<E>(meta: EntityMeta<E>, keys: readonly string[], prefix: string | undefined): string[] {
    return keys.map((key) => this.columnWithPrefix(key, meta.fields[key as FieldKey<E>], prefix));
  }

  /** Ranks by the root `$text` of `where`, which is looked up only once a `$sort` asks for it. */
  private textRanker<E>(
    meta: EntityMeta<E>,
    where: QueryWhere<E> | undefined,
    prefix: string | undefined,
  ): QueryBuildFn {
    return (ctx) => this.appendTextRank(ctx, meta, rankedTextSearch(where), prefix);
  }

  select<E>(
    ctx: QueryContext,
    entity: Type<E>,
    q: Query<E>,
    opts: ReadOptions = {},
    joins = NO_JOINS,
    totalAlias?: string,
  ): ReadProjection {
    const meta = getMeta(entity);
    const { alias, ref } = this.tableRef(meta, opts.alias);
    const prefix = this.resolveRelationAwarePrefix(alias, meta, opts, q.$populate, joins);
    const terms = this.projection(ctx, entity, q, { prefix, json: opts.json }, joins);
    const carried = opts.carried ? this.carrySort(ctx, meta, q, { prefix, joins }) : undefined;
    const columns = carried ? [...terms, ...carried.columns] : [...terms];
    if (totalAlias) {
      columns.push({ sql: this.totalOverExpr, key: totalAlias });
    }
    ctx.append(q.$distinct ? 'SELECT DISTINCT ' : 'SELECT ');
    ctx.append(this.selectModifier(q));
    ctx.append(columns.map((term) => this.termSql(term)).join(', '));
    ctx.append(` FROM ${ref}${this.lockHint(q)}`);
    this.selectRelationJoins(ctx, meta, alias, joins);
    return { terms, order: carried?.order };
  }

  /**
   * Everything a read's rows answer under, in order: its own fields, each joined row's fields and to-many
   * relations under its path, its own to-many relations and `$count`, and each vector distance a `$sort`
   * projects.
   */
  protected projection<E>(
    ctx: QueryContext,
    entity: Type<E>,
    q: Query<E>,
    opts: SelectOptions,
    joins: QueryJoins,
  ): SelectTerm[] {
    const meta = getMeta(entity);
    const parent = opts.prefix ?? this.resolveTableAlias(meta);
    const distinct = !!q.$distinct;
    return [
      ...this.selectTerms(ctx, entity, q.$select, opts, q.$exclude),
      ...this.selectJoinedRows(ctx, joins, opts.json, distinct),
      ...this.selectToManyRelations(ctx, meta, q.$populate, parent, distinct),
      ...this.selectRelationCounts(ctx, meta, q.$count, parent),
      ...this.selectSortProjections(ctx, meta, q, opts.prefix),
    ];
  }

  /** A term as a projection writes it, aliased unless its SQL already answers under its key. */
  private termSql({ sql, key, bare }: SelectTerm): string {
    return bare || key === undefined ? sql : `${sql} ${this.escapeId(key, true)}`;
  }

  /** What a `$sort` projects, each under the name it asked for: a vector's distance, the `$text` relevance. */
  private selectSortProjections<E>(
    ctx: QueryContext,
    meta: EntityMeta<E>,
    q: Query<E>,
    prefix: string | undefined,
  ): SelectTerm[] {
    const distances = Object.entries(q.$sort ?? {}).flatMap(([key, value]) =>
      isVectorSearch(value) && value.$project
        ? [
            this.sortProjection(ctx, meta, value.$project, (fragmentCtx) =>
              this.appendVectorDistance(fragmentCtx, meta, key, value, prefix),
            ),
          ]
        : [],
    );
    const score = textSortOf(q.$sort)?.project;
    return score
      ? [...distances, this.sortProjection(ctx, meta, score, this.textRanker(meta, q.$where, prefix))]
      : distances;
  }

  private sortProjection<E>(ctx: QueryContext, meta: EntityMeta<E>, alias: string, build: QueryBuildFn): SelectTerm {
    this.assertProjectable(meta, alias);
    return { sql: this.buildFragment(ctx, build), key: alias };
  }

  /**
   * A relation's sort terms carried out beside its rows as columns, for the aggregate reading them to
   * order by: a term that names a column of theirs already is ordered by that one.
   */
  private carrySort<E>(
    ctx: QueryContext,
    meta: EntityMeta<E>,
    q: Query<E>,
    opts: QuerySortOptions,
  ): { columns: SelectTerm[]; order: SortRef[] } {
    const columns: SelectTerm[] = [];
    const order = this.sortTerms(ctx, meta, q, opts).map(({ key, expr, output, ...term }) => {
      if (output) {
        return { ref: expr, ...term };
      }
      const column = relationSortColumn(key);
      columns.push({ sql: expr, key: column });
      return { ref: this.escapeId(column, true), ...term };
    });
    return { columns, order };
  }

  /**
   * The table as a statement writes it, each part escaped on its own rather than as one dotted
   * string taken apart again by {@link escapeId}.
   */
  protected escapedTableName<E>(meta: EntityMeta<E>): string {
    return this.escapeQualifiedId(this.resolveTableAlias(meta), this.resolveSchema(meta));
  }

  /**
   * A FROM or JOIN operand plus the alias to prefix its columns by, aliased once a schema puts something
   * in front of the name, or the read takes an alias of its own. See {@link resolveTableAlias} for why
   * the prefix cannot be the qualified path.
   */
  protected tableRef<E>(meta: EntityMeta<E>, alias = this.resolveTableAlias(meta)): { alias: string; ref: string } {
    const name = this.escapedTableName(meta);
    const aliased = !!this.resolveSchema(meta) || alias !== this.resolveTableAlias(meta);
    return { alias, ref: aliased ? `${name} ${this.escapeId(alias, true)}` : name };
  }

  /**
   * Columns are qualified once anything else is in play: an alias of the read's own, a join, or a
   * relation being read.
   */
  private resolveRelationAwarePrefix<E>(
    tableName: string,
    meta: EntityMeta<E>,
    opts: ReadOptions,
    populate: QueryPopulate<E> | undefined,
    joins: QueryJoins,
  ): string | undefined {
    if (opts.alias) {
      return opts.alias;
    }
    return (opts.prefix ?? (opts.autoPrefix || joins.size > 0 || populatesRelations(meta, populate)))
      ? tableName
      : undefined;
  }

  /** Each joined row's columns and to-many relations under its path, which is what unflattens it. */
  protected selectJoinedRows(
    ctx: QueryContext,
    joins: QueryJoins,
    json: boolean | undefined,
    distinct: boolean,
  ): SelectTerm[] {
    const terms: SelectTerm[] = [];
    for (const join of joins.values()) {
      // A join `$sort` asked for adds no columns: it orders the rows, it does not widen them.
      if (!join.projected) continue;
      const opts = { prefix: join.alias, json, joined: true };
      const row = [
        ...this.selectTerms(ctx, join.entity, join.query.$select, opts, join.query.$exclude),
        ...this.selectToManyRelations(ctx, join.meta, join.query.$populate, join.alias, distinct),
      ];
      for (const term of row) {
        terms.push({ sql: term.sql, key: `${join.path}.${relationTermKey(term)}` });
      }
    }
    return terms;
  }

  protected selectRelationJoins<E>(ctx: QueryContext, meta: EntityMeta<E>, rootAlias: string, joins: QueryJoins): void {
    for (const join of joins.values()) {
      const joinAlias = this.escapeId(join.alias, true);
      const parentAlias = this.escapeId(join.parent ? join.parent.alias : rootAlias, true);

      ctx.append(` ${join.required ? 'INNER' : 'LEFT'} JOIN ${this.escapedTableName(join.meta)} ${joinAlias} ON `);
      join.relation.references.forEach((reference, index) => {
        if (index > 0) ctx.append(' AND ');
        const foreign = this.escapeId(this.columnOf(join.meta, reference.foreign));
        // Two calls rather than one over a union: the parent is either another join's entity or the
        // queried one, and their metadata types have nothing in common.
        const local = this.escapeId(
          join.parent ? this.columnOf(join.parent.meta, reference.local) : this.columnOf(meta, reference.local),
        );
        ctx.append(`${joinAlias}.${foreign} = ${parentAlias}.${local}`);
      });

      // Unconditional, not gated by `join.query.$where`: a joined relation's own filters (in
      // particular `security: true` ones) must apply even to a bare `$populate: { rel: true }`
      // with no explicit `$where` - and equally to a join `$sort` brought in on its own.
      // `where()` -> `renderWhere()` no-ops cleanly (appends nothing) when there is nothing to add.
      this.where(ctx, join.entity, join.query.$where ?? {}, { prefix: join.alias, clause: 'AND' });
    }
  }

  where<E>(ctx: QueryContext, entity: Type<E>, where: QueryWhere<E> = {}, opts: QueryWhereOptions = {}): void {
    const meta = getMeta(entity);
    // Filters are applied once, here at the scope entry point; recursion uses `renderWhere`.
    this.renderWhere(ctx, entity, this.scopedWhere(meta, where, opts), opts);
  }

  /** Renders a `$where` tree without applying entity filters (used for same-scope group-operator recursion). */
  protected renderWhere<E>(
    ctx: QueryContext,
    entity: Type<E>,
    where: QueryWhere<E> = {},
    opts: QueryWhereOptions = {},
  ): void {
    const { clause = 'WHERE' } = opts;

    // An `undefined` value emits nothing, so it must not count towards the terms either: it decides
    // whether the keys below render as operands of an `AND`.
    const whereKeys = getKeys(where).filter((key) => where[key] !== undefined);

    // Each key is an operand of the `AND` joining them; a lone key emits this fragment verbatim, so
    // it inherits this one's position instead.
    const childOperand = whereKeys.length > 1 || opts.operand || clause === 'AND';
    const childOpts = opts.operand === childOperand ? opts : { ...opts, operand: childOperand };

    const parts = this.renderOperands(ctx, whereKeys, (fragmentCtx, key) =>
      this.compare(fragmentCtx, entity, key, where[key], childOpts),
    );

    if (!parts.length) {
      return;
    }

    if (clause) {
      ctx.append(` ${clause} `);
    }

    // This fragment joins its own keys with `AND`, so appending it after one (a JOIN's `ON`) needs no
    // parentheses - but anything nested in it is still an operand, since that may be an `OR`.
    const body = parts.join(' AND ');
    ctx.append(parts.length > 1 && opts.operand ? `(${body})` : body);
  }

  compare<E>(ctx: QueryContext, entity: Type<E>, key: string, val: unknown, opts: QueryComparisonOptions = {}): void {
    const meta = getMeta(entity);

    if (val instanceof QueryRaw) {
      if (key === '$exists' || key === '$nexists') {
        ctx.append(key === '$exists' ? 'EXISTS (' : 'NOT EXISTS (');
        // The read's alias: the enclosing statement declares one, and Postgres forbids reaching past
        // it to the qualified name it aliased.
        const alias = opts.prefix ?? this.resolveTableAlias(meta);
        this.getRawValue(ctx, {
          value: val,
          prefix: alias,
          escapedPrefix: this.escapeId(alias, true, true),
        });
        ctx.append(')');
        return;
      }
      this.getComparisonKey(ctx, entity, key as FieldKey<E>, opts);
      ctx.append(' = ');
      this.getRawValue(ctx, { value: val, prefix: opts.prefix });
      return;
    }

    if (key === '$text') {
      this.appendTextSearch(ctx, meta, val as QueryTextSearchOptions<E>, opts.prefix);
      return;
    }

    if (AbstractSqlDialect.isGroupOp(key)) {
      this.compareLogicalOperator(ctx, entity, key, val as QueryWhereArray<E>, opts);
      return;
    }

    // Detect JSONB dot-notation: 'column.path' where column is a registered JSON/JSONB field
    const jsonDot = this.resolveJsonDotPath(meta, key, opts.prefix);
    if (jsonDot) {
      ctx.append(this.jsonConditions(ctx, this.jsonPathTarget(jsonDot), val));
      return;
    }

    if (key.includes('.')) {
      throw new UqlUsageError(`path ${key} does not exist in ${meta.name}`);
    }

    const rel = meta.relations[key];
    if (rel) {
      const sizeVal = parseRelationSize(val);
      if (sizeVal !== undefined) {
        this.compareRelationSize(ctx, entity, key, sizeVal, rel, opts);
        return;
      }
      this.compareRelation(ctx, entity, key, val as QueryWhere<object>, rel, opts);
      return;
    }

    const value = this.normalizeWhereValue(val);
    const parts = getKeys(value).map((op) => this.fieldCondition(ctx, entity, key as FieldKey<E>, op, value[op], opts));
    ctx.append(AbstractSqlDialect.conjunction(parts));
  }

  /** Conditions joined by `AND`, parenthesized where there is more than one. */
  private static conjunction(parts: readonly string[]): string {
    return parts.length > 1 ? `(${parts.join(' AND ')})` : parts.join('');
  }

  protected compareLogicalOperator<E>(
    ctx: QueryContext,
    entity: Type<E>,
    key: QueryGroupOp,
    val: QueryWhereArray<E>,
    opts: QueryComparisonOptions,
  ): void {
    const { join, negate } = AbstractSqlDialect.GROUP_OPS[key];
    const items = AbstractSqlDialect.groupClauses(key, val);
    // With more than one item each is an operand of the operator joining them, so a compound item
    // parenthesizes itself and precedence never applies; a lone item is this group verbatim, so it
    // inherits the group's own position. A negation always makes its subject an operand.
    const childOperand = items.length > 1 || negate || opts.operand;

    const parts = this.renderOperands(ctx, items, (fragmentCtx, entry) => {
      if (entry instanceof QueryRaw) {
        this.getRawValue(fragmentCtx, { value: entry, prefix: opts.prefix });
      } else {
        this.renderWhere(fragmentCtx, entity, entry, { prefix: opts.prefix, operand: childOperand, clause: false });
      }
    });

    if (!parts.length) {
      return;
    }

    const body = parts.join(join === '$or' ? ' OR ' : ' AND ');
    const parenthesize = parts.length > 1 && (opts.operand || negate);
    ctx.append((negate ? 'NOT ' : '') + (parenthesize ? `(${body})` : body));
  }

  /** Memoizes {@link escapedColumnName}; see there for why it is per dialect instance. */
  private readonly escapedColumns = new WeakMap<FieldOptions, string>();

  private static readonly COMPARE_OP_MAP = new Map<QueryCompareOp, string>([
    ['$gt', ' > '],
    ['$gte', ' >= '],
    ['$lt', ' < '],
    ['$lte', ' <= '],
  ]);

  /** What a `$near` says about the search itself; everything else in it is a bound. */
  private static readonly VECTOR_QUERY_KEYS: ReadonlySet<string> = new Set<string>(VECTOR_QUERY_KEYS);

  /**
   * The ordered comparisons, `QueryOrderedOp` at runtime, derived from the map above rather than spelled
   * again: {@link QueryVectorNear}'s bounds, so `$near` never accepts one the renderer has no operator
   * for, and the operators that read a JSON path as a number.
   */
  private static readonly ORDERED_OPS: ReadonlySet<string> = new Set<string>([
    ...AbstractSqlDialect.COMPARE_OP_MAP.keys(),
    '$between',
  ]);

  /** The operators an equality compares by value, which a JSON path reads the way that value compares. */
  private static readonly EQUALITY_OPS: ReadonlySet<string> = new Set<string>(['$eq', '$ne', '$in', '$nin']);

  /**
   * Every `$like`-family operator: the pattern it wraps its value in, and whether it ignores case.
   * Each case-sensitive operator is paired here with the `$i` twin that shares its pattern, so the
   * two can never drift apart - and neither one decides case folding, which is
   * {@link caseInsensitiveMatch}'s single call.
   */
  private static readonly LIKE_OPS: ReadonlyMap<string, LikeOp> = new Map(
    (
      [
        ['$like', '$ilike', (v: string) => v],
        ['$startsWith', '$istartsWith', (v: string) => `${v}%`],
        ['$endsWith', '$iendsWith', (v: string) => `%${v}`],
        ['$includes', '$iincludes', (v: string) => `%${v}%`],
      ] satisfies readonly [QueryLikeOp, QueryLikeOp, (v: string) => string][]
    ).flatMap(([sensitive, insensitive, pattern]): [string, LikeOp][] => [
      [sensitive, { pattern, insensitive: false }],
      [insensitive, { pattern, insensitive: true }],
    ]),
  );

  /**
   * How the engine matches case-insensitively: `ilike` has the operator, `native` ignores case already
   * (SQLite, where folding in JS would break non-ASCII), and `fold` lowers both sides.
   */
  protected readonly caseInsensitiveMatch: 'ilike' | 'native' | 'fold' = 'fold';

  /**
   * A `$like`-family condition, or `undefined` when `op` is not one of them. Shared by columns and
   * JSON paths, and the only place a pattern is folded - always together with the column it is
   * compared against.
   */
  protected likeCondition(ctx: QueryContext, operand: string, op: string, val: unknown): string | undefined {
    const like = AbstractSqlDialect.LIKE_OPS.get(op);
    if (!like) {
      return undefined;
    }
    const fold = like.insensitive && this.caseInsensitiveMatch === 'fold';
    const value = String(val);
    const ph = this.addValue(ctx, like.pattern(fold ? value.toLowerCase() : value));
    const matchOp = like.insensitive && this.caseInsensitiveMatch === 'ilike' ? 'ILIKE' : this.likeFn;
    return `${fold ? `LOWER(${operand})` : operand} ${matchOp} ${ph}`;
  }

  /** Builds `prefix.column` from an already-resolved field, through the same memo writes use. */
  private columnWithPrefix(key: string, field: FieldOptions | undefined, prefix: string | undefined): string {
    return this.escapeId(prefix, true, true) + this.escapedColumnOf(key, field);
  }

  /**
   * The SQL a field comparison reads its left-hand side from. An inlined field builds its expression
   * as text rather than appending it, so every operator gets a real operand to wrap - `LOWER(...)`,
   * `NOT (... <=> ...)` - instead of having to fall back to a form that takes none.
   */
  protected resolveOperandField<E>(ctx: QueryContext, entity: Type<E>, key: string, opts: QueryOptions): string {
    const meta = getMeta(entity);
    const field = meta.fields[key];
    return (
      this.inlinedOperand(ctx, field, opts.prefix ?? this.resolveTableAlias(meta), entity) ??
      this.columnWithPrefix(key, field, opts.prefix)
    );
  }

  /**
   * The expression an inlined computed field stands for, or nothing when the field is a real column.
   *
   * Every clause that names such a field needs the expression itself, never the output alias: an
   * alias exists only when the field was also selected, which `$where` and `$sort` cannot assume.
   */
  private inlinedOperand(
    ctx: QueryContext,
    field: FieldMeta | undefined,
    prefix: string | undefined,
    entity: Type<unknown>,
  ) {
    const inlined = field && isInlinedExpression(field) ? field.computed : undefined;
    return inlined ? this.rawFragment(ctx, inlined, prefix, entity) : undefined;
  }

  /** {@link fieldCondition}, appended. */
  compareFieldOperator<E>(
    ctx: QueryContext,
    entity: Type<E>,
    key: FieldKey<E>,
    op: string,
    val: unknown,
    opts: QueryOptions = {},
  ): void {
    ctx.append(this.fieldCondition(ctx, entity, key, op, val, opts));
  }

  /** One operator of a field's condition. Both come from the query as data, so neither is trusted. */
  private fieldCondition<E>(
    ctx: QueryContext,
    entity: Type<E>,
    key: FieldKey<E>,
    op: string,
    val: unknown,
    opts: QueryOptions,
  ): string {
    if (op === '$not') {
      return `NOT (${this.buildFragment(ctx, (fragmentCtx) => this.compare(fragmentCtx, entity, key, val, opts))})`;
    }
    if (op === '$near') {
      return this.vectorNearCondition(ctx, getMeta(entity), key, val as QueryVectorNear, opts.prefix);
    }
    const field = this.resolveOperandField(ctx, entity, key, opts);
    const condition =
      this.operatorCondition(ctx, field, op, val) ?? this.jsonArrayCondition(ctx, { base: field, path: '' }, op, val);
    return orRefuse(condition, `unknown operator: ${op}`);
  }

  /**
   * `<operand> <op> <value>` for every operator that needs only its left-hand SQL, shared by a column, a
   * JSON path, a `HAVING` expression, a count and a distance; `undefined` for the rest. `bind` renders
   * each compared value, a plain placeholder unless a JSON path reads it otherwise.
   */
  protected operatorCondition(
    ctx: QueryContext,
    operand: string,
    op: string,
    val: unknown,
    bind: (value: unknown) => string = (value) => this.addValue(ctx, value),
  ): string | undefined {
    const compareOp = AbstractSqlDialect.COMPARE_OP_MAP.get(op as QueryCompareOp);
    if (compareOp) {
      return `${operand}${compareOp}${bind(val)}`;
    }

    const like = this.likeCondition(ctx, operand, op, val);
    if (like) {
      return like;
    }

    switch (op) {
      case '$eq':
        return val === null ? `${operand} IS NULL` : `${operand} = ${bind(val)}`;
      case '$ne':
        return val === null ? `${operand} IS NOT NULL` : this.neExpr(operand, bind(val));
      case '$regex':
        return this.regexCondition(operand, this.addValue(ctx, val));
      case '$in':
      case '$nin':
        return this.formatIn(ctx, operand, inOperands(op, val), op === '$nin', bind);
      case '$between': {
        const [min, max] = val as [unknown, unknown];
        return `${operand} BETWEEN ${bind(min)} AND ${bind(max)}`;
      }
      case '$isNull':
        return operand + (val ? ' IS NULL' : ' IS NOT NULL');
      case '$isNotNull':
        return operand + (val ? ' IS NOT NULL' : ' IS NULL');
      default:
        return undefined;
    }
  }

  /** `$all`, `$size` and `$elemMatch`, which read the JSON array at `slot`; `undefined` for the rest. */
  private jsonArrayCondition(ctx: QueryContext, slot: JsonSlot, op: string, val: unknown): string | undefined {
    switch (op) {
      case '$all':
        return this.jsonAll(ctx, slot, val as readonly unknown[]);
      case '$size':
        return this.sizeCondition(
          ctx,
          (fragmentCtx) => fragmentCtx.append(this.jsonLength(slot)),
          val as number | QuerySizeComparisonOps,
        );
      case '$elemMatch':
        return this.jsonElemMatch(ctx, slot, val as Record<string, unknown>);
      default:
        return undefined;
    }
  }

  /** A path of a JSON document, read the way each operator reads it. */
  private jsonPathTarget(slot: JsonSlot): JsonTarget {
    return { slot, read: (mode) => this.jsonPathExpr(slot.base, slot.path, mode) };
  }

  /** Every operator `target` is compared with, `AND`-joined. */
  private jsonConditions(ctx: QueryContext, target: JsonTarget, val: unknown): string {
    const value = this.normalizeWhereValue(val);
    return AbstractSqlDialect.conjunction(getKeys(value).map((op) => this.jsonCondition(ctx, target, op, value[op])));
  }

  private jsonCondition(ctx: QueryContext, target: JsonTarget, op: string, value: unknown): string {
    if (op === '$not') {
      return `NOT (${this.jsonConditions(ctx, target, value)})`;
    }
    const array = this.jsonArrayCondition(ctx, target.slot, op, value);
    if (array !== undefined) {
      return array;
    }
    const mode = AbstractSqlDialect.jsonOperatorMode(op, value);
    const operand = target.read(mode);
    // Only a boolean compares as a JSON value, so the set holds two at most, and MySQL documents `IN()`
    // as unsupported on JSON values: the comparisons are spelled out.
    if (mode === 'json' && (op === '$in' || op === '$nin')) {
      const negate = op === '$nin';
      const comparisons = inOperands(op, value).map(
        (val) => `${operand} ${negate ? '<>' : '='} ${this.jsonScalarParam(ctx, val)}`,
      );
      return `(${comparisons.join(negate ? ' AND ' : ' OR ')})`;
    }
    const condition = this.operatorCondition(ctx, operand, op, value, (val) => this.jsonOperand(ctx, val, mode));
    return orRefuse(condition, `unknown operator: ${op}`);
  }

  /**
   * How `op` reads a JSON value: an ordered comparison as a number, an equality as its operand compares,
   * and a pattern or a null check as text.
   */
  private static jsonOperatorMode(op: string, value: unknown): JsonAccessMode {
    if (AbstractSqlDialect.ORDERED_OPS.has(op)) {
      return 'numeric';
    }
    return AbstractSqlDialect.EQUALITY_OPS.has(op) ? jsonCompareMode(value) : 'text';
  }

  /** A bound operand of a JSON comparison, read the way `mode` reads the value it is compared with. */
  private jsonOperand(ctx: QueryContext, value: unknown, mode: JsonAccessMode): string {
    if (mode === 'json') {
      return this.jsonScalarParam(ctx, value);
    }
    const placeholder = this.addValue(ctx, value);
    return mode === 'numeric' ? this.numericCast(placeholder) : placeholder;
  }

  /** The JSON value at `slot`, as an array operator reads it. */
  protected jsonValue(slot: JsonSlot): string {
    return slot.path ? this.jsonPathExpr(slot.base, slot.path, 'json') : slot.base;
  }

  /**
   * `$all`: the JSON array at `slot` has an element holding each value, as Postgres's `@>` and MySQL's
   * `JSON_CONTAINS` read one: a scalar equal, an array each of its elements, an object each of its keys.
   * Plain JSON goes to {@link jsonContains}; an operator anywhere in it is matched element by element.
   */
  private jsonAll(ctx: QueryContext, slot: JsonSlot, values: readonly unknown[]): string {
    return holdsOperator(values) ? this.jsonElemsHold(ctx, slot, values) : this.jsonContains(ctx, slot, values);
  }

  /** `$all` over plain JSON, which an engine with containment of its own spells natively, for an index to serve. */
  protected jsonContains(ctx: QueryContext, slot: JsonSlot, values: readonly unknown[]): string {
    return this.jsonElemsHold(ctx, slot, values);
  }

  /** One `EXISTS` per value, over the elements of the array at `slot`: a scalar equal, anything else held. */
  private jsonElemsHold(ctx: QueryContext, slot: JsonSlot, values: readonly unknown[]): string {
    const alias = ctx.claimAlias(JSON_ELEM_ALIAS);
    const from = this.jsonElemFrom(slot, alias);
    const element: JsonTarget = {
      slot: { base: this.jsonElemDoc(alias), path: '' },
      read: (mode) => this.jsonElemValue(slot, alias, mode),
    };
    const conditions = values.map((value) => {
      const holds =
        isOperatorMap(value) || Array.isArray(value)
          ? this.jsonHolds(ctx, element, value)
          : [this.jsonElemEquals(ctx, slot, alias, value)];
      return jsonElemExists(from, holds, this.jsonElemHint);
    });
    return AbstractSqlDialect.conjunction(conditions);
  }

  /**
   * What the JSON `target` reads satisfies to hold `value`: an array each of its elements, an object each
   * of its keys as a path, and an operator map or a scalar compared as a path is.
   */
  private jsonHolds(ctx: QueryContext, target: JsonTarget, value: unknown): string[] {
    if (Array.isArray(value)) {
      return [this.jsonAll(ctx, target.slot, value)];
    }
    if (!isJsonObject(value)) {
      return [this.jsonConditions(ctx, target, value)];
    }
    const { base, path } = target.slot;
    return Object.entries(value).flatMap(([key, item]) =>
      this.jsonHolds(ctx, this.jsonPathTarget({ base, path: path ? `${path}.${key}` : key }), item),
    );
  }

  /** An element of the array at `slot` equal to `value`, both read as JSON. */
  protected jsonElemEquals(ctx: QueryContext, slot: JsonSlot, alias: string, value: unknown): string {
    return `${this.jsonElemValue(slot, alias, 'json')} = ${this.jsonScalarParam(ctx, value)}`;
  }

  /** The JSON array at `slot` contains at least one of `values`, each as `$all` reads it. */
  protected jsonAny(ctx: QueryContext, slot: JsonSlot, values: readonly unknown[]): string {
    return `(${values.map((value) => this.jsonAll(ctx, slot, [value])).join(' OR ')})`;
  }

  /** How many elements the JSON array at `slot` has, which `$size` compares. */
  protected abstract jsonLength(slot: JsonSlot): string;

  /** Whether the value at `slot` is a JSON array: the array operators match, and `$pull` changes, no other. */
  protected abstract jsonIsArray(slot: JsonSlot): string;

  /** The JSON array at `slot` as one row per element under `alias`, the `FROM` of an `EXISTS`. */
  protected abstract jsonElemFrom(slot: JsonSlot, alias: string): string;

  /** An exploded element as a JSON document, which its fields are paths into. */
  protected abstract jsonElemDoc(alias: string): string;

  /** An element of the array at `slot` itself, read the way `mode` reads a path: its document, or its root. */
  protected jsonElemValue(_slot: JsonSlot, alias: string, mode: JsonAccessMode): string {
    const doc = this.jsonElemDoc(alias);
    return mode === 'json' ? doc : this.jsonPathExpr(doc, '', mode);
  }

  /**
   * `$elemMatch`: an element holds `match`, as `$all` reads one value, its operators testing the element
   * itself. An element equal to one value, or to one of several, is containment whatever the operator
   * says, which compares by JSON type and is what an array index serves.
   */
  protected jsonElemMatch(ctx: QueryContext, slot: JsonSlot, match: Record<string, unknown>): string {
    const keys = Object.keys(match);
    if (keys.some(isOperatorKey) && !keys.every(isOperatorKey)) {
      throw new UqlUsageError(`$elemMatch cannot mix operators with field names: ${keys.join(', ')}`);
    }
    const single = keys.length === 1;
    const { $eq: equal, $in: within } = match;
    if (single && isJsonScalar(equal)) {
      return this.jsonAll(ctx, slot, [equal]);
    }
    if (single && Array.isArray(within) && within.length > 0 && within.every(isJsonScalar)) {
      return this.jsonAny(ctx, slot, within);
    }
    return this.jsonAll(ctx, slot, [match]);
  }

  /** The optimizer hint a `$elemMatch` subquery opens with, where the engine plans one wrong without it. */
  protected readonly jsonElemHint: string = '';

  /**
   * A JSON-encoded bound parameter, cast to the dialect's JSON type. Only the positional-placeholder
   * dialects use this - PostgreSQL binds JSON through {@link PgLikeSqlDialect.jsonScalarParam} instead.
   */
  protected jsonScalarParam(ctx: QueryContext, value: unknown): string {
    if (value instanceof QueryRaw) {
      return this.rawFragment(ctx, value);
    }
    return this.jsonCast(this.addValue(ctx, JSON.stringify(value)));
  }

  /** {@link resolveOperandField}, appended. */
  getComparisonKey<E>(ctx: QueryContext, entity: Type<E>, key: FieldKey<E>, opts: QueryOptions = {}): void {
    ctx.append(this.resolveOperandField(ctx, entity, key, opts));
  }

  /** Appends the `ORDER BY`, reporting whether there was one - which {@link pager} needs on the
   * engines that refuse to page an unordered statement. */
  sort<E>(ctx: QueryContext, entity: Type<E>, q: Query<E>, opts: QuerySortOptions = {}): boolean {
    const terms = this.sortTerms(ctx, getMeta(entity), q, opts);
    if (terms.length) {
      ctx.append(` ORDER BY ${terms.map(({ expr, ...term }) => this.orderByTerm(expr, term)).join(', ')}`);
    }
    return terms.length > 0;
  }

  /**
   * The terms of an `ORDER BY`, collected before anything is appended so an unorderable key is reported
   * instead of half a clause, and because a vector distance is the primary ordering wherever it appears.
   */
  private sortTerms<E>(ctx: QueryContext, meta: EntityMeta<E>, q: Query<E>, opts: QuerySortOptions): SortTerm[] {
    if (!hasKeys(q.$sort)) {
      return [];
    }
    const vectors: SortTerm[] = [];
    const columns: SortTerm[] = [];
    const walk = { ...opts, distinct: q.$distinct, rankText: this.textRanker(meta, q.$where, opts.prefix) };
    this.collectSortTerms(ctx, meta, q.$sort, walk, vectors, columns);
    return [...vectors, ...columns];
  }

  /**
   * Walks `$sort` against the metadata of the entity each level addresses, rather than flattening it
   * to dotted strings and reading every key off the root: only that way does a related column resolve
   * through its own `@Field({ name })`, and only that way is `tax.category` the one alias the join
   * carries instead of two quoted identifiers.
   */
  private collectSortTerms<E>(
    ctx: QueryContext,
    meta: EntityMeta<E>,
    sort: QuerySortMap<E>,
    opts: SortWalk,
    vectors: SortTerm[],
    columns: SortTerm[],
    path = '',
    // Below the first level, the alias of the join the path walked to.
    prefix = opts.prefix,
  ): void {
    for (const [key, value] of Object.entries(sort)) {
      const relation = meta.relations[key as RelationKey<E>];
      const keyPath = path ? `${path}.${key}` : key;
      if (key === '$text') {
        if (path) {
          throw new UqlUsageError(`$sort by $text is only supported on the queried entity, not on relation '${path}'`);
        }
        // Where projected in the SELECT list, ordered by that alias rather than scored twice.
        const { order, project } = textSortOf(sort)!;
        const expr = project ? this.escapeId(project) : this.buildFragment(ctx, opts.rankText);
        columns.push({ key, expr, ...this.resolveSortDirection(order), output: project !== undefined });
        continue;
      }
      if (relation) {
        const { aggregates, rest } = relationSortTerms(key, keyPath, value);
        for (const { spec, direction } of aggregates) {
          // A correlated subquery, not a join: a parent has many of these, so what is being ordered by is
          // one value over them, and `SELECT DISTINCT` cannot order by an expression it did not select.
          const name = `${keyPath}.${spec.field ?? '$count'}`;
          if (opts.distinct) {
            throw new UqlUsageError(`cannot $sort by '${name}' with $distinct: it is not a selected column`);
          }
          const expr = this.buildFragment(ctx, (fragmentCtx) =>
            this.appendRelationAggregate(fragmentCtx, meta.entity, spec, prefix ?? ''),
          );
          if (spec.search) {
            vectors.push({ key: name, expr, output: false });
          } else {
            columns.push({ key: keyPath, expr, ...this.resolveSortDirection(direction), output: false });
          }
        }
        if (rest === undefined) {
          continue;
        }
        const { join, sort: relationSort } = resolveSortableJoin(
          relation,
          keyPath,
          rest,
          opts.joins ?? NO_JOINS,
          `cannot $sort by relation '${keyPath}': this statement joins no relations`,
        );
        // `SELECT DISTINCT` can only order by what it selected, on every engine here, so a join
        // brought in for the sort alone has nothing to order by. Populating it selects its columns.
        if (opts.distinct && !join.projected) {
          throw new UqlUsageError(
            `cannot $sort by relation '${keyPath}' with $distinct unless '${keyPath}' is populated: SELECT DISTINCT orders only by selected columns`,
          );
        }
        this.collectSortTerms(ctx, join.meta, relationSort, opts, vectors, columns, keyPath, join.alias);
        continue;
      }
      if (isVectorSearch(value)) {
        // Already projected in the SELECT list: order by that alias rather than recomputing it.
        vectors.push(
          value.$project
            ? { key: keyPath, expr: this.escapeId(value.$project), output: true }
            : {
                key: keyPath,
                expr: this.buildFragment(ctx, (fragmentCtx) =>
                  this.appendVectorDistance(fragmentCtx, meta, key, value, prefix),
                ),
                output: false,
              },
        );
        continue;
      }
      const order = this.resolveSortDirection(value);
      // A JSON path can sort by more than one reading, each carried under a name of its own.
      this.sortColumns(ctx, meta, key, prefix).forEach((column, index) => {
        columns.push({ key: index ? `${keyPath}:${index}` : keyPath, ...column, ...order });
      });
    }
  }

  /**
   * The `ORDER BY` operands for one key: a JSON path's in each of {@link jsonSortModes}. A key that is
   * not a field of `meta` - a `raw()` projection, a `$select` alias - is an output alias, which is never
   * table-qualified and needs no resolving.
   */
  private sortColumns<E>(
    ctx: QueryContext,
    meta: EntityMeta<E>,
    key: string,
    prefix: string | undefined,
  ): Pick<SortTerm, 'expr' | 'output'>[] {
    const field = meta.fields[key as FieldKey<E>];
    if (field) {
      const expr =
        this.inlinedOperand(ctx, field, prefix ?? this.resolveTableAlias(meta), meta.entity) ??
        this.columnWithPrefix(key, field, prefix);
      return [{ expr, output: false }];
    }
    const json = this.resolveJsonDotPath(meta, key, prefix);
    if (!json) {
      return [{ expr: this.escapeId(key), output: true }];
    }
    return this.jsonSortModes.map((mode) => ({
      expr: this.jsonPathExpr(json.base, json.path, mode),
      output: false,
    }));
  }

  /**
   * How a JSON path is sorted by: as the JSON value, which the engine orders by type and a number by its
   * value. An engine that orders JSON as text reads a number first, then the text.
   */
  protected readonly jsonSortModes: readonly JsonAccessMode[] = ['json'];

  /**
   * `LIMIT`/`OFFSET`. `sorted` says whether an `ORDER BY` was emitted just before, which
   * {@link MergeSqlDialect} needs: SQL Server refuses to page a statement that has none.
   */
  pager(ctx: QueryContext, opts: QueryPager, _sorted = false): void {
    // `!== undefined`, not truthiness: `$limit: 0` asks for no rows, where "unset" means every row.
    if (opts.$limit !== undefined) {
      ctx.append(` LIMIT ${assertNonNegativeInteger(opts.$limit, '$limit')}`);
    }
    if (opts.$skip !== undefined) {
      ctx.append(` OFFSET ${assertNonNegativeInteger(opts.$skip, '$skip')}`);
    }
  }

  /** The engine's own refusal first, then what a lock over a join needs, which is SQL's alone. */
  override assertLockSupported<E>(entity: Type<E>, q: Query<E>, joins?: QueryJoins): void {
    super.assertLockSupported(entity, q);
    const { rowLocks } = this.features;
    if (!rowLocks || rowLocks.of || !parseQueryLock(q.$lock)) {
      return;
    }
    joins ??= resolveQueryJoins(getMeta(entity), q);
    if (joins.size > 0) {
      throw new UqlUsageError(
        `${this.dialectName} cannot narrow a row lock to one table, so $lock cannot be combined with a joined relation`,
      );
    }
  }

  /**
   * The lock as a hint on the table itself, which a `'tableHint'` dialect states instead of the
   * trailing clause {@link appendLock} emits. Empty everywhere else: `rowLocks.placement` is what
   * decides which end of the statement spells the lock, so the two can never both emit.
   */
  protected lockHint<E>(_q: Query<E>): string {
    return '';
  }

  /**
   * The trailing `FOR UPDATE`. Narrowing to the queried table is not a nicety once a relation is
   * joined: Postgres refuses a bare `FOR UPDATE` over the nullable side of an outer join outright,
   * and the other engines quietly widen the lock to the joined rows.
   */
  protected appendLock<E>(ctx: QueryContext, entity: Type<E>, q: Query<E>, joins = NO_JOINS, alias?: string): void {
    const wait = parseQueryLock(q.$lock);
    if (!wait) {
      return;
    }
    this.assertLockSupported(entity, q, joins);
    const { rowLocks } = this.features;
    if (rowLocks && rowLocks.placement === 'tableHint') {
      return;
    }
    const meta = getMeta(entity);
    // `OF` names the alias in the FROM, never the schema-qualified path it was aliased from.
    const target = joins.size > 0 ? ` OF ${this.escapeId(alias ?? this.resolveTableAlias(meta), true)}` : '';
    const suffix = wait === 'skip' ? ' SKIP LOCKED' : wait === 'nowait' ? ' NOWAIT' : '';
    ctx.append(` FOR UPDATE${target}${suffix}`);
  }

  /**
   * `COUNT(*)` over the filter, or over the rows a page settles. The clauses are read off `q` one by one:
   * `/http` hands it over untyped, and a smuggled `$sort` changes no count.
   */
  count<E>(ctx: QueryContext, entity: Type<E>, q: QueryPage<E>, opts?: QueryOptions): void {
    const { $where, $skip, $limit } = q;
    if ($skip === undefined && $limit === undefined) {
      this.select<E>(ctx, entity, { $select: [raw`COUNT(*)`.as(AGGREGATE_VALUE_ALIAS)] });
      this.search(ctx, entity, { $where }, opts);
      return;
    }
    const page = idOnlyQuery(getMeta(entity), { $where, $skip, $limit });
    this.countRows(ctx, () => this.find(ctx, entity, page, opts));
  }

  /**
   * How many rows a `$distinct` read returns: the deduplication runs after `COUNT(*)` and a window
   * alike, so the deduplicated set is counted as a derived table, never paged.
   */
  countDistinct<E>(ctx: QueryContext, entity: Type<E>, q: Query<E>, opts?: QueryOptions): void {
    const read = this.readOptions(ctx, getMeta(entity), opts);
    this.countRows(ctx, () => {
      this.select(ctx, entity, q, read);
      this.search(ctx, entity, { $where: q.$where }, read);
    });
  }

  /** `SELECT COUNT(*)` over the rows `rows` appends, as a derived table. */
  private countRows(ctx: QueryContext, rows: () => void): void {
    ctx.append(`SELECT COUNT(*) ${this.escapeId(AGGREGATE_VALUE_ALIAS, true)} FROM (`);
    rows();
    ctx.append(`) ${this.escapeId(ROWS_ALIAS, true)}`);
  }

  /**
   * The statistic the engine already keeps, as a `count` column. Overridden by the dialects that
   * keep one; the rest throw, because falling back to `COUNT(*)` would run exactly the scan the
   * caller reached for this to avoid, and only say so by taking a long time.
   */
  estimatedCount<E>(_ctx: QueryContext, _entity: Type<E>): void {
    throw new UqlUsageError(`${this.dialectName} does not support estimatedCount`);
  }

  /** `$group` aggregate operator to SQL function name, over ops `resolveAggregateOp` has already allowlisted. */
  private static readonly AGGREGATE_FN: Readonly<Record<QueryAggregateOp, string>> = {
    $count: 'COUNT',
    $sum: 'SUM',
    $avg: 'AVG',
    $min: 'MIN',
    $max: 'MAX',
  };

  aggregate<E, G extends QueryGroupMap<E>, A extends QueryAggMap<E>>(
    ctx: QueryContext,
    entity: Type<E>,
    q: QueryAggregate<E, G, A>,
    opts: QueryOptions = {},
  ): void {
    const meta = getMeta(entity);
    const entries = parseGroupMap(q.$group, q.$select);
    if (!entries.length) {
      throw new UqlUsageError('aggregate requires at least one $group column or $select function');
    }
    const table = this.tableRef(meta, this.readOptions(ctx, meta).alias);
    const { joins, where } = resolveGroupJoins(meta, q, (path) => ctx.claimAlias(path));
    const prefix = joins.size ? table.alias : undefined;
    const reads = entries.map((entry) => ({ entry, value: this.aggregateValue(ctx, entity, entry, joins, prefix) }));
    // Only bare columns are read inline: SQL Server refuses a subquery inside an aggregate or a
    // `GROUP BY`, and a filter's bound values would repeat in `HAVING`. A derived table answers by alias.
    const derived = reads.some(({ value }) => !value.bare);
    const named = (sql: string, alias: string) =>
      sql === this.escapeId(alias) ? sql : `${sql} ${this.escapeId(alias)}`;
    const groupKeys: string[] = [];
    const selectParts: string[] = [];
    // Every column the statement emits, mapped to the SQL that references it. `$having` and `$sort`
    // may name these and nothing else, so one map answers both "is this legal?" and "what do I
    // emit for it?".
    const emittedColumns: Record<string, string> = {};

    for (const { entry, value } of reads) {
      const column = derived ? this.escapeId(entry.alias) : value.sql;
      const expr =
        entry.kind === 'key' ? column : this.aggregateFn(entry.op, value.sql === '*' ? '*' : column, entry.distinct);
      if (entry.kind === 'key') {
        groupKeys.push(expr);
      }
      emittedColumns[entry.alias] = expr;
      selectParts.push(named(expr, entry.alias));
    }

    const columns = reads.flatMap(({ entry, value }) => (value.sql === '*' ? [] : [named(value.sql, entry.alias)]));
    ctx.append(
      `SELECT ${selectParts.join(', ')} FROM ${derived ? `(SELECT ${columns.join(', ')} FROM ` : ''}${table.ref}`,
    );
    this.selectRelationJoins(ctx, meta, table.alias, joins);
    this.where<E>(ctx, entity, where, { ...opts, prefix });
    if (derived) {
      ctx.append(`) ${this.escapeId(ROWS_ALIAS, true)}`);
    }

    if (groupKeys.length) {
      ctx.append(` GROUP BY ${groupKeys.join(', ')}`);
    }

    if (q.$having) {
      this.having(ctx, q.$having, emittedColumns);
    }

    const sorted = this.aggregateSort(ctx, q.$sort, emittedColumns);
    this.pager(ctx, q, sorted);
  }

  /**
   * What one entry reads: a grouped field, through the join its path passes, or an aggregate's argument,
   * narrowed by its own `$where` to `CASE WHEN … THEN … END`. Bare where it is a column or `'*'`.
   */
  private aggregateValue<E>(
    ctx: QueryContext,
    entity: Type<E>,
    entry: ParsedGroupEntry<E>,
    joins: QueryJoins,
    prefix: string | undefined,
  ): AggregateValue {
    if (entry.kind === 'key') {
      const { key, join } = groupPathField(joins, entry.path);
      return join
        ? this.aggregateOperand(ctx, join.entity, key, join.alias)
        : this.aggregateOperand(ctx, entity, key, prefix);
    }
    const arg = entry.field === undefined ? undefined : this.aggregateOperand(ctx, entity, entry.field, prefix);
    const { where } = entry;
    const condition =
      where &&
      this.buildFragment(ctx, (fragment) => this.renderWhere(fragment, entity, where, { clause: false, prefix }));
    if (!condition) {
      return arg ?? { sql: '*', bare: true };
    }
    return { sql: `CASE WHEN ${condition} THEN ${arg?.sql ?? '1'} END`, bare: false };
  }

  /** A field as an aggregate reads it: its column, or the expression an inlined one stands for. */
  private aggregateOperand<E>(
    ctx: QueryContext,
    entity: Type<E>,
    key: string,
    prefix: string | undefined,
  ): AggregateValue {
    const field = getMeta(entity).fields[key];
    return {
      sql: this.resolveOperandField(ctx, entity, key, { prefix }),
      bare: field === undefined || !isInlinedExpression(field),
    };
  }

  /**
   * ORDER BY for aggregate queries - handles both entity-field and alias references. A grouped
   * statement has no joins to address, so a relation key is rejected rather than emitted as an alias
   * nothing defines.
   */
  private aggregateSort(
    ctx: QueryContext,
    sort: QuerySortMap<object> | undefined,
    emittedColumns: Record<string, string>,
  ): boolean {
    if (!hasKeys(sort)) return false;

    ctx.append(' ORDER BY ');
    Object.entries(sort).forEach(([key, dir], index) => {
      if (index > 0) ctx.append(', ');
      ctx.append(this.orderByTerm(this.aggregateRef(emittedColumns, key, '$sort'), this.resolveSortDirection(dir)));
    });
    return true;
  }

  /** The SQL referencing one of an aggregate's emitted columns, rejecting any other name. */
  private aggregateRef(emittedColumns: Record<string, string>, key: string, clause: string): string {
    return emittedColumns[key] ?? throwUnknownAggregateColumn(key, clause);
  }

  protected having(ctx: QueryContext, having: QueryHavingMap, emittedColumns: Record<string, string>): void {
    const entries = Object.entries(having).filter(([, v]) => v !== undefined);
    if (!entries.length) return;

    ctx.append(' HAVING ');
    entries.forEach(([alias, condition], index) => {
      if (index > 0) ctx.append(' AND ');
      // A HAVING may only name a column the statement emits. Falling back to the bare key produced
      // `HAVING "status" = ?` over an ungrouped column, which every engine rejects.
      this.havingCondition(ctx, this.aggregateRef(emittedColumns, alias, '$having'), condition);
    });
  }

  private static readonly SORT_DIRECTION_MAP = new Map<QuerySortDirection, SortOrder>([
    [1, {}],
    ['asc', {}],
    ['desc', { direction: ' DESC' }],
    [-1, { direction: ' DESC' }],
    ['ascNullsFirst', { nulls: 'first' }],
    ['ascNullsLast', { nulls: 'last' }],
    ['descNullsFirst', { direction: ' DESC', nulls: 'first' }],
    ['descNullsLast', { direction: ' DESC', nulls: 'last' }],
  ]);

  private resolveSortDirection(sort: unknown): SortOrder {
    const order = AbstractSqlDialect.SORT_DIRECTION_MAP.get(sort as QuerySortDirection);
    return orRefuse(order, `unknown sort direction: ${sort}`);
  }

  /**
   * One `ORDER BY` term. A placement the engine has no `NULLS FIRST/LAST` for becomes a term of its
   * own in front of it, which is why one is only ever emitted where the caller asked for it: no index
   * serves an expression. SQL Server needs a `CASE`, having no orderable boolean.
   */
  protected orderByTerm(expr: string, { direction = '', nulls }: SortOrder): string {
    if (!nulls) {
      return expr + direction;
    }
    const first = nulls === 'first';
    if (this.features.nullsOrdering === 'clause') {
      return `${expr}${direction} NULLS ${first ? 'FIRST' : 'LAST'}`;
    }
    const lead =
      this.features.nullsOrdering === 'case'
        ? `CASE WHEN ${expr} IS NULL THEN ${first ? 0 : 1} ELSE ${first ? 1 : 0} END`
        : `${expr} IS ${first ? 'NOT NULL' : 'NULL'}`;
    return `${lead}, ${expr}${direction}`;
  }

  /** Every operator of one `HAVING` condition, `AND`-joined. */
  protected havingCondition(ctx: QueryContext, expr: string, condition: QueryHavingMap[string]): void {
    const ops = this.normalizeWhereValue(condition);
    const parts = getKeys(ops).map((op) =>
      orRefuse(this.operatorCondition(ctx, expr, op, ops[op]), `unsupported HAVING operator: ${op}`),
    );
    ctx.append(parts.join(' AND '));
  }

  /**
   * How many rows the filter matched, on every row of the page. A window function runs before
   * LIMIT/OFFSET, so what it counts is the whole match rather than the page cut out of it.
   */
  protected readonly totalOverExpr = 'COUNT(*) OVER ()';

  find<E>(ctx: QueryContext, entity: Type<E>, q: Query<E> = {}, opts?: QueryOptions, totalAlias?: string): void {
    const meta = getMeta(entity);
    const read = this.readOptions(ctx, meta, opts);
    // The one statement that can join, so the one that resolves the join set; everything else renders
    // against `NO_JOINS` and rejects a `$sort` that would need one. The joins claim their aliases after
    // the table's own.
    this.read(
      ctx,
      entity,
      q,
      read,
      resolveQueryJoins(meta, q, (path) => ctx.claimAlias(path)),
      totalAlias,
    );
  }

  /**
   * A read's whole statement. The lock is appended here rather than in `search`, which `count`,
   * `update` and `delete` share: it belongs to a SELECT alone, and every engine spells it last.
   */
  protected read<E>(
    ctx: QueryContext,
    entity: Type<E>,
    q: Query<E>,
    opts: ReadOptions,
    joins: QueryJoins,
    totalAlias?: string,
  ): ReadProjection {
    const projection = this.select(ctx, entity, q, opts, joins, totalAlias);
    this.search(ctx, entity, q, opts, joins, projection.order);
    this.appendLock(ctx, entity, q, joins, opts.alias);
    return projection;
  }

  /**
   * `opts` with the alias the read's table claims: its own name, which needs no alias written, unless
   * another table of the statement took it first.
   */
  private readOptions<E>(ctx: QueryContext, meta: EntityMeta<E>, opts: ReadOptions = {}): ReadOptions {
    if (opts.alias !== undefined) {
      return opts;
    }
    const name = this.resolveTableAlias(meta);
    const alias = ctx.claimAlias(name);
    return alias === name ? opts : { ...opts, alias };
  }

  insert<E>(ctx: QueryContext, entity: Type<E>, payload: E | E[], opts?: QueryOptions): void {
    // Every engine whose ids come back from the statement itself wants the same clause, so it is
    // built once here instead of in an identical `insert` override per dialect. `returningId` is
    // empty on a composite key, which has no id to ask for.
    const returning = this.insertIdSource === 'returning' ? this.returningId(getMeta(entity)) : '';

    if (returning && this.returningPosition === 'after-target') {
      this.appendInsertValues(ctx, entity, payload, returning);
      return;
    }
    this.appendInsertValues(ctx, entity, payload);
    if (returning) {
      ctx.append(` ${returning}`);
    }
  }

  /**
   * What a text search matches and a fulltext index covers, which have to agree for the index to serve the
   * search: the columns themselves, where the engine indexes them as they are (MySQL's `MATCH (a, b)`).
   */
  textSearchTarget(columns: readonly string[], _config?: string): string {
    return columns.join(', ');
  }

  /** Where an insert's id clause goes: `RETURNING` at the end, or SQL Server's `OUTPUT` before `VALUES`. */
  readonly returningPosition: 'suffix' | 'after-target' = 'suffix';

  /**
   * `INSERT INTO ... VALUES (...)` and nothing more. The upsert builders extend this rather than
   * {@link insert}: their own clause has to come before the `RETURNING`, not after it.
   */
  protected appendInsertValues<E>(
    ctx: QueryContext,
    entity: Type<E>,
    payload: E | E[],
    /** Spliced between the column list and `VALUES`; see {@link returningPosition}. */
    afterTarget = '',
  ): void {
    const shape = this.insertShape(entity, payload);
    const tableName = this.escapedTableName(getMeta(entity));
    ctx.append(`INSERT INTO ${tableName} (${shape.columns.join(', ')})${afterTarget ? ` ${afterTarget}` : ''} VALUES `);
    this.appendValueRows(ctx, shape);
  }

  /** The columns an insert writes and the rows it writes, resolved once, and shared with a `MERGE`'s row source. */
  protected insertShape<E>(entity: Type<E>, payload: E | E[]): InsertShape<E> {
    const meta = getMeta(entity);
    const payloads = fillOnFields(meta, payload, 'onInsert');
    const keys = getInsertFieldKeys(meta, payloads);

    // Resolve each key's field and escaped column once, then index into them: re-reading
    // `meta.fields[key]` per record cost 40 redundant lookups on a 10-row, 4-column insert.
    const width = keys.length;
    const fields: (FieldOptions | undefined)[] = new Array(width);
    const columns: string[] = new Array(width);
    const kinds: PersistKind[] = new Array(width);
    for (let i = 0; i < width; i++) {
      const key = keys[i];
      const field = meta.fields[key];
      fields[i] = field;
      columns[i] = this.escapedColumnName(meta, key);
      kinds[i] = this.persistKind(field);
    }
    return { meta, payloads, keys, fields, columns, kinds };
  }

  /** `(a, b), (c, d)` - the row constructor an INSERT and a MERGE source both write. */
  protected appendValueRows<E>(ctx: QueryContext, { payloads, keys, fields, kinds }: InsertShape<E>): void {
    const width = keys.length;
    for (let r = 0; r < payloads.length; r++) {
      ctx.append(r > 0 ? '), (' : '(');
      const record = payloads[r];
      for (let i = 0; i < width; i++) {
        if (i > 0) {
          ctx.append(', ');
        }
        const value = record[keys[i]];
        if (value === undefined) {
          this.appendDefaultInsertValue(ctx, fields[i]);
        } else if (kinds[i] === 'plain') {
          // The overwhelmingly common case in a bulk insert, so it binds without a dispatch.
          ctx.addValue(value);
        } else {
          this.writePersistableValue(ctx, kinds[i], fields[i], value);
        }
      }
    }
    ctx.append(')');
  }

  /**
   * Emit the value for a column a payload record does not provide (the column list is the union
   * across all records). `DEFAULT` delegates to the database default; SQLite overrides this since
   * it does not support the `DEFAULT` keyword inside `VALUES`.
   */
  protected appendDefaultInsertValue(ctx: QueryContext, _field: FieldOptions | undefined): void {
    ctx.append('DEFAULT');
  }

  update<E>(
    ctx: QueryContext,
    entity: Type<E>,
    q: QuerySearch<E>,
    payload: UpdatePayload<E>,
    opts?: QueryOptions,
  ): void {
    const meta = getMeta(entity);
    const [filledPayload] = fillOnFields(meta, payload as E, 'onUpdate');
    const keys = filterFieldKeys(meta, filledPayload, 'onUpdate');

    const tableName = this.escapedTableName(meta);
    ctx.append(`UPDATE ${tableName} SET `);
    for (let i = 0; i < keys.length; i++) {
      if (i > 0) {
        ctx.append(', ');
      }
      const key = keys[i];
      const field = meta.fields[key];
      const escapedCol = this.escapedColumnName(meta, key);
      const value = filledPayload[key];

      if (isJsonUpdateOp(value)) {
        this.formatJsonUpdate(ctx, escapedCol, value, field);
      } else if (isFieldUpdateOp(value)) {
        const [op, operand] = fieldUpdateOf(key, value);
        ctx.append(`${escapedCol} = COALESCE(${escapedCol}, 0) ${SQL_ARITHMETIC[op]} `);
        ctx.addValue(operand);
      } else {
        ctx.append(`${escapedCol} = `);
        this.formatPersistableValue(ctx, field, value);
      }
    }

    this.search(ctx, entity, q, opts);
  }

  /**
   * `INSERT ... ON CONFLICT ... DO UPDATE/NOTHING RETURNING`. The assignments are built before the insert
   * fills `onInsert` columns, which must stay out of them, and their values bound after it, where a `?` reads them.
   */
  upsert<E>(
    ctx: QueryContext,
    entity: Type<E>,
    conflictPaths: QueryConflictPaths<E>,
    payload: E | E[],
    /** One more `RETURNING` item, as a bare expression: this joins the list and adds the keyword. */
    extraReturning = '',
  ): void {
    const meta = getMeta(entity);
    const updateCtx = this.upsertUpdateBindsInPlace ? ctx : this.createContext();
    const update = this.getUpsertUpdateAssignments(updateCtx, meta, conflictPaths, payload, this.upsertExcluded);
    const keys = this.getUpsertConflictPathsStr(meta, conflictPaths);
    const onConflict = update ? `DO UPDATE SET ${update}` : 'DO NOTHING';
    // Composed rather than concatenated: a composite key contributes no id item, and a dialect's own
    // item (Postgres's `_created`) still has to be the *first* thing after the keyword when it is.
    const returning = [this.returningIdExpression(meta), extraReturning].filter(Boolean).join(', ');
    this.appendInsertValues(ctx, entity, payload);
    ctx.append(` ON CONFLICT (${keys}) ${onConflict}${returning ? ` RETURNING ${returning}` : ''}`);
    if (updateCtx !== ctx) {
      ctx.pushValue(...updateCtx.values);
    }
  }

  /** Whether the upsert's assignments bind straight into the statement, as numbered `$n` placeholders can. */
  protected readonly upsertUpdateBindsInPlace: boolean = false;

  /** How an `ON CONFLICT` assignment reads the row that was being inserted. */
  protected readonly upsertExcluded = (columnName: string): string => `EXCLUDED.${columnName}`;

  protected getUpsertUpdateAssignments<E>(
    ctx: QueryContext,
    meta: EntityMeta<E>,
    conflictPaths: QueryConflictPaths<E>,
    payload: E | E[],
    callback: (columnName: string) => string,
  ): string {
    const sample = Array.isArray(payload) ? payload[0] : payload;
    const cloned = { ...sample };
    const [filledPayload] = fillOnFields(meta, cloned, 'onUpdate');
    const fields = filterFieldKeys(meta, filledPayload, 'onUpdate');
    return fields
      .filter((col) => !conflictPaths[col])
      .map((col) => {
        const field = meta.fields[col];
        const columnName = this.resolveColumnName(col, field);
        if (Object.hasOwn(sample as object, col)) {
          return `${this.escapeId(columnName)} = ${callback(this.escapeId(columnName))}`;
        }
        const text = this.buildFragment(ctx, (fragmentCtx) =>
          this.formatPersistableValue(fragmentCtx, field, filledPayload[col]),
        );
        return `${this.escapeId(columnName)} = ${text}`;
      })
      .join(', ');
  }

  protected getUpsertConflictPathsStr<E>(meta: EntityMeta<E>, conflictPaths: QueryConflictPaths<E>): string {
    return getKeys(conflictPaths)
      .map((key) => {
        const field = meta.fields[key];
        const columnName = this.resolveColumnName(key, field);
        return this.escapeId(columnName);
      })
      .join(', ');
  }

  delete<E>(ctx: QueryContext, entity: Type<E>, q: QuerySearch<E>, opts: QueryOptions = {}): void {
    const meta = getMeta(entity);
    const tableName = this.escapedTableName(meta);

    // Soft-delete (stamp only live rows) unless `hardDelete` is requested or the entity has no
    // soft-delete field (e.g. a cascade onto a non-soft-deletable child).
    if (!opts.hardDelete && meta.softDelete) {
      const field = fieldOf(meta, meta.softDelete);
      const columnName = this.resolveColumnName(meta.softDelete, field);
      ctx.append(`UPDATE ${tableName} SET ${this.escapeId(columnName)} = `);
      this.formatPersistableValue(ctx, field, getSoftDeleteValue(field));
      this.search(ctx, entity, q, opts);
      return;
    }

    // Hard delete removes matching rows regardless of soft-delete state (keeps other filters, e.g. tenant).
    // Only rewrite the filters when there is a soft-delete filter to disable.
    ctx.append(`DELETE FROM ${tableName}`);
    this.search(ctx, entity, q, meta.softDelete ? { ...opts, filters: withoutSoftDeleteFilter(opts.filters) } : opts);
  }

  escapeId(val: string | undefined, forbidQualified?: boolean, addDot?: boolean): string {
    return escapeSqlId(val, this.escapeIdChar, forbidQualified, addDot);
  }

  /**
   * A name behind its schema, each part escaped on its own rather than as one dotted string taken
   * apart again by {@link escapeId}. Tables and their indexes both use it, since an index lives in
   * the schema of the table it is on.
   */
  escapeQualifiedId(name: string, schema: string | undefined): string {
    const escaped = this.escapeId(name, true);
    return schema ? `${this.escapeId(schema, true)}.${escaped}` : escaped;
  }

  /**
   * Bind one persisted value, classifying its column on the spot. Dialects override
   * {@link appendJsonValue} and {@link appendVectorValue} rather than this, so the chain runs once per
   * value - overriding this and delegating back to `super` ran every check twice, measurably slowing
   * every INSERT/UPDATE.
   */
  protected formatPersistableValue(ctx: QueryContext, field: FieldOptions | undefined, value: unknown): void {
    this.writePersistableValue(ctx, this.persistKind(field), field, value);
  }

  /** How a column's values are written: a function of the column, so a bulk insert classifies each once. */
  protected persistKind(field: FieldOptions | undefined): PersistKind {
    const family = columnFamily(field?.type);
    return family === 'json' || family === 'vector' ? family : 'plain';
  }

  /**
   * The columns a read decodes, and how, cached per entity and revision. They are the ones the wire cannot
   * decide alone: a boolean stored as an integer, a decimal read as text, a `BigInt`, and a related row's
   * values, which cross JSON as text.
   */
  hydratableFields<E>(entity: Type<E>): readonly HydratableField[] {
    const meta = getMeta(entity);
    const cached = this.hydratable.get(entity as Type<object>);
    // Against the revision, not merely present: a field added to an entity already read - a content
    // type the admin extended - would otherwise decode by the list its columns are missing from.
    if (cached?.[0] === meta.revision) {
      return cached[1];
    }
    const decoded: HydratableField[] = [];
    for (const [key, field] of Object.entries(meta.fields)) {
      const kind = this.fieldKind(meta, field);
      if (kind) {
        decoded.push([key, kind]);
      }
    }
    this.hydratable.set(entity as Type<object>, [meta.revision, decoded]);
    return decoded;
  }

  /** The same for an aggregate's row, per query: each alias decodes by {@link aggregateKind}. */
  hydratableAggregates<E, G extends QueryGroupMap<E>, A extends QueryAggMap<E>>(
    entity: Type<E>,
    q: QueryAggregate<E, G, A>,
  ): readonly HydratableField[] {
    const meta = getMeta(entity);
    const { joins } = resolveGroupJoins(meta, q);
    const decoded: HydratableField[] = [];
    for (const entry of parseGroupMap(q.$group, q.$select)) {
      const source = aggregateColumnField(meta, joins, entry);
      const kind = !source
        ? 'number'
        : source.join
          ? this.fieldKind(source.join.meta, source.field)
          : this.fieldKind(meta, source.field);
      if (kind) {
        decoded.push([entry.alias, kind]);
      }
    }
    return decoded;
  }

  /**
   * What an aggregate's value decodes as, which the engine widens beyond the column it read: a tally
   * (`COUNT` to Postgres's `bigint`) and a mean (`AVG` to `numeric`) are numbers whatever they counted,
   * and the rest read as the column they aggregate - so a `SUM` over a wide integer stays exact rather
   * than rounding through a float, which is what every driver's BIGINT decoding promises.
   *
   * One rule for both readers: a relation aggregate a field declares, and an aggregate a query names.
   */
  private aggregateKind(op: QueryAggregateOp, fieldKind: HydrateKind | undefined): HydrateKind | undefined {
    return op === '$count' || op === '$avg' ? 'number' : fieldKind;
  }

  /** What a field decodes as: its column's kind, or a relation aggregate's {@link aggregateKind} over the target's column. */
  private fieldKind<E>(meta: EntityMeta<E>, field: FieldMeta | undefined): HydrateKind | undefined {
    const spec = aggregateOf(field);
    if (!spec) {
      return this.hydrateKind(field);
    }
    const target = getMeta(relationOf(meta, spec.relation as RelationKey<E>).entity());
    return this.aggregateKind(spec.op, spec.field ? this.fieldKind(target, target.fields[spec.field]) : undefined);
  }

  /** What one column decodes as, the inverse of {@link persistKind}. `BigInt` first, since it shares the numeric family. */
  protected hydrateKind(field: FieldOptions | undefined): HydrateKind | undefined {
    const type = field?.type;
    if (type === BigInt) {
      return 'bigint';
    }
    switch (columnFamily(type)) {
      case 'json':
        return 'json';
      case 'vector':
        return this.features.vectorBytes ? 'float32' : this.supportedVectorType(resolveVectorCast(field));
      case 'boolean':
        return 'boolean';
      case 'numeric':
        return 'number';
      case 'date':
        return 'date';
      case 'blob':
        return 'bytes';
      default:
        return undefined;
    }
  }

  private readonly hydratable = new WeakMap<
    Type<object>,
    readonly [revision: number, fields: readonly HydratableField[]]
  >();

  /** The one type dispatch for a persisted value, over a column kind decided by the caller. */
  private writePersistableValue(
    ctx: QueryContext,
    kind: PersistKind,
    field: FieldOptions | undefined,
    value: unknown,
  ): void {
    if (value instanceof QueryRaw) {
      this.getRawValue(ctx, { value });
      return;
    }
    if (kind === 'json') {
      this.appendJsonValue(ctx, value, field?.type as JsonColumnType);
      return;
    }
    if (kind === 'vector' && Array.isArray(value)) {
      this.appendVectorValue(ctx, value, field);
      return;
    }
    ctx.addValue(value);
  }

  protected appendJsonValue(ctx: QueryContext, value: unknown, _type: JsonColumnType): void {
    ctx.addValue(value == null ? null : JSON.stringify(value));
  }

  /**
   * Reads `operand` as a JSON value. Passing the `?` placeholder yields the cast for a bound
   * parameter, and passing an expression re-reads text as JSON - the same SQL either way, which is
   * why this is one hook rather than a placeholder variant plus an expression variant.
   */
  protected jsonCast(operand: string): string {
    return `CAST(${operand} AS JSON)`;
  }

  /**
   * `"col" = <expr>` for a JSON update, each operator wrapping the last: `$pull`, `$set`, `$push`, `$unset`.
   * `$pull` reads the column and every later one its expression once, so no value binds twice.
   */
  protected formatJsonUpdate(ctx: QueryContext, escapedCol: string, value: JsonUpdateOp, field?: FieldOptions): void {
    const { $pull, $set, $push, $unset } = value;
    let expr = escapedCol;
    if (hasKeys($pull)) {
      expr = this.jsonPull(ctx, expr, escapedCol, $pull);
    }
    if (hasKeys($set)) {
      expr = this.jsonSet(ctx, expr, $set, field);
    }
    if (hasKeys($push)) {
      expr = this.jsonPush(ctx, expr, $push);
    }
    if ($unset?.length) {
      expr = this.jsonUnset(ctx, expr, $unset);
    }
    ctx.append(`${escapedCol} = ${expr}`);
  }

  /**
   * Remove every element equal to the given value, per array key. Each key wraps the expression
   * built so far, so dialects only supply {@link jsonPullKey} - and because every key reads
   * `escapedCol` rather than the accumulated expression, values bind once, in key order.
   */
  protected jsonPull(ctx: QueryContext, expr: string, escapedCol: string, pull: Record<string, unknown>): string {
    return Object.entries(pull).reduce((acc, [key, value]) => this.jsonPullKey(ctx, acc, escapedCol, key, value), expr);
  }

  /**
   * Wrap `expr` so the array at `key` no longer contains `value`: the array rebuilt from the elements that
   * differ from it, and any other value put back as it is. `JSON_REPLACE` leaves an absent key, and a NULL
   * column, untouched.
   */
  protected jsonPullKey(ctx: QueryContext, expr: string, escapedCol: string, key: string, value: unknown): string {
    const slot = { base: escapedCol, path: key };
    const elem = this.jsonElemValue(slot, JSON_PULL_ALIAS, 'json');
    const differs = this.jsonDiffers(elem, this.jsonScalarParam(ctx, value));
    const kept = `SELECT ${this.jsonArrayOf(elem)} FROM ${this.jsonElemFrom(slot, JSON_PULL_ALIAS)} WHERE ${differs}`;
    const pulled = `CASE WHEN ${this.jsonIsArray(slot)} THEN (${kept}) ELSE ${this.jsonValue(slot)} END`;
    return `JSON_REPLACE(${expr}, ${jsonPath(key)}, ${pulled})`;
  }

  /** The elements a `$pull` keeps, back in one array, and an empty one where it keeps none. */
  protected jsonArrayOf(elem: string): string {
    return `COALESCE(JSON_ARRAYAGG(${elem}), JSON_ARRAY())`;
  }

  /** Whether an element is not the pulled value, both read as JSON. */
  protected jsonDiffers(elem: string, operand: string): string {
    return `${elem} <> ${operand}`;
  }

  /** Shallow assignment of top-level keys, matching PostgreSQL's `jsonb || jsonb`. */
  protected abstract jsonSet(
    ctx: QueryContext,
    expr: string,
    set: Record<string, unknown>,
    field?: FieldOptions,
  ): string;

  /** Append one value per array key, creating the array when the key is absent. */
  protected abstract jsonPush(ctx: QueryContext, expr: string, push: Record<string, unknown>): string;

  /** Remove object keys. */
  protected abstract jsonUnset(ctx: QueryContext, expr: string, unset: readonly string[]): string;

  /**
   * The text of SQL a schema declares, as DDL carries it: values written as literals, and none left bound,
   * since a `CREATE` statement has no placeholder to bind one into. An entity's SQL reads its fields, a
   * predicate with no entity filter applied; a migration's is `raw` reading none.
   */
  compileDdl(sql: QueryRaw): string;
  compileDdl<E>(sql: EntityWhereMeta<E>, entity: Type<E>): string;
  compileDdl<E>(sql: EntityWhereMeta<E>, entity?: Type<E>): string {
    const ctx = this.createContext({ inlineValues: true });
    if (sql instanceof QueryRaw) {
      sql.render({ ctx, dialect: this, prefix: '', escapedPrefix: '', entity });
    } else if (entity) {
      this.renderWhere(ctx, entity, sql, { clause: false });
    } else {
      throw new TypeError('a predicate compiles against the entity it is written for, and none was given');
    }
    if (ctx.values.length) {
      throw new TypeError(`DDL has no placeholder to bind a value into, and this SQL left one bound: ${ctx.sql}`);
    }
    return ctx.sql;
  }

  getRawValue(ctx: QueryContext, opts: QueryRawFnOptions & { value: QueryRaw }) {
    const { value, prefix = '', escapedPrefix } = opts;
    value.render({
      ...opts,
      ctx,
      dialect: this,
      prefix,
      escapedPrefix: escapedPrefix ?? this.escapeId(prefix, true, true),
    });
  }

  /** A `column.path` key of `meta`'s JSON field as the path it names, shared by `where` and `sort`; else `undefined`. */
  protected resolveJsonDotPath<E>(meta: EntityMeta<E>, key: string, prefix?: string): JsonSlot | undefined {
    const dotIndex = key.indexOf('.');
    if (dotIndex <= 0) {
      return undefined;
    }
    const root = key.slice(0, dotIndex);
    const field = meta.fields[root as FieldKey<E>];
    if (!field || columnFamily(field.type) !== 'json') {
      return undefined;
    }
    const colName = this.resolveColumnName(root, field);
    const prefixed = (prefix ? this.escapeId(prefix, true, true) : '') + this.escapeId(colName);
    return { base: prefixed, path: key.slice(dotIndex + 1) };
  }

  /**
   * One JSON path, read the way `mode` asks for: the one place the three readings are chosen between,
   * so `$where`, `$sort` and every operator reach a path the same way. Public because a JSON index
   * is matched back by its own text, so the migrator's `CREATE INDEX` has to spell it from here too.
   */
  jsonPathExpr(escapedColumn: string, path: string, mode: JsonAccessMode): string {
    return mode === 'numeric'
      ? this.numericCast(this.jsonPathReading(escapedColumn, path, 'text'))
      : this.jsonPathReading(escapedColumn, path, mode);
  }

  /** A path of the JSON in `escapedColumn`, `''` for the document itself, as its JSON value or its text. */
  protected abstract jsonPathReading(escapedColumn: string, path: string, mode: 'json' | 'text'): string;

  /**
   * Normalizes a raw WHERE value into an operator map.
   * Arrays become `$in`, operator maps pass through, everything else becomes `$eq`.
   */
  private normalizeWhereValue(val: unknown): Record<string, unknown> {
    if (Array.isArray(val)) return { $in: val };
    if (isOperatorMap(val)) return val;
    return { $eq: val };
  }

  /**
   * A field key's mapped column (`@Field({ name })`), escaped, memoized per dialect instance: field
   * metadata is shared between dialects while this result is not, since `escapeIdChar` and the naming
   * strategy differ. Weakly keyed so a transient entity's metadata stays collectable.
   */
  private escapedColumnOf(key: string, field: FieldOptions | undefined): string {
    if (!field) {
      return this.escapeId(this.resolveColumnName(key, field));
    }
    let escaped = this.escapedColumns.get(field);
    if (escaped === undefined) {
      escaped = this.escapeId(this.resolveColumnName(key, field));
      this.escapedColumns.set(field, escaped);
    }
    return escaped;
  }

  private escapedColumnName<E>(meta: EntityMeta<E>, key: string): string {
    return this.escapedColumnOf(key, meta.fields[key]);
  }

  private escapedColumn<E>(table: string, meta: EntityMeta<E>, key: string): string {
    return this.escapeId(table, false, true) + this.escapedColumnName(meta, key);
  }

  /**
   * The single path from a relation operator to its target, so none can emit an unscoped subquery:
   * the target's `$where` is merged with its active filters, making a trashed or out-of-scope row
   * invisible here just as it is to a joined `$populate`. The caller's filter bypass is deliberately
   * not propagated (`withDeleted()` does not reach into relations), matching `selectRelationJoins`.
   */
  private appendRelationSubquery<E>(
    ctx: QueryContext,
    meta: EntityMeta<E>,
    relKey: string,
    rel: RelationMeta,
    opts: QueryComparisonOptions,
    read: RelationSubqueryRead,
  ): void {
    const relatedEntity = rel.entity();
    const relatedMeta = getMeta(relatedEntity);
    const parent = opts.prefix ?? this.resolveTableAlias(meta);
    // Resolved before any SQL is emitted: it also decides whether the junction form reaches the target.
    const targetWhere = this.scopedWhere(relatedMeta, read.where ?? {});

    // A tally or an existence reads the junction's own rows; a column of the target reads each target once.
    if (rel.through && !read.field) {
      ctx.append(`(SELECT ${read.op === 'exists' ? '1' : 'COUNT(*)'} FROM `);
      const junction = this.junctionRows(ctx, meta, rel, rel.through(), parent);
      ctx.append(junction.from);
      if (hasKeys(targetWhere)) {
        const related = this.tableRef(relatedMeta, ctx.claimAlias(relKey));
        const targetKey = soleIdOf(relatedMeta, 'a many-to-many target');
        ctx.append(` AND ${junction.target} IN (`);
        ctx.append(`SELECT ${this.escapedColumn(related.alias, relatedMeta, targetKey)} FROM ${related.ref}`);
        this.renderWhere(ctx, relatedEntity, targetWhere, { prefix: related.alias, clause: 'WHERE' });
        ctx.append(')');
      }
    } else {
      // The alias is claimed before the SELECT is written, since an aggregate names a column of it.
      const related = this.tableRef(relatedMeta, ctx.claimAlias(relKey, parent));
      ctx.append(
        `(SELECT ${this.aggregateProjection(ctx, read, related.alias, relatedMeta)} FROM ${related.ref} WHERE `,
      );
      this.appendCorrelation(ctx, meta, rel, parent, related.alias);
      this.renderWhere(ctx, relatedEntity, targetWhere, { prefix: related.alias, clause: 'AND' });
    }

    ctx.append(')');
  }

  /**
   * What a relation subquery selects: the literals a relation operator reads, or an aggregate over one
   * of the target's columns or its distance to a vector. `count` and `sum` answer `0` on a parent with no
   * rows, which is what makes them the two a trigger could keep; the rest answer `NULL`, and the field's
   * type says so.
   */
  private aggregateProjection<E>(
    ctx: QueryContext,
    projection: RelationSubqueryProjection,
    alias: string,
    relatedMeta: EntityMeta<E>,
  ): string {
    if (projection.op === 'exists') {
      return '1';
    }
    const { op, field, search } = projection;
    if (!field) {
      return this.aggregateCall(op, '');
    }
    const operand = search
      ? this.buildFragment(ctx, (fragmentCtx) =>
          this.appendVectorDistance(fragmentCtx, relatedMeta, field, search, alias),
        )
      : this.escapedColumn(alias, relatedMeta, field);
    return this.aggregateCall(op, operand);
  }

  /**
   * A relation aggregate as the correlated subquery a `computed` field reads, the same one `$count`
   * emits: `(user) => user.resources.count()` renders here, wherever the field is named.
   */
  appendRelationAggregate<E>(
    ctx: QueryContext,
    entity: Type<E>,
    aggregate: RelationAggregateSpec,
    prefix: string,
  ): void {
    const meta = getMeta(entity);
    const rel = relationOf(meta, aggregate.relation as RelationKey<E>);
    const parent = prefix || this.resolveTableAlias(meta);
    if (aggregate.page?.$limit === undefined && aggregate.page?.$skip === undefined) {
      this.appendRelationSubquery(ctx, meta, aggregate.relation, rel, { prefix: parent }, aggregate);
      return;
    }
    // Capped: the rows it reads are a page of the relation, so they are read first - ordered, since an
    // order is what picks them - and the aggregate runs over that page.
    const pageAlias = this.escapeId(AGGREGATE_PAGE_ALIAS);
    const value = this.escapeId(AGGREGATE_VALUE_ALIAS);
    ctx.append(`(SELECT ${this.aggregateCall(aggregate.op, `${pageAlias}.${value}`)} FROM (`);
    this.appendRelationPage(ctx, meta, rel, aggregate, parent);
    ctx.append(`) ${pageAlias})`);
  }

  /**
   * The page a capped aggregate reads: an ordinary read of the related entity under its own alias,
   * narrowed to the parent's rows, carrying out the one column the aggregate runs over. Its `$sort`,
   * `$limit` and `$skip` are the relation's own, and its filters apply as they do to any read.
   */
  private appendRelationPage<E>(
    ctx: QueryContext,
    meta: EntityMeta<E>,
    rel: RelationMeta,
    aggregate: RelationAggregateSpec,
    parent: string,
  ): void {
    const entity = rel.entity();
    const alias = ctx.claimAlias(aggregate.relation, parent);
    const correlation = raw(({ ctx: pageCtx }) => this.appendCorrelation(pageCtx, meta, rel, parent, alias));
    const { where: $where, page } = aggregate;
    // `1` where nothing is aggregated: a tally counts the rows the page holds, whatever they carry.
    const { field, search } = aggregate;
    const read = !field
      ? raw`1`
      : search
        ? raw(({ ctx: readCtx }) => this.appendVectorDistance(readCtx, getMeta(entity), field, search, alias))
        : refs(entity)[field as FieldKey<object>];
    const query = {
      ...page,
      $select: [read.as(AGGREGATE_VALUE_ALIAS)],
      $where: { ...$where, $and: [...($where?.$and ?? []), correlation] },
    };
    const joins = resolveQueryJoins(getMeta(entity), query, (path) => ctx.claimAlias(path));
    this.read(ctx, entity, query, { alias }, joins);
  }

  /** A relation aggregate over an operand, reading `0` on a parent with no rows where its type says so. */
  private aggregateCall(op: RelationAggregateOp, operand: string): string {
    const call = this.aggregateFn(op, op === '$count' ? '*' : operand);
    return op === '$sum' ? `COALESCE(${call}, 0)` : call;
  }

  /** One aggregate function call, the one spelling every statement that aggregates writes. */
  private aggregateFn(op: QueryAggregateOp, operand: string, distinct?: boolean): string {
    return `${AbstractSqlDialect.AGGREGATE_FN[op]}(${distinct ? 'DISTINCT ' : ''}${operand})`;
  }

  /**
   * One equality per key of the parent, anded: a composite correlates on every column, and matching on
   * part of one would find the rows of a different parent. `parentJoins` keeps the two ends the right
   * way round, whether the join lands on the junction or on the target.
   */
  private correlation<E>(
    meta: EntityMeta<E>,
    rel: RelationMeta,
    parent: string,
    alias: string,
    joinedMeta: EntityMeta<object>,
  ): string {
    const escapedParent = this.escapeId(parent, true, true);
    return parentJoins(rel, meta.ids.length)
      .map(
        ({ parent: key, joined }) =>
          `${this.escapedColumn(alias, joinedMeta, joined)} = ${escapedParent}${this.escapedColumnName(meta, key)}`,
      )
      .join(' AND ');
  }

  /**
   * Each to-many a row populates, as a subquery of the statement's select list correlated to `parent`,
   * the row's alias. [The design](../../../../architecture/relations-in-one-statement.md).
   */
  private selectToManyRelations<E>(
    ctx: QueryContext,
    meta: EntityMeta<E>,
    populate: QueryPopulate<E> | undefined,
    parent: string,
    distinct: boolean,
  ): SelectTerm[] {
    return getRelationRequestSummary(meta, populate).toManyKeys.map((relKey) => {
      const { query } = parseRelationAtKey(relKey, populate);
      const sql = this.buildFragment(ctx, (fragmentCtx) =>
        this.appendToManyRelation(fragmentCtx, meta, relKey, query, parent, distinct),
      );
      return { sql, key: relKey };
    });
  }

  /** Each relation a read's `$count` tallies, as a correlated count of its select list. */
  private selectRelationCounts<E>(
    ctx: QueryContext,
    meta: EntityMeta<E>,
    count: QueryCount<E> | undefined,
    parent: string,
  ): SelectTerm[] {
    return countedRelations(meta, count).map(({ relKey, relation, where }) => {
      const sql = this.buildFragment(ctx, (fragmentCtx) =>
        this.appendRelationSubquery(fragmentCtx, meta, relKey, relation, { prefix: parent }, { op: '$count', where }),
      );
      return { sql, key: `${COUNT_RESULT_KEY}.${relKey}` };
    });
  }

  /**
   * A to-many's rows as one JSON array: an ordinary read of the related entity under the relation's
   * name, narrowed to the parent's rows, in the engine's own spelling.
   */
  private appendToManyRelation<E>(
    ctx: QueryContext,
    meta: EntityMeta<E>,
    relKey: RelationKey<E>,
    query: RelationQuery,
    parent: string,
    distinct: boolean,
  ): void {
    const relation = relationOf(meta, relKey);
    const entity = relation.entity();
    const relMeta = getMeta(entity);
    this.assertDistinctSort(relMeta, relKey, query);
    const alias = ctx.claimAlias(relKey, parent);
    const correlation = raw(({ ctx: rowsCtx }) => this.appendCorrelation(rowsCtx, meta, relation, parent, alias));
    const rows = { ...query, $where: { ...query.$where, $and: [...(query.$where?.$and ?? []), correlation] } };
    const joins = resolveQueryJoins(relMeta, rows, (path) => ctx.claimAlias(path));
    this.appendRelationArray(ctx, { entity, query: rows, alias, joins, distinct });
  }

  /**
   * A relation that deduplicates its rows is sorted only by what it selects: `SELECT DISTINCT` orders by
   * nothing else, and a column carrying a sort term out would join the set it deduplicates on.
   */
  private assertDistinctSort(meta: EntityMeta<object>, relKey: string, query: RelationQuery): void {
    if (!query.$distinct || !query.$sort) {
      return;
    }
    const selected: readonly unknown[] = projectedKeys(meta, query.$select, query.$exclude, true);
    for (const key of getKeys(query.$sort)) {
      if (!selected.includes(key)) {
        throw new UqlUsageError(
          `cannot $sort the $distinct relation '${relKey}' by '${key}', which it does not select`,
        );
      }
    }
  }

  /**
   * What makes a relation's row one of the parent's: its foreign key on the parent's key, or, through a
   * junction, a pairing of the two that the junction's own filters let through.
   */
  private appendCorrelation<E>(
    ctx: QueryContext,
    meta: EntityMeta<E>,
    rel: RelationMeta,
    parent: string,
    alias: string,
  ): void {
    const relMeta = getMeta(rel.entity());
    if (!rel.through) {
      ctx.append(this.correlation(meta, rel, parent, alias, relMeta));
      return;
    }
    const junction = this.junctionRows(ctx, meta, rel, rel.through(), parent);
    const targetKey = soleIdOf(relMeta, 'a many-to-many target');
    ctx.append(`${this.escapedColumn(alias, relMeta, targetKey)} IN (SELECT ${junction.target} FROM ${junction.from})`);
  }

  /**
   * A junction's rows pairing the parent with the relation's targets, as far as its own filters let them
   * through, since a soft-deleted link is not a link; and the column naming each row's target.
   */
  private junctionRows<E>(
    ctx: QueryContext,
    meta: EntityMeta<E>,
    rel: RelationMeta,
    junction: Type<object>,
    parent: string,
  ): { readonly from: string; readonly target: string } {
    const junctionMeta = getMeta(junction);
    const { alias, ref } = this.tableRef(junctionMeta, ctx.claimAlias(this.resolveTableAlias(junctionMeta), parent));
    const scope = this.buildFragment(ctx, (fragmentCtx) =>
      this.where(fragmentCtx, junction, {}, { prefix: alias, clause: 'AND' }),
    );
    const [target] = targetKeyColumns(rel, meta.ids.length);
    return {
      from: `${ref} WHERE ${this.correlation(meta, rel, parent, alias, junctionMeta)}${scope}`,
      target: this.escapedColumn(alias, junctionMeta, target),
    };
  }

  /**
   * A relation's rows as one JSON array, in the engine's own spelling: an aggregate over them read as
   * a derived table ({@link derivedRelation}), or over the related table itself where the engine cannot
   * correlate a derived table. [The design](../../../../architecture/relations-in-one-statement.md).
   */
  protected abstract appendRelationArray(ctx: QueryContext, rows: RelationRows): void;

  /**
   * The rows read as a derived table, their values crossing JSON and, where the aggregate orders, each
   * sort term carried out beside them for it to order by, since a derived table's order is not promised
   * past it. The table takes the relation's name, which nothing inside it can see.
   */
  protected derivedRelation(ctx: QueryContext, rows: RelationRows): DerivedRelation {
    const rowsCtx = ctx.createFragment();
    const readOpts = { alias: rows.alias, json: true, carried: this.features.orderedJsonAggregates };
    const { terms, order = [] } = this.read(rowsCtx, rows.entity, rows.query, readOpts, rows.joins);
    const alias = this.escapeId(rows.alias, true);
    return {
      from: `(${rowsCtx.sql}) ${alias}`,
      pairs: terms.map((term) => {
        const key = relationTermKey(term);
        return [key, `${alias}.${this.escapeId(key, true)}`] as const;
      }),
      order: order.map(({ ref, ...term }) => this.orderByTerm(`${alias}.${ref}`, term)).join(', '),
    };
  }

  /**
   * How each column family crosses JSON inside its parent's statement, where JSON would round it or
   * cannot spell it: as text, which the field's hydrate kind decodes back, and bytes as `\x` and hex,
   * the `BYTES_PREFIX`. A family missing here crosses as it is.
   */
  protected readonly carriedFields: CarriedFields = {};

  /** `expr` as it crosses JSON, by its field's family: see {@link carriedFields}. */
  private carried(expr: string, field: FieldOptions): string {
    const family = columnFamily(field.columnType ?? field.type);
    return (family && this.carriedFields[family]?.(expr, field)) ?? expr;
  }

  /** `'key', column, ...`: the arguments of a JSON object call over `pairs`. */
  protected jsonObjectArgs(pairs: DerivedRelation['pairs']): string {
    return pairs.map(([key, sql]) => `${this.escape(key)}, ${sql}`).join(', ');
  }

  /** Filter by relation: a parent matches when {@link appendRelationSubquery} finds one target row. */
  protected compareRelation<E>(
    ctx: QueryContext,
    entity: Type<E>,
    relKey: string,
    val: QueryWhere<object>,
    rel: RelationMeta,
    opts: QueryComparisonOptions,
  ): void {
    ctx.append('EXISTS ');
    this.appendRelationSubquery(ctx, getMeta(entity), relKey, rel, opts, { op: 'exists', where: val });
  }

  /** Filter by relation size: the same subquery, counting instead of testing for existence. */
  protected compareRelationSize<E>(
    ctx: QueryContext,
    entity: Type<E>,
    relKey: string,
    sizeVal: number | QuerySizeComparisonOps,
    rel: RelationMeta,
    opts: QueryComparisonOptions,
  ): void {
    const count: QueryBuildFn = (fragmentCtx) =>
      this.appendRelationSubquery(fragmentCtx, getMeta(entity), relKey, rel, opts, { op: '$count' });
    ctx.append(this.sizeCondition(ctx, count, sizeVal));
  }

  /**
   * `<expr> <op> <value>` for each bound, `AND`-joined. `expr` is spelled once per bound because it is an
   * expression, not a column: a `WHERE` has no output alias to refer back to. Shared by `$size`, which
   * counts, and `$near`, which measures a distance.
   */
  private boundConditions(
    ctx: QueryContext,
    expr: QueryBuildFn,
    bounds: Record<string, unknown>,
    condition: (operand: string, op: string, val: unknown) => string | undefined,
    refusal: string,
  ): string {
    const parts = Object.entries(bounds)
      .filter(([, val]) => val !== undefined)
      .map(([op, val]) => orRefuse(condition(this.buildFragment(ctx, expr), op, val), `${refusal}: ${op}`));
    return AbstractSqlDialect.conjunction(parts);
  }

  /**
   * A count compared with `size`, a number or its bounds. A count is never NULL, so its equality stays
   * plain rather than the null-safe `$ne` (`IS DISTINCT FROM`, `IS NOT`): same rows, shorter SQL.
   */
  private sizeCondition(ctx: QueryContext, count: QueryBuildFn, size: number | QuerySizeComparisonOps): string {
    const bounds = typeof size === 'number' ? { $eq: size } : size;
    return this.boundConditions(
      ctx,
      count,
      bounds,
      (operand, op, val) => {
        if (op === '$eq' || op === '$ne') {
          return `${operand} ${op === '$eq' ? '=' : '<>'} ${this.addValue(ctx, val)}`;
        }
        return AbstractSqlDialect.ORDERED_OPS.has(op) ? this.operatorCondition(ctx, operand, op, val) : undefined;
      },
      'unsupported $size comparison operator',
    );
  }

  /** `<distance> <op> ?`, the `$where` half of a vector search, its bounds checked here since `/http` input is untyped. */
  private vectorNearCondition<E>(
    ctx: QueryContext,
    meta: EntityMeta<E>,
    key: string,
    near: QueryVectorNear,
    prefix: string | undefined,
  ): string {
    const bounds: Record<string, unknown> = {};
    for (const [op, val] of Object.entries(near)) {
      if (AbstractSqlDialect.VECTOR_QUERY_KEYS.has(op) || val === undefined) {
        continue;
      }
      if (!AbstractSqlDialect.ORDERED_OPS.has(op)) {
        throw new UqlUsageError(`unsupported $near bound: ${op}`);
      }
      bounds[op] = val;
    }
    if (!hasKeys(bounds)) {
      const boundOps = [...AbstractSqlDialect.ORDERED_OPS].join(', ');
      throw new UqlUsageError(`$near on '${key}' needs a bound (${boundOps}); without one it filters nothing`);
    }
    // Required by the type, so this only fires for a query that never met it: `/http` casts client
    // JSON straight to `Query`. A `$near` never borrows the `$sort`'s vector, which is what keeps the
    // predicate meaning the same thing in a `count`, or in an entity filter merged into a `$where`.
    if (!near.$vector) {
      throw new UqlUsageError(`$near on '${key}' needs its own $vector`);
    }
    const distance: QueryBuildFn = (fragmentCtx) => this.appendVectorDistance(fragmentCtx, meta, key, near, prefix);
    return this.boundConditions(
      ctx,
      distance,
      bounds,
      (operand, op, val) => this.operatorCondition(ctx, operand, op, val),
      'unsupported $near bound',
    );
  }

  /** ANSI-style single-quote escaping. MySQL-family dialects override this for backslash escaping. */
  escape(value: unknown): string {
    return escapeAnsiSqlLiteral(value);
  }

  protected get regexpOp(): string {
    return 'REGEXP';
  }

  /**
   * The `$regex` predicate. An infix operator on the MySQL family (`REGEXP`) and the Postgres one
   * (`~`), but a function on Oracle and SQL Server 2025 (`REGEXP_LIKE(col, ?)`) - which is why this
   * is a method rather than the operator token alone. An engine with no regex at all overrides it to
   * throw, the way {@link appendTextSearch} already does.
   */
  protected regexCondition(operand: string, placeholder: string): string {
    return `${operand} ${this.regexpOp} ${placeholder}`;
  }

  protected get likeFn(): string {
    return 'LIKE';
  }

  /**
   * Not-equal operator token for non-null comparisons.
   * Postgres uses `IS DISTINCT FROM`; MySQL/Maria uses custom `neExpr`.
   */
  protected get neOp(): string {
    return '<>';
  }

  protected neExpr(field: string, ph: string): string {
    return `${field} ${this.neOp} ${ph}`;
  }

  /** `operand IN (...)` of each value as `bind` renders it, or the constant an empty set reduces to: no value is in it. */
  protected formatIn(
    _ctx: QueryContext,
    operand: string,
    values: unknown[],
    negate: boolean,
    bind: (value: unknown) => string,
  ): string {
    if (!values.length) {
      return negate ? '1 = 1' : '1 = 0';
    }
    const phs = values.map(bind).join(', ');
    return `${operand} ${negate ? 'NOT IN' : 'IN'} (${phs})`;
  }

  /** Reads extracted JSON text as a number, which every engine spells its own way. */
  protected abstract numericCast(expr: string): string;

  override toString(): string {
    return this.dialectName;
  }
}
