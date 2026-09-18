import type { FieldKey, JsonFieldPaths, RelationKey, RelationTarget, ToManyRelationKey, WrittenId } from './entity.js';
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
   * `updateMany`/`deleteMany` only: address every row of the table on purpose. Without it a bulk write
   * that names none - no `$where` and no `$limit` - is refused, since a forgotten filter and the whole
   * table look alike. The entity's own filters never count as naming one.
   */
  unfiltered?: boolean;
  /**
   * prefix the query with this.
   */
  prefix?: string;
  /**
   * automatically infer the prefix for the query.
   */
  autoPrefix?: boolean;
};

/**
 * Field selection - `{ name: true }` whitelists fields; relations go in `$populate`. Declared over
 * `F extends keyof E`, like every map keyed by an entity's members, so each key stays linked to its
 * property and an editor rename reaches it. `F` is also how a projection passes its captured key set.
 */
export type QuerySelect<E, F extends keyof E = FieldKey<E>, V = BooleanLike> = {
  [K in F]?: V;
};

/**
 * Accepted `$select` value: a field map, or raw SQL projections built with `raw()`
 * (e.g. ``[raw`*`, raw`LOG10(points)`.as('score')]``). The raw form is SQL-only.
 */
export type QuerySelectValue<E, Raw = QueryRaw> = QuerySelect<E> | readonly Raw[];

/**
 * Fields to exclude from the query result - `{ name: true }` blacklists fields.
 * Mutually exclusive with positive field selections in `$select`.
 */
export type QueryExclude<E> = QuerySelect<E>;

/**
 * relation population map.
 */
export type QueryPopulate<E, Raw = QueryRaw, R extends keyof E = RelationKey<E>> = {
  [K in R]?: BooleanLike | QueryPopulateRelationOptions<E[K], Raw>;
};

/**
 * The key a read carries its relation tallies under. One spelling for the type and the runtime that
 * fills it: they sit in different modules, so a drift would type-check and answer `undefined`.
 */
export const COUNT_RESULT_KEY = '_count';

/**
 * How many rows each named relation holds per parent, `true` for all of them or a filter to narrow
 * which ones count: a correlated count in the read's own statement, so no related row is loaded. Comes
 * back under `_count`, which keeps it clear of a relation of the same name `$populate` filled.
 */
export type QueryCount<E, Raw = QueryRaw, R extends keyof E = ToManyRelationKey<E>> = {
  [K in R]?: BooleanLike | QueryFilter<RelationTarget<E[K]>, Raw>;
};

/**
 * query conflict paths - subset of field keys used to detect upsert conflicts.
 */
export type QueryConflictPaths<E> = QuerySelect<E, FieldKey<E>, true>;

/**
 * Options to populate a relation declared as `V`, by its cardinality.
 */
export type QueryPopulateRelationOptions<V, Raw = QueryRaw> =
  IsMany<V> extends true
    ? RelationQuery<RelationTarget<V>, Raw>
    : QueryUnique<RelationTarget<V>, Raw> & { $required?: boolean };

/**
 * The per-request context parameterized filters read, set with `withContext(ctx, cb)`. An interface,
 * so its keys can be typed once: `declare module 'uql-orm' { interface UqlContext { tenantId: number } }`.
 */
export interface UqlContext {
  [key: string]: unknown;
}

/**
 * A filter's `$where` fragment: a plain fragment, or a function of the ambient {@link UqlContext}.
 * Return `undefined` when the condition can't resolve (see {@link FilterOptions.onMissing}).
 */
export type FilterWhere<E> = QueryWhere<E> | ((context: UqlContext | undefined) => QueryWhere<E> | undefined);

/**
 * What to do when a filter's condition returns `undefined`. `skip` omits it (convenience filters);
 * `throw` fails closed (the default for `security` filters).
 */
export type FilterOnMissing = 'skip' | 'throw';

/**
 * Authoring shape for `@Entity({ filters })` / `@Filter` / `defineFilter`.
 */
export type FilterOptions<E = unknown> = {
  readonly where: FilterWhere<E>;
  /** Applied to every query unless bypassed via `QueryOptions.filters`. Defaults to `true`. */
  readonly default?: boolean;
} & (
  | {
      readonly security?: false;
      /** What to do when {@link FilterOptions.where} returns `undefined`. Defaults to `skip`. */
      readonly onMissing?: FilterOnMissing;
    }
  | {
      /**
       * Row-level-security filter: always applied (ignores `QueryOptions.filters` bypass) and
       * AND-merged so a client `$where` on the same field can't override it. It fails closed.
       */
      readonly security: true;
      readonly onMissing?: 'throw';
    }
);

