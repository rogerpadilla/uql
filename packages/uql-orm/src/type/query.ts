import type { FieldKey, IdValue, JsonFieldPaths, RelationKey, UpdatePayload } from './entity.js';
import type { BooleanLike, ExpandScalar, PrimaryKey, Scalar, Type, Unpacked } from './utility.js';

export type QueryOptions = {
  /**
   * Toggle named entity filters for this query. `false` disables all filters;
   * `{ softDelete: false }` disables one; `{ myFilter: true }` force-enables a `default: false` filter.
   * Security filters cannot be disabled here.
   */
  filters?: false | Record<string, boolean>;
  /**
   * Delete only: physically remove rows instead of soft-deleting, ignoring the soft-delete filter so
   * already-deleted rows are removed too. No effect on entities without a soft-delete field.
   */
  hardDelete?: boolean;
  /**
   * prefix the query with this.
   */
  prefix?: string;
  /**
   * automatically infer the prefix for the query.
   */
  autoPrefix?: boolean;
};

export type QuerySelectOptions = {
  /**
   * prefix the query with this.
   */
  prefix?: string;
  /**
   * automatically add the prefix for the alias.
   */
  autoPrefixAlias?: boolean;
};

/**
 * Query field selection - `{ name: true }` whitelists specific fields.
 */
export type QuerySelect<E> = {
  [K in FieldKey<E>]?: BooleanLike;
};

/**
 * Fields to exclude from the query result - `{ name: true }` blacklists fields.
 * Mutually exclusive with positive field selections in `$select`.
 */
export type QueryExclude<E> = {
  [K in FieldKey<E>]?: BooleanLike;
};

/**
 * relation population map.
 */
export type QueryPopulate<E> = {
  [K in RelationKey<E>]?: BooleanLike | QueryPopulateRelationOptions<E[K]>;
};

/**
 * query conflict paths - subset of field keys used to detect upsert conflicts.
 */
export type QueryConflictPaths<E> = {
  [K in FieldKey<E>]?: true;
};

/**
 * options to populate a relation.
 */
export type QueryPopulateRelationOptions<E> = (E extends unknown[] ? Query<Unpacked<E>> : QueryUnique<Unpacked<E>>) & {
  $required?: boolean;
};

/**
 * options for full-text-search operator.
 */
export type QueryTextSearchOptions<E> = {
  /**
   * text to search for.
   */
  $value: string;
  /**
   * list of fields to search on.
   */
  $fields?: FieldKey<E>[];
};

/**
 * comparison by fields.
 */
export type QueryWhereFieldMap<E> = { [K in FieldKey<E>]?: QueryWhereFieldValue<E[K]> };

/**
 * Field comparison, JSONB dot-path access, and relation filtering - all fully typed.
 * Uses both a mapped type (IDE autocompletion) and a pattern index signature (EPC acceptance)
 * for dot-paths because TypeScript's excess property checking cannot resolve recursive
 * conditional types in mapped type key positions.
 */
export type QueryWhereMap<E> = QueryWhereFieldMap<E> &
  QueryWhereRootOperator<E> & { [P in JsonFieldPaths<E>]?: QueryWhereFieldValue<unknown> } & {
    [key: `${string}.${string}`]: QueryWhereFieldValue<unknown> | undefined;
  } & { [K in RelationKey<E>]?: QueryWhereMap<Unpacked<NonNullable<E[K]>>> };

export type QueryWhereRootOperator<E> = {
  /**
   * joins query clauses with a logical `AND`, returns records that match all the clauses.
   */
  $and?: QueryWhereArray<E>;
  /**
   * joins query clauses with a logical `OR`, returns records that match any of the clauses.
   */
  $or?: QueryWhereArray<E>;
  /**
   * joins query clauses with a logical `AND`, returns records that do not match all the clauses.
   * @see {@link QueryWhereFieldOperatorMap.$not} for per-field negation.
   */
  $not?: QueryWhereArray<E>;
  /**
   * joins query clauses with a logical `OR`, returns records that do not match any of the clauses.
   */
  $nor?: QueryWhereArray<E>;
  /**
   * whether the specified fields match against a full-text search of the given string.
   */
  $text?: QueryTextSearchOptions<E>;
  /**
   * whether the record exists in the given sub-query.
   */
  $exists?: QueryRaw;
  /**
   * whether the record does not exists in the given sub-query.
   */
  $nexists?: QueryRaw;
};

