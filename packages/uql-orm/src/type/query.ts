import type { FieldKey, IdKey, JsonFieldPaths, RelationKey, RelationTarget } from './entity.js';
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
 * To-one relations only: a parent holds many rows of a to-many, so there is no single value to order
 * it by, and joining one in would duplicate the parent instead. Order those inside `$populate`.
 */
type ToOneRelationKey<E> = { [K in RelationKey<E>]: IsMany<E[K]> extends true ? never : K }[RelationKey<E>];

/**
 * sort by map - supports field keys, JSON dot-notation paths (restricted to real JSON fields,
 * like `QueryWhereMap`), relation sort via nested objects, and vector similarity search on
 * `number[]` fields. `Vector` is what confines a vector search to the level the statement ranks:
 * the queried entity. A relation of it is joined in one row at a time, so there is nothing to rank
 * there - the SQL dialects throw, and MongoDB would quietly drop it, so this is its only guard.
 *
 * One mapped type over the three key sets rather than three intersected. The sets are disjoint - a
 * JSON path is dotted, and a field key cannot also be a relation key - and an assignability check
 * against an intersection is repeated per constituent, which made this the single most expensive
 * type in the package to check.
 */
export type QuerySortMap<E, Vector extends boolean = true> = {
  [K in FieldKey<E> | JsonFieldPaths<E> | ToOneRelationKey<E>]?: K extends RelationKey<E>
    ? QuerySortMap<RelationTarget<E[K]>, false>
    : K extends FieldKey<E>
      ? Vector extends true
        ? NonNullable<E[K]> extends readonly number[]
          ? QuerySortValue
          : QuerySortDirection
        : QuerySortDirection
      : QuerySortDirection;
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
 * picked with a SELECT before writing, so the page is portable rather than MySQL-only - and so a
 * vector `$sort` is as valid here as on a read: it ranks the settle query's rows, which has the
 * projection list to hold the distance. `$lock` is the clause that stays off these, declared on
 * {@link Query} instead.
 */
export type QuerySearch<E> = QueryFilter<E> & {
  /**
   * sorting options.
   */
  $sort?: QuerySortMap<E>;
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

  // `$where`, `$skip` and `$limit` are declared here rather than intersected in from
  // {@link QueryFilter} and {@link QueryPager}: an assignability check against an intersection is
  // repeated per constituent, and every query in a consuming codebase pays that. The two shapes are
  // pinned together in `queryStatementClauses.test-d.ts` so the copies cannot drift.

  /**
   * filtering options.
   */
  $where?: QueryWhere<E>;

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
 * `Query`'s clauses grouped by the shape of their value - what a parser reading one off the wire and
 * a validator checking a relation's own query both need, and what each used to enumerate for itself.
 * Declared beside the type they describe so the two cannot drift, and `satisfies` fails the build
 * rather than the runtime if a clause is ever renamed.
 *
 * `$lock` belongs to no group on purpose: it is the one clause neither a wire query nor a relation's
 * query accepts, so leaving it out is what excludes it from both.
 */
export const QUERY_OBJECT_CLAUSES = [
  '$select',
  '$populate',
  '$exclude',
  '$where',
  '$sort',
] as const satisfies readonly (keyof Query<unknown>)[];

export const QUERY_NUMBER_CLAUSES = ['$skip', '$limit'] as const satisfies readonly (keyof Query<unknown>)[];

export const QUERY_BOOLEAN_CLAUSES = ['$distinct'] as const satisfies readonly (keyof Query<unknown>)[];

/**
 * options to get a single record.
 */
export type QueryOne<E> = Except<Query<E>, '$limit'>;

/**
 * options to get an unique record.
 */
export type QueryUnique<E> = Pick<QueryOne<E>, '$select' | '$exclude' | '$populate' | '$where'>;

/**
 * The clauses that decide a row's shape, captured from the query as written: the field names
 * `$select` and `$exclude` list, the value those maps carry (a falsy one subtracts instead of
 * selecting, as it does at runtime, and a widened map is how a projection that is not statically
 * known announces itself), and the relation names `$populate` lists.
 *
 * Each is captured as a *key set* rather than as the map itself, which is what keeps the checks
 * intact: TypeScript skips excess-property checking on a naked type parameter, so a captured map
 * would take a typo'd key without a word, while a captured key set makes that typo fail its own
 * `FieldKey<E>` / `RelationKey<E>` constraint. Every other clause - `$where`, `$sort`, and each
 * populated relation's own query - stays the concrete {@link Query} it is today.
 * @internal
 */
type QueryProjection<E, S extends FieldKey<E>, V, X extends FieldKey<E>, P extends RelationKey<E>> = {
  $select?: { [K in S]?: V } | readonly QueryRaw[];
  $exclude?: { [K in X]?: V };
  $populate?: { [K in P]?: QueryPopulate<E>[K] };
};

/**
 * A {@link Query} whose projection is captured, so {@link QueryFindResult} can shape the row.
 */
export type QueryProjected<E, S extends FieldKey<E>, V, X extends FieldKey<E>, P extends RelationKey<E>> = Query<E> &
  QueryProjection<E, S, V, X, P>;

/**
 * A {@link QueryOne} whose projection is captured, so {@link QueryFindResult} can shape the row.
 */
export type QueryOneProjected<
  E,
  S extends FieldKey<E>,
  V,
  X extends FieldKey<E>,
  P extends RelationKey<E>,
> = QueryOne<E> & QueryProjection<E, S, V, X, P>;

/**
 * The keys a query comes back with, mirroring what the runtime projects: the fields a positive
 * `$select` names, or every field minus what a falsy `$select` entry or a truthy `$exclude` entry
 * subtracts, plus the relations `$populate` asked for. A positive `$select` wins outright, which is
 * why `$exclude` is only read on the branch where there is none.
 * @internal
 */
type ProjectedKeys<E, S, V, X, P> =
  | ([V] extends [false | 0] ? Exclude<FieldKey<E>, S> : [S] extends [never] ? Exclude<FieldKey<E>, X> : S)
  | P
  // Populating a relation keeps the id whatever the projection says, since the rows are assembled
  // by it (`selectFields` puts it back, as does MongoDB's `pipelineProjection`).
  | ([P] extends [never] ? never : NamedIdKey<E>);

/**
 * The id key when it can be named, and nothing when it cannot: {@link IdKey} widens to *every* field
 * for an entity whose id is neither branded nor called `id`/`_id`/`uuid`, and adding that back would
 * hand the caller a row claiming fields the query never fetched. Missing an id costs a `$select`
 * entry; promising absent fields is the bug this type exists to prevent.
 * @internal
 */
type NamedIdKey<E> = [FieldKey<E>] extends [IdKey<E>] ? never : IdKey<E>;

/**
 * Whether every entry of the captured map says the same thing: all selected, or all subtracted.
 * @internal
 */
type IsUniform<V> = [V] extends [true | 1] ? true : [V] extends [false | 0] ? true : false;

/**
 * A row of a find result: the entity narrowed to the fields the query projected, plus the relations
 * it populated - reading anything the query left out is a compile error rather than a silent
 * `undefined`. Modifiers are preserved, so an optional field stays optional. Name a projected row
 * with it where a helper has to take one: `QueryFindResult<User, 'id' | 'name'>`.
 *
 * The entity itself when the query projects nothing, when it uses a raw-projection array (columns,
 * not fields), and when the projection is not uniform - a `Query<E>` built elsewhere, or a map
 * mixing selected and subtracted entries, whose positive keys inference cannot recover. Relations
 * keep their declared type: narrowing them means capturing their queries as maps, which costs those
 * queries their own checks.
 */
export type QueryFindResult<
  E,
  S extends FieldKey<E> = never,
  // A whitelist by default, so the hand-written form reads `QueryFindResult<User, 'id' | 'name'>`.
  V = true,
  X extends FieldKey<E> = never,
  P extends RelationKey<E> = never,
> = [S | X] extends [never]
  ? E
  : IsUniform<V> extends true
    ? { [K in keyof E as K extends ProjectedKeys<E, S, V, X, P> ? K : never]: E[K] }
    : E;

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