/**
 * direction for the sort.
 */
export type QuerySortDirection = -1 | 1 | 'asc' | 'desc';

/**
 * Accepted value for a field in `$sort` - either a direction or a vector similarity search.
 */
export type QuerySortValue = QuerySortDirection | QueryVectorSearch;

/**
 * Ordering parents by how many rows a to-many relation holds - "the ten users with the most posts".
 * The tally is computed per parent as a correlated count, never by loading the rows.
 */
export type QuerySortByCount = {
  $count: QuerySortDirection;
};

/**
 * Ordering by relevance to the `$text` at the root of `$where`, in either direction as any key sorts. The
 * object form also answers it under the name `$project` gives it, most relevant first unless `$order` says.
 */
export type QuerySortByText = {
  $text?: QuerySortDirection | { readonly $project: string; readonly $order?: QuerySortDirection };
};

/**
 * A row with the relevance a `$sort: { $text: { $project } }` names, which is not inferred:
 * `(await querier.findMany(Post, q)) as WithScore<Post, 'score'>[]`.
 */
export type WithScore<E, K extends string> = E & Record<K, number>;

/**
 * A sort by fields, JSON paths, a to-one relation's fields, a to-many's `$count`, or a vector distance or
 * `$text` relevance, which `Vector` confines to the queried entity. One mapped type over the key sets: an
 * intersection is checked once per member, which made this the costliest type to check.
 */
export type QuerySortMap<E, Vector extends boolean = true, K extends keyof E = FieldKey<E> | RelationKey<E>> = {
  [P in K]?: P extends RelationKey<E>
    ? // A to-many has no single value to order by, so what it offers instead is its own size.
      IsMany<E[P]> extends true
      ? QuerySortByCount
      : QuerySortMap<RelationTarget<E[P]>, false>
    : Vector extends true
      ? NonNullable<E[P]> extends readonly number[]
        ? QuerySortValue
        : QuerySortDirection
      : QuerySortDirection;
} & ([JsonFieldPaths<E>] extends [never] ? unknown : { [P in JsonFieldPaths<E>]?: QuerySortDirection }) &
  (Vector extends true ? QuerySortByText : unknown);

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
 * Which rows a statement addresses.
 */
export type QueryFilter<E, Raw = QueryRaw> = {
  /**
   * filtering options.
   */
  $where?: QueryWhere<E, Raw>;
};

/**
 * A filter plus the page `count` takes. No `$sort`: ordering picks *which* rows a page holds, never
 * how many, so a count that accepted one would promise an influence it cannot have.
 */
export type QueryPage<E, Raw = QueryRaw> = QueryFilter<E, Raw> & QueryPager;

/**
 * A filter plus the ordering and page `updateMany`/`deleteMany` take. Both settle the
 * rows they address with a SELECT first, so the page is portable rather than MySQL-only, and a
 * vector `$sort` is as valid here as on a read: it ranks the settle query's rows, which has the
 * projection list to hold the distance. `$lock` stays off these, declared on {@link Query} instead.
 */
export type QuerySearch<E, Raw = QueryRaw> = QueryPage<E, Raw> & {
  /**
   * sorting options.
   */
  $sort?: QuerySortMap<E>;
};

/**
 * query options.
 */