/**
 * Per-field negation operators. `Pick`'s constraint ties this back to
 * {@link QueryWhereRootOperator} so a rename there breaks this union at compile time.
 */
export type QueryNegateOp = keyof Pick<QueryWhereRootOperator<unknown>, '$not' | '$nor'>;

/**
 * Comparison operators accepted by `$size` for range queries: {@link QueryHavingOp} plus `$between`.
 * Strips `null` from picked operators since array size is always numeric.
 */
export type QuerySizeComparisonOps = {
  [K in QueryHavingOp | '$between']?: NonNullable<QueryWhereFieldOperatorMap<number>[K]>;
};

export type QueryWhereFieldOperatorMap<T> = {
  /**
   * whether a value is equal to the given value.
   */
  $eq?: ExpandScalar<T> | null;
  /**
   * whether a value is not equal to the given value.
   */
  $ne?: ExpandScalar<T> | null;
  /**
   * negates the given comparison for a single field.
   * @see {@link QueryWhereRootOperator.$not} for root-level clause negation.
   */
  $not?: QueryWhereFieldValue<T>;
  /**
   * whether a value is less than the given value.
   */
  $lt?: ExpandScalar<T>;
  /**
   * whether a value is less than or equal to the given value.
   */
  $lte?: ExpandScalar<T>;
  /**
   * whether a value is greater than the given value.
   */
  $gt?: ExpandScalar<T>;
  /**
   * whether a value is greater than or equal to the given value.
   */
  $gte?: ExpandScalar<T>;
  /**
   * whether a value is between two values (inclusive). Shorthand for $gte + $lte.
   * @example { age: { $between: [18, 65] } }
   */
  $between?: [ExpandScalar<T>, ExpandScalar<T>];
  /**
   * whether a string begins with the given string (case sensitive).
   */
  $startsWith?: string;
  /**
   * whether a string begins with the given string (case insensitive).
   */
  $istartsWith?: string;
  /**
   * whether a string ends with the given string (case sensitive).
   */
  $endsWith?: string;
  /**
   * whether a string ends with the given string (case insensitive).
   */
  $iendsWith?: string;
  /**
   * whether a string is contained within the given string (case sensitive).
   */
  $includes?: string;
  /**
   * whether a string is contained within the given string (case insensitive).
   */
  $iincludes?: string;
  /**
   * whether a string fulfills the given pattern (case sensitive).
   */
  $like?: string;
  /**
   * whether a string fulfills the given pattern (case insensitive).
   */
  $ilike?: string;
  /**
   * whether a string matches the given regular expression.
   */
  $regex?: string;
  /**
   * whether a value matches any of the given values.
   */
  $in?: ExpandScalar<T>[];
  /**
   * whether a value does not match any of the given values.
   */
  $nin?: ExpandScalar<T>[];
  /**
   * whether a value is null.
   * @example { deletedAt: { $isNull: true } }
   */
  $isNull?: boolean;
  /**
   * whether a value is not null.
   * @example { email: { $isNotNull: true } }
   */
  $isNotNull?: boolean;
  /**
   * whether an array contains all the specified values.
   * @example { tags: { $all: ['typescript', 'orm'] } }
   */
  $all?: T extends (infer U)[] ? ExpandScalar<U>[] : unknown[];
  /**
   * whether an array has the specified length.
   * Accepts a number for exact match, or a comparison operator object for range queries.
   * @example { roles: { $size: 3 } }
   * @example { roles: { $size: { $gte: 2 } } }
   * @example { roles: { $size: { $gt: 0, $lte: 5 } } }
   */
  $size?: number | QuerySizeComparisonOps;
  /**
   * whether an array contains at least one element matching all specified conditions.
   * @example { addresses: { $elemMatch: { city: 'NYC', zip: '10001' } } }
   */
  $elemMatch?: T extends (infer U)[] ? Partial<U> : Record<string, QueryWhereFieldValue<unknown>>;
};

