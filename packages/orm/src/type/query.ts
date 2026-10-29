import type {
  FieldKey,
  FieldKeyOf,
  JsonFieldPaths,
  MethodKey,
  RelationKey,
  RelationTarget,
  ToManyRelationKey,
  WrittenId,
} from './entity.js';
import type { QueryLock } from './queryLock.js';
import type { QuerySql } from './querySql.js';
import type { QueryWhere } from './queryWhere.js';
import type { BooleanLike, Except, IsMany, PrimaryKey } from './utility.js';
import type { QueryVectorQuery, QueryVectorSearch } from './vector.js';

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
};

/**
 * What a statement is rendered with, on top of the options its caller passed. Kept apart from
 * {@link QueryOptions} because that one is public - it is the third argument of every querier method -
 * and none of this is a caller's to set: an alias is the dialect's to choose and to spell.
 */
export type QueryRenderOptions = QueryOptions & {
  /** The alias columns are read off, escaped by the dialect unless {@link escapedPrefix} spells it. */
  prefix?: string;
  /**
   * The prefix already written out, for the one caller whose row is not an identifier: a trigger reads
   * `NEW."col"`, where `NEW` is a record the engine declares, and quoting it names a table that is not
   * in scope. Defaults to {@link prefix} escaped.
   */
  escapedPrefix?: string;
  /** Whether to infer the alias where none is given. */
  autoPrefix?: boolean;
};

/**
 * Field selection - `{ name: true }` whitelists fields; relations go in `$populate`. Declared over
 * `F extends keyof E`, like every map keyed by an entity's members, so each key stays linked to its
 * property and an editor rename reaches it.
 */
export type QuerySelect<E, F extends keyof E = FieldKey<E>, V = BooleanLike> = {
  [K in F]?: V;
};

/**
 * Accepted `$select` value: a field map, or raw SQL projections built with `sql()`
 * (e.g. ``[sql`*`, sql`LOG10(points)`.as('score')]``). The raw form is SQL-only.
 */
export type QuerySelectValue<E, Sql = QuerySql> = QuerySelect<E> | readonly Sql[];

/**
 * relation population map.
 */