export type Query<E, Raw = QueryRaw> = {
  /**
   * field selection - `{ name: true }` whitelists fields, or raw SQL projections
   * (``[raw`LOG10(points)`.as('score')]``, SQL dialects only - MongoDB rejects the raw-array form).
   * Mutually exclusive with `$exclude`.
   */
  $select?: QuerySelectValue<E, Raw>;

  /**
   * relation population options.
   */
  $populate?: QueryPopulate<E, Raw>;

  /**
   * how many rows each named relation holds, under `_count` on every row. See {@link QueryCount}.
   */
  $count?: QueryCount<E, Raw>;

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
   * Lock the rows this query returns, `SELECT ... FOR UPDATE`, inside an open transaction: outside one
   * it is refused, since the lock would drop before the rows are used. SQL only, and not the SQLite family.
   */
  $lock?: QueryLock;

  /**
   * How many candidates an ANN index explores before ranking a vector search, in that index's own units
   * (`hnsw.ef_search`, `numCandidates`...); ignored where the search is exact. Postgres needs a transaction.
   */
  $candidates?: number;

  // `$where`, `$skip` and `$limit` are declared here rather than intersected in from
  // {@link QueryFilter} and {@link QueryPager}: an assignability check against an intersection is
  // repeated per constituent, and every query in a consuming codebase pays that. The two shapes are
  // pinned together in `queryStatementClauses.test-d.ts` so the copies cannot drift.

  /**
   * filtering options.
   */
  $where?: QueryWhere<E, Raw>;

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
 * A {@link Query} as it travels as JSON, which a `raw` SQL fragment cannot: what the browser client takes,
 * and what an RPC contract (tRPC, oRPC, TanStack Start) declares as its input.
 */
export type WireQuery<E> = Query<E, never>;

/**
 * `Query`'s clauses grouped by the shape of their value, for the wire parser and the relation query
 * check alike; `satisfies` keeps them in step with `Query`.
 */
export const QUERY_OBJECT_CLAUSES = [
  '$select',
  '$populate',
  '$exclude',
  '$where',
  '$sort',
] as const satisfies readonly (keyof Query<unknown>)[];

/**
 * Object clauses only the statement itself takes: a populated relation's rows keep their declared type,
 * so a `$count` inside one would have no `_count` to land in.
 */
export const QUERY_ROOT_OBJECT_CLAUSES = ['$count'] as const satisfies readonly (keyof Query<unknown>)[];

export const QUERY_NUMBER_CLAUSES = ['$skip', '$limit'] as const satisfies readonly (keyof Query<unknown>)[];

/**
 * Number clauses only the statement itself takes - the numeric mirror of {@link QUERY_ROOT_OBJECT_CLAUSES}.
 * `$candidates` tunes the index behind a vector search, and a vector search only ever ranks the rows
 * the statement returns, so a relation's own query has nothing to tune.
 */
export const QUERY_ROOT_NUMBER_CLAUSES = ['$candidates'] as const satisfies readonly (keyof Query<unknown>)[];

export const QUERY_BOOLEAN_CLAUSES = ['$distinct'] as const satisfies readonly (keyof Query<unknown>)[];

/** The clauses that describe the statement, which a populated relation's own query refuses by name. */
export const QUERY_STATEMENT_CLAUSES = [
  '$lock',
  ...QUERY_ROOT_OBJECT_CLAUSES,
  ...QUERY_ROOT_NUMBER_CLAUSES,
] as const satisfies readonly (keyof Query<unknown>)[];

type RelationClause = (
  | typeof QUERY_OBJECT_CLAUSES
  | typeof QUERY_NUMBER_CLAUSES
  | typeof QUERY_BOOLEAN_CLAUSES
)[number];

/**
 * A populated relation's own query: the clause groups its runtime check accepts, so the two cannot
 * drift, and a clause added to {@link Query} stays off it until it joins one of them.
 */
export type RelationQuery<E = object, Raw = QueryRaw> = Pick<Query<E, Raw>, RelationClause> & {
  $required?: boolean;
};

/**
 * options to get a single record.
 */
export type QueryOne<E, Raw = QueryRaw> = Except<Query<E, Raw>, '$limit'>;

/**
 * options to get an unique record.
 */
export type QueryUnique<E, Raw = QueryRaw> = Pick<QueryOne<E, Raw>, '$select' | '$exclude' | '$populate' | '$where'>;

/**
 * The clauses that shape a row, captured as key sets rather than maps: a naked type parameter skips
 * excess-property checks, while a key set fails its own constraint on a typo.
 * @internal
 */
type QueryProjection<
  E,
  S extends FieldKey<E>,
  V,
  X extends FieldKey<E>,
  P extends RelationKey<E>,
  C extends RelationKey<E>,
  Raw = QueryRaw,
> = {
  $select?: QuerySelect<E, S, V> | readonly Raw[];
  $exclude?: QuerySelect<E, X, V>;
  $populate?: QueryPopulate<E, Raw, P>;
  // Narrowing the captured names to the to-many ones leaves a to-one relation no key here at all,
  // so counting one is an excess property rather than a value to check.
  $count?: QueryCount<E, Raw, C & ToManyRelationKey<E>>;
};

/**
 * A {@link Query} whose projection is captured, so {@link QueryFindResult} can shape the row.
 */
export type QueryProjected<
  E,
  S extends FieldKey<E>,
  V,
  X extends FieldKey<E>,
  P extends RelationKey<E>,
  C extends RelationKey<E> = never,
  Raw = QueryRaw,
> = Query<E, Raw> & QueryProjection<E, S, V, X, P, C, Raw>;

/**
 * A {@link QueryOne} whose projection is captured, so {@link QueryFindResult} can shape the row.
 */
export type QueryOneProjected<
  E,
  S extends FieldKey<E>,
  V,
  X extends FieldKey<E>,
  P extends RelationKey<E>,
  C extends RelationKey<E> = never,
  Raw = QueryRaw,
> = QueryOne<E, Raw> & QueryProjection<E, S, V, X, P, C, Raw>;

/**
 * The keys a query comes back with, as the runtime projects them: a positive `$select`'s, or every
 * field minus what `$select` or `$exclude` subtracts, plus the populated relations.
 * @internal
 */
type ProjectedKeys<E, S, V, X, P> =
  | ([V] extends [false | 0] ? Exclude<FieldKey<E>, S> : [S] extends [never] ? Exclude<FieldKey<E>, X> : S)
  | P;

/**
 * Whether every entry of the captured map says the same thing: all selected, or all subtracted.
 * @internal
 */
type IsUniform<V> = [V] extends [true | 1] ? true : [V] extends [false | 0] ? true : false;

/**
 * A find's row: the entity narrowed to what the query projected and populated, so reading anything
 * else does not compile. The entity itself where the projection is raw, absent or not uniform.
 * @example `QueryFindResult<User, 'id' | 'name'>`
 */
export type QueryFindResult<
  E,
  S extends FieldKey<E> = never,
  // A whitelist by default, so the hand-written form reads `QueryFindResult<User, 'id' | 'name'>`.
  V = true,
  X extends FieldKey<E> = never,
  P extends RelationKey<E> = never,
  C extends RelationKey<E> = never,
> = QueryProjectedRow<E, S, V, X, P, C> & CountedRelations<C>;

/**
 * The `_count` a query asked for, or an inert intersection member when it asked for none - so a read
 * without `$count` keeps exactly the row type it had.
 */
type CountedRelations<C extends PropertyKey> = [C] extends [never]
  ? unknown
  : { [K in typeof COUNT_RESULT_KEY]: { [R in C]: number } };

/** @internal */
type QueryProjectedRow<
  E,
  S extends FieldKey<E>,
  V,
  X extends FieldKey<E>,
  P extends RelationKey<E>,
  C extends RelationKey<E>,
> = [S | X] extends [never]
  ? E
  : IsUniform<V> extends true
    ? [PopulatedToMany<E, P>] extends [never]
      ? // `Pick`, not a key remap: an entity keyed by an index signature - a content type defined at
        // runtime - has `string` for its keys, and a remap keeps no literal one, so every projection
        // over one came back as `{}`.
        Pick<E, ProjectedKeys<E, S, V, X, P> & keyof E>
      : // A populated to-many is always a list, empty where the parent has no children, so it maps
        // and counts without a guard. Only that promotion needs a second member, and only a query
        // that populates one pays for it; every other key keeps the modifier the entity declared,
        // a to-one relation included, since a join that finds no row leaves it absent.
        Pick<E, Exclude<ProjectedKeys<E, S, V, X, P>, PopulatedToMany<E, P>> & keyof E> & {
          [K in PopulatedToMany<E, P>]-?: NonNullable<E[K]>;
        }
    : E;

/** The to-many relations a query populated, which come back as lists rather than as optional ones. */
type PopulatedToMany<E, P> = Extract<P, ToManyRelationKey<E>>;

/**
 * stringified query.
 */
export type QueryStringified = {
  [K in keyof Query<unknown>]?: string;
};

/** What upserting one row reports. `created` is only knowable for a single statement, so a batch has none. */
export type QueryUpsertOneResult<E> = {
  readonly id?: WrittenId<E>;
  readonly changes?: number;
  /** Whether the record was created (`true`) or updated (`false`), where the dialect can tell. */
  readonly created?: boolean;
};

/**
 * What upserting many rows reports. `ids` is payload-aligned like an insert's, so it zips with the
 * rows that were passed, and carries a composite key as the map naming it.
 */
export type QueryUpsertManyResult<E> = {
  readonly ids: (WrittenId<E> | undefined)[];
  readonly changes?: number;
};

/**
 * result of an update operation, as the driver reports it - which is what `run` hands back, where
 * there is no entity to name the ids against. The `QueryUpsert*Result` pair is the entity-level shape.
 */
export type QueryUpdateResult = {
  /**
   * number of affected records.
   */
  changes?: number;
  /**
   * the IDs the statement reported, in payload order, `undefined` where it reported none for that
   * row - a MongoDB upsert names only the documents it inserted. Exact on `'returning'` dialects;
   * inferred from the driver header on the others (see {@link InsertIdSource}), and absent
   * altogether when the header reports nothing.
   */
  ids?: (PrimaryKey | undefined)[];
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