/**
 * Simple relational comparison operators. `Pick`'s constraint ties this back to
 * {@link QueryWhereFieldOperatorMap} so a rename there breaks this union at compile time.
 */
export type QueryCompareOp = keyof Pick<QueryWhereFieldOperatorMap<unknown>, '$gt' | '$gte' | '$lt' | '$lte'>;

/**
 * String pattern-matching operators. `Pick`'s constraint ties this back to
 * {@link QueryWhereFieldOperatorMap} so a rename there breaks this union at compile time.
 */
export type QueryLikeOp = keyof Pick<
  QueryWhereFieldOperatorMap<unknown>,
  '$startsWith' | '$istartsWith' | '$endsWith' | '$iendsWith' | '$includes' | '$iincludes' | '$like' | '$ilike'
>;

/**
 * `HAVING` clause operators: {@link QueryCompareOp} plus `$eq`/`$ne`. `Pick`'s constraint ties the
 * latter back to {@link QueryWhereFieldOperatorMap} so a rename there breaks this union at compile time.
 */
export type QueryHavingOp = QueryCompareOp | keyof Pick<QueryWhereFieldOperatorMap<number>, '$eq' | '$ne'>;

/**
 * Value for a field comparison.
 */
export type QueryWhereFieldValue<T> = T | T[] | QueryWhereFieldOperatorMap<T> | QueryRaw;

/**
 * query filter array - used for `$and`, `$or`, `$not`, `$nor` operators.
 */
export type QueryWhereArray<E> = (QueryWhereMap<E> | QueryRaw)[];

/**
 * query filter.
 */
export type QueryWhere<E> = IdValue<E> | IdValue<E>[] | QueryWhereMap<E> | QueryWhereArray<E> | QueryRaw;

/**
 * Ambient per-request context (e.g. `{ tenantId, userId, roles }`) resolved by parameterized
 * filters. Set with `withContext(ctx, cb)`. It's an `interface` (not a type alias) so you can type
 * your keys once via declaration merging and get them typed wherever context is read:
 *
 * ```ts
 * declare module 'uql-orm' {
 *   interface UqlContext { tenantId: number; userId: string }
 * }
 * ```
 */
export interface UqlContext {
  [key: string]: unknown;
}

/**
 * A filter's `$where` fragment: a plain fragment, or a function of the ambient {@link UqlContext}.
 * Return `undefined` when the condition can't resolve (see {@link FilterOptions.onMissing}).
 */
export type FilterCondition<E> = QueryWhere<E> | ((context: UqlContext | undefined) => QueryWhere<E> | undefined);

/**
 * What to do when a filter's condition returns `undefined`. `skip` omits it (convenience filters);
 * `throw` fails closed (the default for `security` filters).
 */
export type FilterOnMissing = 'skip' | 'throw';

/**
 * Authoring shape for `@Entity({ filters })` / `@Filter` / `defineFilter`.
 */
export type FilterOptions<E = unknown> = {
  readonly condition: FilterCondition<E>;
  /** Applied to every query unless bypassed via `QueryOptions.filters`. Defaults to `true`. */
  readonly default?: boolean;
  /**
   * Row-level-security filter: always applied (ignores `QueryOptions.filters` bypass) and
   * AND-merged so a client `$where` on the same field can't override it.
   */
  readonly security?: boolean;
  /** What to do when the condition returns `undefined`. Defaults to `skip`, or `throw` for `security`. */
  readonly onMissing?: FilterOnMissing;
};

