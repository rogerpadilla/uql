import type { FieldKey, IdKey, JsonFieldPaths, RelationKey, RelationTarget, WrittenId } from './entity.js';
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
export type QuerySelectValue<E> = QuerySelect<E> | readonly QueryRaw[];

/**
 * Fields to exclude from the query result - `{ name: true }` blacklists fields.
 * Mutually exclusive with positive field selections in `$select`.
 */
export type QueryExclude<E> = QuerySelect<E>;

/**
 * relation population map.
 */
export type QueryPopulate<E, R extends keyof E = RelationKey<E>> = {
  [K in R]?: BooleanLike | QueryPopulateRelationOptions<E[K]>;
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
export type QueryCount<E, R extends keyof E = ToManyRelationKey<E>> = {
  [K in R]?: BooleanLike | QueryFilter<RelationTarget<E[K]>>;
};

/**
 * query conflict paths - subset of field keys used to detect upsert conflicts.
 */
export type QueryConflictPaths<E> = QuerySelect<E, FieldKey<E>, true>;

/**
 * Options to populate a relation declared as `V`, by its cardinality.
 */
export type QueryPopulateRelationOptions<V> =
  IsMany<V> extends true ? RelationQuery<RelationTarget<V>> : QueryUnique<RelationTarget<V>> & { $required?: boolean };

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

/** The relation names a parent holds many rows of, which a populated query fills with a list. */
type ToManyRelationKey<E> = Exclude<RelationKey<E>, ToOneRelationKey<E>>;

/**
 * Ordering parents by how many rows a to-many relation holds - "the ten users with the most posts".
 * The tally is computed per parent as a correlated count, never by loading the rows.
 */
export type QuerySortByCount = {
  $count: QuerySortDirection;
};

/**
 * sort by map - supports field keys, JSON dot-notation paths (restricted to real JSON fields,
 * like `QueryWhere`), relation sort via nested objects, and vector similarity search on
 * `number[]` fields. `Vector` is what confines a vector search to the level the statement ranks:
 * the queried entity. A relation of it is joined in one row at a time, so there is nothing to rank
 * there - the SQL dialects throw, and MongoDB would quietly drop it, so this is its only guard.
 *
 * One mapped type over the three key sets rather than three intersected. The sets are disjoint - a
 * JSON path is dotted, and a field key cannot also be a relation key - and an assignability check
 * against an intersection is repeated per constituent, which made this the single most expensive
 * type in the package to check.
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
} & ([JsonFieldPaths<E>] extends [never] ? unknown : { [P in JsonFieldPaths<E>]?: QuerySortDirection });

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
export type QueryFilter<E> = {
  /**
   * filtering options.
   */
  $where?: QueryWhere<E>;
};

/**
 * A filter plus the page `count` takes. No `$sort`: ordering picks *which* rows a page holds, never
 * how many, so a count that accepted one would promise an influence it cannot have.
 */
export type QueryPage<E> = QueryFilter<E> & QueryPager;

/**
 * A filter plus the ordering and page `updateMany`/`deleteMany` take. Both settle the
 * rows they address with a SELECT first, so the page is portable rather than MySQL-only, and a
 * vector `$sort` is as valid here as on a read: it ranks the settle query's rows, which has the
 * projection list to hold the distance. `$lock` stays off these, declared on {@link Query} instead.
 */
export type QuerySearch<E> = QueryPage<E> & {
  /**
   * sorting options.
   */
  $sort?: QuerySortMap<E>;
};

/**
 * query options.
 */
export type Query<E> = {
  /**
   * field selection - `{ name: true }` whitelists fields, or raw SQL projections
   * (``[raw`LOG10(points)`.as('score')]``, SQL dialects only - MongoDB rejects the raw-array form).
   * Mutually exclusive with `$exclude`.
   */
  $select?: QuerySelectValue<E>;

  /**
   * relation population options.
   */
  $populate?: QueryPopulate<E>;

  /**
   * how many rows each named relation holds, under `_count` on every row. See {@link QueryCount}.
   */
  $count?: QueryCount<E>;

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

  /**
   * how many candidates an approximate-nearest-neighbour index explores before ranking, for a vector
   * search. Higher trades speed for recall; the default is whatever the engine's own is, which is
   * tuned for speed. Ignored where the search is exact (SQLite, libSQL and Turso scan every row) and
   * where the field carries no ANN index, since there is nothing to widen.
   *
   * The units are the index's, not UQL's, so the number is not comparable across index types: it
   * becomes `hnsw.ef_search` or `ivfflat.probes` on Postgres, `mhnsw_ef_search` on MariaDB, and
   * `numCandidates` on MongoDB Atlas. On Postgres it needs an open transaction, since a `SET LOCAL`
   * outside one applies to nothing.
   */
  $candidates?: number;

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
 * `$lock` is only in {@link QUERY_STATEMENT_CLAUSES}: neither a wire query nor a relation's query
 * accepts it.
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
export type RelationQuery<E = object> = Pick<Query<E>, RelationClause> & {
  $required?: boolean;
};

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
type QueryProjection<
  E,
  S extends FieldKey<E>,
  V,
  X extends FieldKey<E>,
  P extends RelationKey<E>,
  C extends RelationKey<E>,
> = {
  $select?: QuerySelect<E, S, V> | readonly QueryRaw[];
  $exclude?: QuerySelect<E, X, V>;
  $populate?: QueryPopulate<E, P>;
  // Narrowing the captured names to the to-many ones leaves a to-one relation no key here at all,
  // so counting one is an excess property rather than a value to check.
  $count?: QueryCount<E, C & ToManyRelationKey<E>>;
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
> = Query<E> & QueryProjection<E, S, V, X, P, C>;

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
> = QueryOne<E> & QueryProjection<E, S, V, X, P, C>;

/**
 * The keys a query comes back with, mirroring what the runtime projects: the fields a positive
 * `$select` names, or every field minus what a falsy `$select` entry or a truthy `$exclude` entry
 * subtracts, plus the relations `$populate` asked for. A positive `$select` wins outright, which is
 * why `$exclude` is only read on the branch where there is none.
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

/**
 * What upserting one row reports, against the entity rather than the driver.
 *
 * `created` is here and not on {@link QueryUpsertManyResult} because it is only ever knowable for a
 * single statement: a batch's `affectedRows` is a weighted sum on the dialects that report one at
 * all, and a batch of mixed shapes is several statements.
 */
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
