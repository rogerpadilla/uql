import type { FieldKey, IdValue, JsonFieldPaths, RelationKey, UpdatePayload } from './entity.js';
import type { BooleanLike, ExpandScalar, Scalar, Type, Unpacked } from './utility.js';

export type QueryOptions = {
  /**
   * use or omit `softDelete` attribute.
   */
  softDelete?: boolean;
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
 * query selection as a map — field and relation selections combined.
 * Uses intersection of two mapped types to enforce strict key validation.
 */
export type QuerySelect<E> = QuerySelectFieldMap<E> & QuerySelectRelationMap<E>;

/**
 * query selection of fields as a map.
 */
export type QuerySelectFieldMap<E> = {
  [K in FieldKey<E>]?: BooleanLike;
};

/**
 * query selection of relations as a map.
 */
export type QuerySelectRelationMap<E> = {
  [K in RelationKey<E>]?: BooleanLike | QuerySelectRelationOptions<E[K]>;
};

/**
 * query conflict paths — subset of field keys used to detect upsert conflicts.
 */
export type QueryConflictPaths<E> = {
  [K in FieldKey<E>]?: true;
};

/**
 * options to select a relation.
 */
export type QuerySelectRelationOptions<E> = (E extends unknown[] ? Query<Unpacked<E>> : QueryUnique<Unpacked<E>>) & {
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
 * Field comparison, JSONB dot-path access, and relation filtering — all fully typed.
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
 * Comparison operators accepted by `$size` for range queries.
 * Strips `null` from picked operators since array size is always numeric.
 */
export type QuerySizeComparisonOps = {
  [K in '$eq' | '$ne' | '$gt' | '$gte' | '$lt' | '$lte' | '$between']?: NonNullable<
    QueryWhereFieldOperatorMap<number>[K]
  >;
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
 * Value for a field comparison.
 */
export type QueryWhereFieldValue<T> = T | T[] | QueryWhereFieldOperatorMap<T> | QueryRaw;

/**
 * query filter array — used for `$and`, `$or`, `$not`, `$nor` operators.
 */
export type QueryWhereArray<E> = (QueryWhereMap<E> | QueryRaw)[];

/**
 * query filter.
 */
export type QueryWhere<E> = IdValue<E> | IdValue<E>[] | QueryWhereMap<E> | QueryWhereArray<E> | QueryRaw;

/**
 * direction for the sort.
 */
export type QuerySortDirection = -1 | 1 | 'asc' | 'desc';

/**
 * Distance metrics supported by vector similarity search.
 * - `cosine` — best for text/LLM embeddings (default)
 * - `l2` — Euclidean distance
 * - `inner` — inner (dot) product
 * - `l1` — Manhattan distance
 * - `hamming` — for binary vectors
 */
export type VectorDistance = 'cosine' | 'l2' | 'inner' | 'l1' | 'hamming';

/**
 * Vector similarity search options — used inside `$sort` on vector fields.
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
 * Accepted value for a field in `$sort` — either a direction or a vector similarity search.
 */
export type QuerySortValue = QuerySortDirection | QueryVectorSearch;

/**
 * Utility type to augment an entity with a projected distance field.
 * Use with `$project` in vector similarity queries.
 *
 * @example
 * ```ts
 * const results = await querier.findMany(Article, {
 *   $sort: { embedding: { $vector: queryVec, $project: 'similarity' } },
 * }) as WithDistance<Article, 'similarity'>[];
 * ```
 */
export type WithDistance<E, K extends string = '_distance'> = E & Record<K, number>;

/**
 * sort by map — supports field keys, JSON dot-notation paths, relation sort,
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
   * selection options.
   */
  $select?: QuerySelect<E>;

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
export type QueryUnique<E> = Pick<QueryOne<E>, '$select' | '$where'>;

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
   * the inserted IDs.
   */
  ids?: number[] | string[];
  /**
   * first inserted ID.
   */
  firstId?: number | string;
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

export interface QueryDialect {
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
   * create a new query context.
   */
  createContext(): QueryContext;
}

/**
 * Supported SQL dialect identifiers.
 */
export type SqlDialect = 'postgres' | 'cockroachdb' | 'mysql' | 'mariadb' | 'sqlite';

/**
 * Minimal dialect interface exposing escapeIdChar for SQL operations
 */
export interface SqlQueryDialect extends QueryDialect {
  /**
   * The SQL dialect name (postgres, mysql, mariadb, sqlite).
   */
  readonly dialect: SqlDialect;

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

/**
 * Supported aggregate operations.
 */
export type QueryAggregateOp = '$count' | '$sum' | '$avg' | '$min' | '$max';

/**
 * An aggregate function applied to a field.
 * Exactly one aggregate operation per entry.
 *
 * @example { $count: '*' }         → COUNT(*)
 * @example { $sum: 'amount' }      → SUM("amount")
 * @example { $avg: 'age' }         → AVG("age")
 */
export type QueryAggregateFn<E> =
  | { readonly $count: FieldKey<E> | '*' | 1 }
  | { readonly $sum: FieldKey<E> | '*' | 1 }
  | { readonly $avg: FieldKey<E> | '*' | 1 }
  | { readonly $min: FieldKey<E> | '*' | 1 }
  | { readonly $max: FieldKey<E> | '*' | 1 };

/**
 * Group-by map: keys set to `true` become GROUP BY columns;
 * keys with an aggregate function become computed columns.
 *
 * @example
 * ```ts
 * { status: true, count: { $count: '*' }, avgAge: { $avg: 'age' } }
 * // → SELECT "status", COUNT(*) AS "count", AVG("age") AS "avgAge" … GROUP BY "status"
 * ```
 */
export type QueryGroupMap<E> = {
  readonly [K in FieldKey<E>]?: true | QueryAggregateFn<E>;
} & {
  readonly [alias: string]: true | QueryAggregateFn<E> | undefined;
};

/**
 * HAVING clause — filters on aggregate results by alias name.
 *
 * @example { count: { $gt: 5 } }   → HAVING COUNT(*) > 5
 */
export type QueryHavingMap = {
  readonly [alias: string]: QueryWhereFieldValue<number> | undefined;
};

/**
 * Aggregate query — separate from `Query<E>` to keep return types honest.
 * Used exclusively with `querier.aggregate()`.
 *
 * @example
 * ```ts
 * querier.aggregate(User, {
 *   $group: { status: true, count: { $count: '*' }, avgAge: { $avg: 'age' } },
 *   $where: { deletedAt: { $isNull: true } },
 *   $having: { count: { $gt: 5 } },
 *   $sort: { count: -1 },
 * });
 * ```
 */
export type QueryAggregate<E> = {
  /**
   * Grouping and aggregate function definitions.
   */
  readonly $group: QueryGroupMap<E>;

  /**
   * Row-level filtering (applied before grouping — SQL WHERE).
   */
  readonly $where?: QueryWhere<E>;

  /**
   * Post-aggregation filtering (applied after grouping — SQL HAVING).
   */
  readonly $having?: QueryHavingMap;

  /**
   * Sort the aggregated results.
   * Accepts entity field keys plus arbitrary alias names used in `$group`.
   */
  readonly $sort?: QuerySortMap<E> & { readonly [alias: string]: QuerySortDirection | undefined };
} & QueryPager;