/**
 * Resolved filter metadata stored on `EntityMeta.filters`.
 */
export type FilterMeta<E = unknown> = FilterOptions<E>;

/**
 * direction for the sort.
 */
export type QuerySortDirection = -1 | 1 | 'asc' | 'desc';

/**
 * Distance metrics supported by vector similarity search.
 * - `cosine` - best for text/LLM embeddings (default)
 * - `l2` - Euclidean distance
 * - `inner` - inner (dot) product
 * - `l1` - Manhattan distance
 * - `hamming` - for binary vectors
 */
export type VectorDistance = 'cosine' | 'l2' | 'inner' | 'l1' | 'hamming';

/**
 * Vector similarity search options - used inside `$sort` on vector fields.
 *
 * @example
 * ```ts
 * querier.findMany(Article, {
 *   $sort: { embedding: { $vector: queryVec } },
 *   $limit: 10,
 * });
 * ```
 */
export interface QueryVectorSearch {
  /** The query vector to compare against. */
  readonly $vector: readonly number[];
  /** Distance metric. Overrides entity-level default. Falls back to `'cosine'`. */
  readonly $distance?: VectorDistance;
  /** Project the computed distance as a named field in the result. */
  readonly $project?: string;
}

/**
 * Accepted value for a field in `$sort` - either a direction or a vector similarity search.
 */
export type QuerySortValue = QuerySortDirection | QueryVectorSearch;

/**
 * Augments an entity with the distance field projected by a vector-search `$sort.$project`. The
 * find methods return the plain entity, so annotate the result with this when you project a score:
 * ```ts
 * const results = (await querier.findMany(Article, {
 *   $sort: { embedding: { $vector: queryVec, $project: 'similarity' } },
 * })) as WithDistance<Article, 'similarity'>[];
 * ```
 */
export type WithDistance<E, K extends string = '_distance'> = E & Record<K, number>;

/**
 * sort by map - supports field keys, JSON dot-notation paths, relation sort,
 * and vector similarity search.
 * Uses both a mapped type (IDE autocompletion) and a pattern index signature (EPC acceptance)
 * for dot-paths, matching the same approach used in `QueryWhereMap`.
 */
export type QuerySortMap<E> = {
  [K in FieldKey<E>]?: QuerySortValue;
} & {
  [P in JsonFieldPaths<E>]?: QuerySortDirection;
} & {
  [key: `${string}.${string}`]: QuerySortDirection | undefined;
} & {
  [K in RelationKey<E>]?: QuerySortMap<NonNullable<Unpacked<E[K]>>>;
};

/**
 * pager options.
 */
export type QueryPager = {
  /**
   * Index from where start the search
   */
  $skip?: number;

  /**
   * Max number of records to retrieve
   */
  $limit?: number;
};

/**
 * search options.
 */
export type QuerySearch<E> = {
  /**
   * filtering options.
   */
  $where?: QueryWhere<E>;

  /**
   * sorting options.
   */
  $sort?: QuerySortMap<E>;
} & QueryPager;

/**
 * criteria one options.
 */

/**
 * query options.
 */
export type Query<E> = {
  /**
   * field selection - `{ name: true }` whitelists fields. Mutually exclusive with `$exclude`.
   */
  $select?: QuerySelect<E>;

  /**
   * relation population options.
   */
  $populate?: QueryPopulate<E>;

  /**
   * field exclusion - `{ name: true }` blacklists fields. Mutually exclusive with positive `$select`.
   */
  $exclude?: QueryExclude<E>;

  /**
   * whether to return only distinct rows.
   */
  $distinct?: boolean;
} & QuerySearch<E>;

/**
 * options to get a single record.
 */
export type QueryOne<E> = Omit<Query<E>, '$limit'>;

/**
 * options to get an unique record.
 */
export type QueryUnique<E> = Pick<QueryOne<E>, '$select' | '$exclude' | '$populate' | '$where'>;

