import type { FieldKey, JsonFieldPaths, RelationKey, RelationTarget } from './entity.js';
import type { QueryLock } from './queryLock.js';
import type { QueryRaw } from './queryRaw.js';
import type { QueryWhere } from './queryWhere.js';
import type { BooleanLike, Except, IsMany, PrimaryKey } from './utility.js';
import type { QueryVectorSearch } from './vector.js';

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
 * Query field selection - `{ name: true }` whitelists specific fields. Fields only: a relation is a
 * sub-query rather than a projection flag, and a whitelist naming one could not say whether the
 * scalars come with it. Relations go in `$populate`.
 */
export type QuerySelect<E> = {
  [K in FieldKey<E>]?: BooleanLike;
};

/**
 * Accepted `$select` value: a field map, or raw SQL projections built with `raw()`
 * (e.g. `[raw('*'), raw('LOG10(points)', 'score')]`). The raw form is SQL-only.
 */
export type QuerySelectValue<E> = QuerySelect<E> | readonly QueryRaw[];

/**
 * Fields to exclude from the query result - `{ name: true }` blacklists fields.
 * Mutually exclusive with positive field selections in `$select`.
 */
export type QueryExclude<E> = QuerySelect<E>;

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
 * Options to populate a relation declared as `V`, by its cardinality.
 */
export type QueryPopulateRelationOptions<V> = (IsMany<V> extends true
  ? // `$lock` is statement-level, so it is excluded here rather than being silently ignored per
    // relation. `QueryUnique` is a `Pick` and already leaves it out.
    Except<Query<RelationTarget<V>>, '$lock'>
  : QueryUnique<RelationTarget<V>>) & {
  $required?: boolean;
};

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
 * direction for the sort.
 */
export type QuerySortDirection = -1 | 1 | 'asc' | 'desc';

/**
 * Accepted value for a field in `$sort` - either a direction or a vector similarity search.
 */
export type QuerySortValue = QuerySortDirection | QueryVectorSearch;

/**
 * sort by map - supports field keys, JSON dot-notation paths (restricted to real JSON fields,
 * like `QueryWhereMap`), relation sort via nested objects, and vector similarity search on
 * `number[]` fields.
 */
export type QuerySortMap<E, Vector extends boolean = true> = {
  [K in FieldKey<E>]?: Vector extends true
    ? NonNullable<E[K]> extends readonly number[]
      ? QuerySortValue
      : QuerySortDirection
    : QuerySortDirection;
} & {
  [P in JsonFieldPaths<E>]?: QuerySortDirection;
} & {
  // To-one only: a parent holds many rows of a to-many, so there is no single value to order it by,
  // and joining one in would duplicate the parent instead. Order those inside `$populate`.
  // A vector search ranks the queried rows, so it belongs to the statement, not to a relation of it.
  [K in RelationKey<E> as IsMany<E[K]> extends true ? never : K]?: QuerySortMap<RelationTarget<E[K]>, false>;
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
 * Which rows a statement addresses. `count` takes exactly this: how many rows match is all a count
 * can answer, so an ordering or a page on it is a clause it could only drop or choke on.
 */
export type QueryFilter<E> = {
  /**
   * filtering options.
   */
  $where?: QueryWhere<E>;
};

/**
 * A filter plus the ordering and page `updateMany`/`deleteMany` take. Both settle the rows they
 * picked before writing, so the page is portable rather than MySQL-only.
 *
 * `$sort` excludes vector search here for the reason `$lock` is declared on {@link Query} instead:
 * a vector search ranks rows into a projected distance column, and only a SELECT has a projection
 * list to hold one. Passing `QuerySortMap` its `Vector = false` is what keeps it off these.
 */
export type QuerySearch<E> = QueryFilter<E> & {
  /**
   * sorting options.
   */
  $sort?: QuerySortMap<E, false>;
} & QueryPager;

/**
 * query options.
 */
export type Query<E> = {
  /**
   * field selection - `{ name: true }` whitelists fields, or raw SQL projections
   * (`[raw('LOG10(points)', 'score')]`, SQL dialects only - MongoDB rejects the raw-array form).
   * Mutually exclusive with `$exclude`.
   */
  $select?: QuerySelectValue<E>;

  /**
   * relation population options.
   */
  $populate?: QueryPopulate<E>;

  /**
   * field exclusion - `{ name: true }` blacklists fields. Mutually exclusive with positive `$select`.
   * Keys a relation is assembled from (a joined row's primary key, a to-many's foreign key) are kept
   * regardless, since subtracting them would leave the relation unfilled.
   */
  $exclude?: QueryExclude<E>;

  /**
   * sorting options, vector similarity search included: a SELECT is the one statement with a
   * projection list to hold the distance such a search computes.
   */
  $sort?: QuerySortMap<E>;

  /**
   * whether to return only distinct rows.
   */
  $distinct?: boolean;

  /**
   * take a row-level lock on the rows this query returns (`SELECT ... FOR UPDATE`). Needs an open
   * transaction: outside one the statement commits and drops the lock before the caller can act on
   * the rows, so it is rejected rather than emitted. Locks only the queried entity, never anything
   * reached through `$populate`. SQL only; MongoDB and the SQLite family reject it.
   *
   * Declared here rather than on {@link QuerySearch}, which `update`/`delete` take: that placement
   * is what keeps the clause off those statements at the type level.
   */
  $lock?: QueryLock;
} & QueryFilter<E> &
  QueryPager;

/**
 * options to get a single record.
 */
export type QueryOne<E> = Except<Query<E>, '$limit'>;

/**
 * options to get an unique record.
 */
export type QueryUnique<E> = Pick<QueryOne<E>, '$select' | '$exclude' | '$populate' | '$where'>;

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