export type QueryPopulate<E, Sql = QuerySql, R extends keyof E = RelationKey<E>> = {
  [K in R]?: BooleanLike | QueryPopulateRelationOptions<E[K], Sql>;
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
export type QueryCount<E, Sql = QuerySql, R extends keyof E = ToManyRelationKey<E>> = {
  [K in R]?: BooleanLike | QueryFilter<RelationTarget<E[K]>, Sql>;
};

/** The fields of a unique key an upsert finds a row by, `{ email: true }`, as `$select` names them. */
export type QueryConflictKeys<E> = QuerySelect<E, FieldKey<E>, true>;

/**
 * The rows an upsert writes: a row `$conflict`'s keys find, `{ email: true }`, takes the update where it matches
 * `$where`, as `updateMany` reads one, `{ status: ['done', 'failed'] }`, and stays as it is elsewhere; the rest insert.
 */
export type QueryUpsert<E, Sql = QuerySql> = QueryFilter<E, Sql> & { readonly $conflict: QueryConflictKeys<E> };

/**
 * Options to populate a relation declared as `V`, by its cardinality.
 */
export type QueryPopulateRelationOptions<V, Sql = QuerySql> =
  IsMany<V> extends true
    ? RelationQuery<RelationTarget<V>, Sql>
    : QueryUnique<RelationTarget<V>, Sql> & { $required?: boolean };

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
 * Authoring shape for `@Entity({ filters })` and `defineEntity`'s `.filters()`.
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
 * direction for the sort, and where nulls land in it.
 *
 * Without a placement, engines disagree: Postgres sorts nulls last on `asc` and the rest sort them first,
 * so only an explicit placement is portable. Engines with no `NULLS FIRST/LAST`
 * emulate it with a leading term, which no index can serve, which is why it is asked for and never
 * applied by default.
 */
export type QuerySortDirection = -1 | 1 | 'asc' | 'desc' | QuerySortNullsDirection;

/** A {@link QuerySortDirection} stating where nulls land. */
export type QuerySortNullsDirection = 'ascNullsFirst' | 'ascNullsLast' | 'descNullsFirst' | 'descNullsLast';

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
 * Ordering parents by the row of a to-many nearest a vector, per vector field: its distance is the
 * smallest of theirs. Nothing to `$project`, since no one row of the parent's answers under it. Never
 * where the target has no vector, since an empty map would admit any value at all.
 */
export type QuerySortByNearest<E> = [FieldKeyOf<E, readonly number[]>] extends [never]
  ? never
  : { [P in FieldKeyOf<E, readonly number[]>]?: QueryVectorQuery };

/**
 * Ordering by relevance to the `$text` at the root of `$where`, in either direction as any key sorts. The
 * object form also answers it under the name `$project` gives it, most relevant first unless `$order` says.
 */
export type QuerySortByText = {
  $text?: QuerySortDirection | { readonly $project: string; readonly $order?: QuerySortDirection };
};

/**
 * A sort by fields, JSON paths, a to-one relation's fields, a to-many's `$count` or nearest row, a vector
 * distance, or - where `Root` says it sorts the queried entity itself, not a relation's rows - a `$text`
 * relevance or a distance it projects. One mapped type over the key sets: an intersection is checked once
 * per member, which made this the costliest.
 */
export type QuerySortMap<E, Root extends boolean = true, K extends keyof E = FieldKey<E> | RelationKey<E>> = {
  [P in K]?: P extends RelationKey<E>
    ? // A to-many has no single value to order by, so what it offers instead is its size or nearest row.
      IsMany<E[P]> extends true
      ? QuerySortByCount | QuerySortByNearest<RelationTarget<E[P]>>
      : QuerySortMap<RelationTarget<E[P]>, false>
    : NonNullable<E[P]> extends readonly number[]
      ? Root extends true
        ? QuerySortValue
        : QuerySortDirection | QueryVectorQuery
      : QuerySortDirection;
} & ([JsonFieldPaths<E>] extends [never] ? unknown : { [P in JsonFieldPaths<E>]?: QuerySortDirection }) &
  (Root extends true ? QuerySortByText : unknown);

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
export type QueryFilter<E, Sql = QuerySql> = {
  /**
   * filtering options.
   */
  $where?: QueryWhere<E, Sql>;
};

/**
 * A filter plus the page `count` takes. No `$sort`: ordering picks *which* rows a page holds, never
 * how many, so a count that accepted one would promise an influence it cannot have.
 */
export type QueryPage<E, Sql = QuerySql> = QueryFilter<E, Sql> & QueryPager;

/**
 * A filter plus the ordering and page `updateMany`/`deleteMany` take. Both settle the
 * rows they address with a SELECT first, so the page is portable rather than MySQL-only, and a
 * vector `$sort` is as valid here as on a read: it ranks the settle query's rows, which has the
 * projection list to hold the distance. `$lock` stays off these, declared on {@link Query} instead.
 */
export type QuerySearch<E, Sql = QuerySql> = QueryPage<E, Sql> & {
  /**
   * sorting options.
   */
  $sort?: QuerySortMap<E>;
};

/**
 * query options.
 */
export type Query<E, Sql = QuerySql> = {
  /**
   * field selection - `{ name: true }` whitelists fields, `{ body: false }` leaves fields out, or raw SQL
   * projections (``[sql`LOG10(points)`.as('score')]``, SQL dialects only - MongoDB rejects the raw-array form).
   * A map with a positive entry selects those alone. Keys a relation is assembled from (a joined row's primary
   * key, a to-many's foreign key) are read regardless, since leaving them out would leave the relation unfilled.
   */
  $select?: QuerySelectValue<E, Sql>;

  /**
   * relation population options.
   */
  $populate?: QueryPopulate<E, Sql>;

  /**
   * how many rows each named relation holds, under `_count` on every row. See {@link QueryCount}.
   */
  $count?: QueryCount<E, Sql>;

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
  $where?: QueryWhere<E, Sql>;

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
 * A {@link Query} as it travels as JSON, which a `sql` SQL fragment cannot: what the browser client takes,
 * and what an RPC contract (tRPC, oRPC, TanStack Start) declares as its input.
 */
export type WireQuery<E> = Query<E, never>;

/**
 * The type of a clause's value, and where the clause may appear: a `relation` clause is also allowed in a
 * populated relation's own query, a `statement` clause only in the statement itself, and a `wire: false`
 * clause never over HTTP.
 */
export type QueryClause = {
  readonly value: 'object' | 'number' | 'boolean' | 'string';
  readonly scope: 'relation' | 'statement';
  readonly wire?: false;
};

/**
 * Every clause of `Query` and `QueryKeyset`, read by both the wire parser and the relation query check. It
 * must cover both types, so a clause added to either fails to compile until it is declared here.
 */
export const QUERY_CLAUSES = {
  $select: { value: 'object', scope: 'relation' },
  $populate: { value: 'object', scope: 'relation' },
  $where: { value: 'object', scope: 'relation' },
  $sort: { value: 'object', scope: 'relation' },
  $skip: { value: 'number', scope: 'relation' },
  $limit: { value: 'number', scope: 'relation' },
  $distinct: { value: 'boolean', scope: 'relation' },
  // Statement only: tallies are read for the statement's rows, never for a populated relation's.
  $count: { value: 'object', scope: 'statement' },
  // A vector search ranks only the statement's rows, so a relation's own query has nothing for it to tune.
  $candidates: { value: 'number', scope: 'statement' },
  // Each request commits on its own, so a lock taken over HTTP would be released before its response.
  $lock: { value: 'object', scope: 'statement', wire: false },
  // Statement only: keyset paging per parent of a populated relation is not supported.
  $after: { value: 'string', scope: 'statement' },
  $before: { value: 'string', scope: 'statement' },
} as const satisfies { readonly [K in keyof Query<unknown> | keyof QueryKeyset<unknown>]-?: QueryClause };

type QueryClauseKey = keyof typeof QUERY_CLAUSES;

/** The keys of the `QUERY_CLAUSES` entries that match `Shape`, such as `{ scope: 'relation' }`. */
export type QueryClauseOf<Shape extends Partial<QueryClause>> = {
  [K in QueryClauseKey]: (typeof QUERY_CLAUSES)[K] extends Shape ? K : never;
}[QueryClauseKey];

/**
 * A populated relation's own query: the clauses {@link QUERY_CLAUSES} gives the `relation` scope. Its runtime
 * check reads the same table, so the two cannot drift.
 */
export type RelationQuery<E = object, Sql = QuerySql> = Pick<Query<E, Sql>, QueryClauseOf<{ scope: 'relation' }>> & {
  $required?: boolean;
};

/**
 * options to get a single record.
 */
export type QueryOne<E, Sql = QuerySql> = Except<Query<E, Sql>, '$limit'>;

/**
 * options to get an unique record.
 */
export type QueryUnique<E, Sql = QuerySql> = Pick<QueryOne<E, Sql>, '$select' | '$populate' | '$where'>;

/**
 * A query as a read captures it: `Q` is inferred from the literal, so the row sees every clause at every
 * depth, while the parameter is `Concrete` itself, so a typo'd key fails its excess-property check at any
 * depth too. A query assembled elsewhere, typed `Concrete`, captures nothing and reads the whole entity.
 */
export type Captured<Concrete, Q> = [Concrete] extends [Q] ? Q : Concrete;

/**
 * The query `findManyPage` takes: a {@link Query} paged by cursor instead of offset, so it has no `$skip` and
 * `$limit` is the page size. `$after` reads the page after a cursor, `$before` the page before it.
 */
export type QueryKeyset<E, Sql = QuerySql> = Except<Query<E, Sql>, '$skip'> & {
  /** The page size, required here although `Query` leaves it optional. */
  $limit: number;
  /** A page's `endCursor`, to read the rows after it. */
  $after?: string;
  /** A page's `startCursor`, to read the rows before it. */
  $before?: string;
};

/**
 * One page of `findManyPage`. Each cursor is opaque, and absent on an empty page. The flag in the reading
 * direction is exact. The other one only says whether the page was read from a cursor (`hasPrevPage` forward,
 * `hasNextPage` backward), since checking for rows on that side would cost another statement.
 */
export type CursorPage<T> = {
  readonly items: T[];
  /** Pass as `$before` to read the page before this one. */
  readonly startCursor?: string;
  /** Pass as `$after` to read the page after this one. */
  readonly endCursor?: string;
  readonly hasNextPage: boolean;
  readonly hasPrevPage: boolean;
};

/**
 * A find's row: the entity narrowed to what the query `Q` projected and populated, at every depth, so
 * reading anything else does not compile, plus {@link SortProjections}. The entity itself where nothing
 * narrows it. A key union names a projection by hand.
 * @example `QueryFindResult<User, 'id' | 'name'>`, `QueryFindResult<User, typeof query>`
 */
export type QueryFindResult<E, Q = {}> = [Q] extends [PropertyKey] ? Pick<E, Q & keyof E> : FindRow<E, Q>;

/** What a `$sort` projects, each a number under the name its `$project` gives. */
type SortProjections<Q> = Q extends { readonly $sort: { readonly [key: string]: infer V } }
  ? Projected<ProjectedName<V>>
  : unknown;

type ProjectedName<V> = V extends { readonly $project: infer N extends string } ? N : never;

type Projected<N extends string> = [N] extends [never] ? unknown : { readonly [K in N]: number };

/** The clauses that shape a row; a query naming none of them reads the entity as it is. */
type ShapingQuery = { readonly $select: object } | { readonly $populate: object } | { readonly $count: object };

/**
 * A row at any depth, as {@link QueryFindResult} without the key-union form. Every alias layer and
 * conditional from here down is paid on each read, measured with `bun run ts.perf`: the shaping is
 * written twice so a read with no `$sort` skips the projections, cheaper than an alias over it.
 */
type FindRow<E, Q> = Q extends { readonly $sort: object }
  ? (Q extends ShapingQuery ? ShapedRow<E, Q> : DataRow<E>) & SortProjections<Q>
  : Q extends ShapingQuery
    ? ShapedRow<E, Q>
    : DataRow<E>;

/**
 * The entity as a row reads it: plain data, so a method of the class it is read through is `never` and does not
 * compile. Still an `E`, which generic code returning or indexing its rows relies on.
 */
type DataRow<E> = E & MethodMask<E>;

/** Each method of `E` as `never`, built once per entity and laid over any row read off it. */
type MethodMask<E, M extends keyof E = MethodKey<E>> = [M] extends [never] ? unknown : { readonly [K in M]: never };

/**
 * The row's own fields, and its relations beside them. A positive `$select` entry wins outright at runtime, so a
 * map with one selects its positive keys alone; one with none leaves its keys out. `Pick`,
 * not a key remap: an entity keyed by an index signature, a content type defined at runtime, has `string` for its
 * keys, which a remap drops.
 */
type ShapedRow<E, Q> = Q extends { readonly $select: infer M }
  ? (M extends readonly unknown[]
      ? WholeRow<E, Q>
      : M[keyof M] extends true | 1
        ? Pick<E, ([keyof M] extends [never] ? FieldKey<E> : keyof M) & keyof E>
        : M[keyof M] extends Off
          ? Pick<E, Exclude<FieldKey<E>, keyof M> & keyof E>
          : Pick<E, OnKeys<M> & keyof E> & MaybeFields<E, M>) &
      RelatedRows<E, Q>
  : WholeRow<E, Q> & RelatedRows<E, Q>;

type Off = false | 0 | undefined;

/** The keys of a clause's map whose entry asks for something. */
type OnKeys<M> = { [K in keyof M]-?: [Extract<M[K], Off>] extends [never] ? K : never }[keyof M];

/** The keys whose entry may or may not ask, a `boolean`: what they name may be absent. */
type MaybeKeys<M> = {
  [K in keyof M]-?: [Extract<M[K], Off>] extends [never] ? never : M[K] extends Off ? never : K;
}[keyof M];

/** The fields a `boolean` entry names, each possibly absent; inert where every entry is literal. */
type MaybeFields<E, M> = [MaybeKeys<M>] extends [never] ? unknown : Partial<Pick<E, MaybeKeys<M> & keyof E>>;

/** The entity, less the relations {@link RelatedRows} fills in, so none comes back as declared. */
type WholeRow<E, Q> = Q extends { readonly $populate: infer M }
  ? Except<E, keyof M & keyof E> & MethodMask<E>
  : DataRow<E>;

/** The populated relations, and the `_count` a query asked for. */
type RelatedRows<E, Q> = Q extends { readonly $populate: infer M }
  ? PopulatedRelations<E, M, keyof M & keyof E> & CountedRelations<E, Q>
  : CountedRelations<E, Q>;

/**
 * Each populated relation as its own query shapes it, mapped over parameters constrained to `keyof E` so each
 * member stays linked to its declaration for a rename. A list is always there, empty where the parent has no
 * children, and so is a `$required` to-one; any other to-one may be absent, since a join can find no row.
 */
type PopulatedRelations<
  E,
  M,
  K extends keyof E,
  Present extends keyof E = PresentKeys<E, M, K>,
  Absent extends keyof E = Exclude<K, Present>,
> = { [P in Present]-?: PopulatedRow<E[P], M[P & keyof M]> } & {
  [P in Absent]: PopulatedRow<E[P], M[P & keyof M]> | undefined;
};

type PresentKeys<E, M, K extends keyof E> = {
  [P in K]: M[P & keyof M] extends true | 1 | object
    ? IsMany<E[P]> extends true
      ? P
      : M[P & keyof M] extends { readonly $required: true }
        ? P
        : never
    : never;
}[K];

type PopulatedRow<V, O> =
  NonNullable<V> extends readonly (infer T)[]
    ? NonNullable<V> extends unknown[]
      ? FindRow<T, O>[]
      : readonly FindRow<T, O>[]
    : FindRow<NonNullable<V>, O>;

/** The `_count` a query asked for, an inert intersection member where it asked for none. */
type CountedRelations<E, Q> = Q extends { readonly $count: infer M }
  ? { [K in typeof COUNT_RESULT_KEY]: Tallies<E, OnKeys<M> & keyof E, MaybeKeys<M> & keyof E> }
  : unknown;

/**
 * Each tally a count, over parameters constrained to `keyof E` and naming `E[R]`, which is what keeps each key
 * linked to its relation for a rename: a template that never names `E[R]` loses it.
 */
type Tallies<E, On extends keyof E, Maybe extends keyof E> = { [R in On]-?: Tally<E[R]> } & {
  [R in Maybe]?: Tally<E[R]>;
};

type Tally<_Relation> = number;

/**
 * A write's options: `returning` projects each row it writes as `$select` projects a read, `{ id: true, createdAt: true }`,
 * read in the same transaction after the write (before it, for a delete), so they hold what the database filled.
 */
export type WriteOptions<E, S extends FieldKey<E> = FieldKey<E>, V = BooleanLike> = {
  readonly returning?: QuerySelect<E, S, V>;
};

/** What each kind of write resolves to: its ids or its count where it names no `returning` field, else the rows it reads back. */
export type WriteResults<E, S, V> = [S] extends [never]
  ? {
      readonly inserted: WrittenId<E> | undefined;
      readonly affected: number;
      readonly affectedMany: number;
    }
  : {
      readonly inserted: ReturnedRow<E, S, V>;
      readonly affected: ReturnedRow<E, S, V> | undefined;
      readonly affectedMany: ReturnedRow<E, S, V>[];
    };

/**
 * The row `returning` reads back: its keys, every field but them where it subtracts, and where it mixes both, its
 * positive keys, which a key set cannot tell apart, so each may be absent. `NoInfer`: a write naming no `returning`
 * would otherwise infer `S` from the type its result is assigned to.
 */
type ReturnedRow<E, S, V> = [V] extends [true | 1]
  ? Pick<E, NoInfer<S> & keyof E>
  : [V] extends [false | 0]
    ? Pick<E, Exclude<FieldKey<E>, NoInfer<S>> & keyof E>
    : Partial<Pick<E, NoInfer<S> & keyof E>>;

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
};