/**
 * Maps the offending keys to `never`, turning an excess key into a compile error; resolves to
 * `unknown` (an inert intersection member) when there are none. Used by `aggregate`'s `$group`,
 * which is captured as a generic (a bare generic skips excess-property checking). The find methods
 * don't need this: they take concrete `Query<E>` params, so TypeScript's native excess-property
 * checking rejects stray keys directly.
 * @internal
 */
type Reject<K> = [K] extends [never] ? unknown : Record<K & string, never>;

/**
 * stringified query.
 */
export type QueryStringified = {
  [K in keyof Query<unknown>]?: string;
};

/**
 * result of an update operation.
 */
export type QueryUpdateResult = {
  /**
   * number of affected records.
   */
  changes?: number;
  /**
   * the inserted IDs, in insertion order. Exact on `'returning'` dialects; inferred from the
   * driver header on the others (see {@link InsertIdSource}), and empty when the header
   * reports no generated ID.
   */
  ids?: PrimaryKey[];
  /**
   * first inserted ID.
   */
  firstId?: PrimaryKey;
  /**
   * whether the record was created (`true`) or updated (`false`).
   * `undefined` when the dialect cannot determine this (e.g. SQLite).
   */
  created?: boolean;
};

/**
 * options for the `raw` function.
 */
export type QueryRawFnOptions = {
  /**
   * the current dialect.
   */
  dialect?: QueryDialect;
  /**
   * the prefix.
   */
  prefix?: string;
  /**
   * the escaped prefix.
   */
  escapedPrefix?: string;
  /**
   * the query context.
   */
  ctx?: QueryContext;
};

/**
 * a `raw` function
 */
export type QueryRawFn = (opts?: QueryRawFnOptions) => void | Scalar;

export const RAW_VALUE: unique symbol = Symbol('rawValue');
export const RAW_ALIAS: unique symbol = Symbol('rawAlias');

export class QueryRaw {
  readonly [RAW_VALUE]: Scalar | QueryRawFn;
  readonly [RAW_ALIAS]?: string;

  constructor(value: Scalar | QueryRawFn, alias?: string) {
    this[RAW_VALUE] = value;
    this[RAW_ALIAS] = alias;
  }
}

/**
 * comparison options.
 */
export type QueryComparisonOptions = QueryOptions & {
  /**
   * use precedence for the comparison or not.
   */
  usePrecedence?: boolean;
};

/**
 * query filter options.
 */
export type QueryWhereOptions = QueryComparisonOptions & {
  /**
   * clause to be used in the filter.
   */
  clause?: 'WHERE' | 'AND' | false;
};

export interface QueryContext {
  append(sql: string): this;
  addValue(value: unknown): this;
  pushValue(...values: unknown[]): this;
  readonly sql: string;
  readonly values: unknown[];
}

/**
 * Capabilities of the database driver (transport layer).
 */
export interface DriverCapabilities {
  /**
   * Whether JSON bind parameters are cast via text first (`($n::text)::jsonb`).
   * Bun SQL PostgreSQL uses this for reliable jsonb merge/push; `pg` does not.
   */
  readonly explicitJsonCast: boolean;
  /**
   * Whether the driver natively supports JS arrays for the underlying database type.
   * `PgDialect` keeps this `true` for node-postgres; Bun SQL PostgreSQL uses `false` and
   * `toPgArray` string literals instead.
   */
  readonly nativeArrays: boolean;
  /** Whether the dialect natively supports the JSONB binary JSON type (Postgres/CockroachDB). */
  readonly supportsJsonb: boolean;
}

/**
 * How a dialect surfaces the IDs generated by an INSERT statement:
 * - `'returning'`: the statement itself returns one row per inserted record (`RETURNING`,
 *   or MongoDB's `insertedIds`), so IDs are exact for every row.
 * - `'firstId'`: the driver header only exposes the first generated ID (MySQL `insertId`);
 *   the remaining IDs are inferred by incrementing it.
 * - `'lastId'`: the driver header only exposes the last generated ID (SQLite `lastInsertRowid`);
 *   the remaining IDs are inferred backwards from it.
 */
export type InsertIdSource = 'returning' | 'firstId' | 'lastId';

/**
 * Features of the database engine (SQL syntax layer).
 */
export interface EngineFeatures {
  readonly ifNotExists: boolean;
  readonly indexIfNotExists: boolean;
  readonly dropTableCascade: boolean;
  readonly renameColumn: boolean;
  readonly foreignKeyAlter: boolean;
  /** Whether the dialect supports inline COMMENT on columns (MySQL/MariaDB). */
  readonly columnComment: boolean;
  /**
   * How vector indexes are emitted: inline in CREATE TABLE (MySQL/MariaDB), a standalone
   * `CREATE INDEX ... USING <type> (col opclass)` (Postgres/SQLite), or a standalone
   * `CREATE VECTOR INDEX (col opclass)` with no access-method keyword (CockroachDB's native type).
   */
  readonly vectorIndexStyle: 'inline' | 'create' | 'native';
  /** Whether the dialect requires/allows (n) length constraints on vector types. */
  readonly vectorSupportsLength: boolean;
  /** Whether the dialect natively supports the TIMESTAMPTZ alias/type. */
  readonly supportsTimestamptz: boolean;
  /** Whether the dialect defaults to TEXT for strings when no length is specified (e.g. Postgres). */
  readonly defaultStringAsText: boolean;
}

export interface DialectFeatures extends EngineFeatures, DriverCapabilities {}

export interface QueryDialect {
  /**
   * The dialect features.
   */
  readonly features: DialectFeatures;

  /**
   * obtains the records matching the given search parameters.
   * @param ctx the query context
   * @param entity the target entity
   * @param q the criteria options
   * @param opts the query options
   */
  find<E>(ctx: QueryContext, entity: Type<E>, q: Query<E>, opts?: QueryOptions): void;

  /**
   * counts the number of records matching the given search parameters.
   * @param ctx the query context
   * @param entity the target entity
   * @param q the criteria options
   * @param opts the query options
   */
  count<E>(ctx: QueryContext, entity: Type<E>, q: QuerySearch<E>, opts?: QueryOptions): void;

  /**
   * insert records.
   * @param ctx the query context
   * @param entity the target entity
   * @param payload the payload
   * @param opts the query options
   */
  insert<E>(ctx: QueryContext, entity: Type<E>, payload: E | E[], opts?: QueryOptions): void;

  /**
   * update records.
   * @param ctx the query context
   * @param entity the target entity
   * @param q the criteria options
   * @param payload
   * @param opts the query options
   */
  update<E>(
    ctx: QueryContext,
    entity: Type<E>,
    q: QuerySearch<E>,
    payload: UpdatePayload<E>,
    opts?: QueryOptions,
  ): void;

  /**
   * upsert records.
   * @param ctx the query context
   * @param entity the target entity
   * @param conflictPaths the conflict paths
   * @param payload
   */
  upsert<E>(ctx: QueryContext, entity: Type<E>, conflictPaths: QueryConflictPaths<E>, payload: E | E[]): void;

  /**
   * delete records.
   * @param ctx the query context
   * @param entity the target entity
   * @param q the criteria options
   * @param opts the query options
   */
  delete<E>(ctx: QueryContext, entity: Type<E>, q: QuerySearch<E>, opts?: QueryOptions): void;

  /**
   * escape an identifier.
   * @param val the value to be escaped
   * @param forbidQualified don't escape dots
   * @param addDot use a dot as suffix
   */
  escapeId(val: string, forbidQualified?: boolean, addDot?: boolean): string;

  /**
   * escape a value.
   * @param val the value to escape
   */
  escape(val: unknown): string;

  /**
   * add a value to the query.
   * @param values the values array
   * @param value the value to add
   */
  addValue(values: unknown[], value: unknown): string;

  /**
   * normalizes a value according to the dialect.
   * @param value the value to normalize
   */
  normalizeValue(value: unknown): unknown;

  /**
   * create a new query context.
   */
  createContext(): QueryContext;
}

/**
 * Supported SQL dialect identifiers.
 */
export type SqlDialectName = 'postgres' | 'cockroachdb' | 'mysql' | 'mariadb' | 'sqlite';

/**
 * Minimal dialect interface exposing escapeIdChar for SQL operations
 */
export interface SqlQueryDialect extends QueryDialect {
  /**
   * The SQL dialect name (postgres, mysql, mariadb, sqlite).
   */
  readonly dialectName: SqlDialectName;

  /**
   * the escape character for identifiers.
   */
  readonly escapeIdChar: '"' | '`';

  /**
   * Build an aggregate query.
   */
  aggregate<E>(ctx: QueryContext, entity: Type<E>, q: QueryAggregate<E>, opts?: QueryOptions): void;

  /**
   * Get the placeholder for a parameter at the given index (1-based).
   * Default: '?' for MySQL/MariaDB/SQLite, '$n' for PostgreSQL.
   */
  placeholder(index: number): string;
}

// ============================================================================
// Aggregation Types
// ============================================================================

const QUERY_AGGREGATE_OPS = ['$count', '$sum', '$avg', '$min', '$max'] as const;

/**
 * Supported aggregate operations.
 */
export type QueryAggregateOp = (typeof QUERY_AGGREGATE_OPS)[number];

/**
 * Whether `op` is one of {@link QueryAggregateOp}'s known aggregate operators - validates operator
 * keys parsed from query data before trusting them as `QueryAggregateOp`.
 */
export function isQueryAggregateOp(op: string): op is QueryAggregateOp {
  return (QUERY_AGGREGATE_OPS as readonly string[]).includes(op);
}

/**
 * An aggregate function applied to a field.
 * Exactly one aggregate operation per entry.
 *
 * @example { $count: '*' }         → COUNT(*)
 * @example { $sum: 'amount' }      → SUM("amount")
 * @example { $avg: 'age' }         → AVG("age")
 */
export type QueryAggregateFn<E> = {
  [K in QueryAggregateOp]: { readonly [P in K]: FieldKey<E> | '*' | 1 };
}[QueryAggregateOp];

/**
 * Aggregate ops whose grouped column always resolves to `number`, regardless of the aggregated
 * field's own type. `Pick`'s constraint (via the throwaway `Record<QueryAggregateOp, true>`) ties
 * this back to {@link QueryAggregateOp} so a rename there breaks this union at compile time.
 */
type QueryAggregateNumericOp = keyof Pick<Record<QueryAggregateOp, true>, '$count' | '$sum' | '$avg'>;

/** The `{ readonly $count: unknown } | { readonly $sum: unknown } | { readonly $avg: unknown }` shape, generated from {@link QueryAggregateNumericOp}. */
type QueryAggregateNumericFn = {
  [K in QueryAggregateNumericOp]: { readonly [P in K]: unknown };
}[QueryAggregateNumericOp];

/**
 * Group-by columns: an object mapping entity field keys to `true`, exactly like {@link QuerySelect}.
 * Typed against the entity, so a typo'd column is a compile error. Compute aggregate columns with
 * {@link QueryAggMap} (the `$agg` key), not here.
 *
 * @example
 * ```ts
 * { status: true } // → GROUP BY "status"
 * ```
 */
export type QueryGroupMap<E> = {
  readonly [K in FieldKey<E>]?: true;
};

/**
 * Computed aggregate columns: an object mapping your chosen output alias to an aggregate function.
 * Alias names are free (you are naming new columns); the aggregated field reference inside each
 * function is typed against the entity.
 *
 * @example
 * ```ts
 * { count: { $count: '*' }, avgAge: { $avg: 'age' } }
 * // → COUNT(*) AS "count", AVG("age") AS "avgAge"
 * ```
 */
export type QueryAggMap<E> = {
  readonly [alias: string]: QueryAggregateFn<E>;
};

/**
 * Resolves a single computed column's type from its aggregate function: `$count`/`$sum`/`$avg` are
 * always `number`; `$min`/`$max` keep the aggregated field's own type.
 * @internal
 */
type QueryAggregateFnResult<E, Fn> = Fn extends QueryAggregateNumericFn
  ? number
  : Fn extends { readonly $min: infer F }
    ? F extends keyof E
      ? E[F]
      : unknown
    : Fn extends { readonly $max: infer F }
      ? F extends keyof E
        ? E[F]
        : unknown
      : unknown;

/**
 * Flattens an intersection into a single object literal for readable editor hovers.
 * @internal
 */
type Simplify<T> = { [K in keyof T]: T[K] } & {};

/**
 * Infers the aggregated result row: grouped columns (`G`) keep their entity type; computed columns
 * (`A`) resolve from their aggregate function via {@link QueryAggregateFnResult}.
 */
export type QueryAggregateResult<E, G, A> = Simplify<
  { -readonly [K in keyof G & FieldKey<E>]: E[K] } & {
    -readonly [K in keyof A]: QueryAggregateFnResult<E, A[K]>;
  }
>;

/**
 * Erased runtime shape of a HAVING clause (alias → comparison), consumed by the dialect builders.
 * Values are `unknown` because the SQL is built generically; the typed, per-column value checking
 * lives in {@link QueryAggregate.$having}.
 *
 * @example { count: { $gt: 5 } }   → HAVING COUNT(*) > 5
 */
export type QueryHavingMap = {
  readonly [alias: string]: QueryWhereFieldValue<unknown> | undefined;
};

/**
 * Aggregate query - separate from `Query<E>` to keep return types honest.
 * Used exclusively with `querier.aggregate()`.
 *
 * @example
 * ```ts
 * querier.aggregate(User, {
 *   $group: { status: true },
 *   $agg: { count: { $count: '*' }, avgAge: { $avg: 'age' } },
 *   $where: { deletedAt: { $isNull: true } },
 *   $having: { count: { $gt: 5 } },
 *   $sort: { count: -1 },
 * });
 * ```
 */
export type QueryAggregate<
  E,
  G extends QueryGroupMap<E> = QueryGroupMap<E>,
  A extends QueryAggMap<E> = QueryAggMap<E>,
> = {
  /**
   * Columns to group by - `{ status: true }`, typed against the entity like `$select`. A computed
   * aggregate wrongly placed here (it belongs in `$agg`) is rejected via {@link Reject}, since
   * `$group` is captured as a generic and a bare generic skips excess-property checking.
   */
  readonly $group?: G & Reject<Exclude<keyof G, FieldKey<E>>>;

  /**
   * Computed aggregate columns - `{ count: { $count: '*' }, avgAge: { $avg: 'age' } }`.
   */
  readonly $agg?: A;

  /**
   * Row-level filtering (applied before grouping - SQL WHERE).
   */
  readonly $where?: QueryWhere<E>;

  /**
   * Post-aggregation filtering (applied after grouping - SQL HAVING). Keyed by the result columns
   * (grouped columns + computed aliases), and each value is typed to that column's result type - a
   * `$min`/`$max` over a `Date` field compares against a `Date`, a grouped column against its own
   * type - reusing {@link QueryAggregateResult}. A name that is neither is a compile error.
   */
  readonly $having?: {
    readonly [K in keyof QueryAggregateResult<E, G, A>]?: QueryWhereFieldValue<QueryAggregateResult<E, G, A>[K]>;
  };

  /**
   * Sort the aggregated results by a grouped column, a computed alias, or an entity field.
   */
  readonly $sort?: QuerySortMap<E> & {
    readonly [K in (keyof G & string) | (keyof A & string)]?: QuerySortDirection;
  };
} & QueryPager;
