import type { EntityId, EntityWrite, FieldKey, RelationKey, UpdateWrite, WrittenId } from './entity.js';
import type {
  CursorPage,
  QueryConflictPaths,
  QueryFilter,
  QueryFindResult,
  QueryKeysetProjected,
  QueryOneProjected,
  QueryOptions,
  QueryPage,
  QueryProjected,
  QuerySearch,
  ReturningResult,
  WriteOptions,
} from './query.js';
import type { QueryAggMap, QueryAggregate, QueryAggregateResult, QueryGroupMap } from './queryAggregate.js';
import type { BooleanLike, Type } from './utility.js';
import type { QuerierCountedResult, QuerierSql, QuerierResult, QuerierTransport } from './wire.js';

/** The query type each projected read takes, keyed by the kind of read. */
export type ProjectedQuery<
  E,
  S extends FieldKey<E>,
  V,
  X extends FieldKey<E>,
  P extends RelationKey<E>,
  C extends RelationKey<E>,
  Sql,
> = {
  readonly one: QueryOneProjected<E, S, V, X, P, C, Sql>;
  readonly many: QueryProjected<E, S, V, X, P, C, Sql>;
  readonly page: QueryKeysetProjected<E, S, V, X, P, C, Sql>;
};

/** The result type of each projected read on transport `W`, keyed by the kind of read. */
export type ProjectedResult<W extends QuerierTransport, T> = {
  readonly one: QuerierResult<W, T | undefined>;
  readonly many: QuerierResult<W, T[]>;
  readonly counted: QuerierCountedResult<W, T>;
  readonly page: QuerierResult<W, CursorPage<T>>;
  readonly stream: AsyncIterable<T>;
};

/**
 * A read that takes an entity and a query, and returns rows narrowed to what the query projected. `Q` picks
 * the query type, `R` the result type on transport `W`, and `O` the options. Declaring it once saves every
 * such read from repeating the six type parameters.
 */
export type ProjectedRead<
  Q extends keyof ProjectedQuery<object, never, never, never, never, never, never>,
  R extends keyof ProjectedResult<QuerierTransport, unknown>,
  W extends QuerierTransport,
  O,
> = <
  E extends object,
  const S extends FieldKey<E> = never,
  const V = true,
  const X extends FieldKey<E> = never,
  const P extends RelationKey<E> = never,
  const C extends RelationKey<E> = never,
>(
  entity: Type<E>,
  q: ProjectedQuery<E, S, V, X, P, C, QuerierSql<W>>[Q],
  opts?: O,
) => ProjectedResult<W, QueryFindResult<E, S, V, X, P, C>>[R];

/**
 * The operations the server and the browser client declare alike, per transport `W`, options `O`,
 * and delete options `DO`, which on the client also carry the {@link QueryOptions} it cannot pass otherwise.
 */
export interface SharedQuerier<W extends QuerierTransport, O, DO = O> {
  /** Find the record with the given primary key. */
  findOneById<
    E extends object,
    const S extends FieldKey<E> = never,
    const V = true,
    const X extends FieldKey<E> = never,
    const P extends RelationKey<E> = never,
    const C extends RelationKey<E> = never,
  >(
    entity: Type<E>,
    id: EntityId<E>,
    q?: QueryOneProjected<E, S, V, X, P, C, QuerierSql<W>>,
    opts?: O,
  ): QuerierResult<W, QueryFindResult<E, S, V, X, P, C> | undefined>;

  /**
   * obtains the first record matching the given search parameters.
   * @param entity the target entity
   * @param q the criteria options
   * @return the record
   */
  findOne: ProjectedRead<'one', 'one', W, O>;

  /**
   * obtains the records matching the given search parameters.
   * @param entity the target entity
   * @param q the criteria options
   * @return the records
   */
  findMany: ProjectedRead<'many', 'many', W, O>;

  /** Find the records matching the query, and count every match past its page. */
  findManyAndCount: ProjectedRead<'many', 'counted', W, O>;

  /**
   * Read a page of the records matching the query, from a cursor instead of an offset, so every page costs
   * the same as the first and rows written in between shift no page. The sort must be total: it must end in
   * the key or a unique, non-null field. Counts nothing.
   */
  findManyPage: ProjectedRead<'page', 'page', W, O>;

  /** Count the records matching the filter, or those a page of them takes. */
  count<E extends object>(entity: Type<E>, q?: QueryPage<E, QuerierSql<W>>, opts?: O): QuerierResult<W, number>;

  /** Whether any record matches: a count capped at one row, so the engine stops at the first match. */
  exists<E extends object>(entity: Type<E>, q?: QueryFilter<E, QuerierSql<W>>, opts?: O): QuerierResult<W, boolean>;

  /** Update the record with the given primary key; resolves to the number of affected rows. */
  updateOneById<E extends object>(
    entity: Type<E>,
    id: EntityId<E>,
    payload: UpdateWrite<E, QuerierSql<W>>,
    opts?: O,
  ): QuerierResult<W, number>;

  /** Update the records matching the query; resolves to the number of affected rows. */
  updateMany<E extends object>(
    entity: Type<E>,
    q: QuerySearch<E, QuerierSql<W>>,
    payload: UpdateWrite<E, QuerierSql<W>>,
    opts?: O,
  ): QuerierResult<W, number>;

  /**
   * delete or SoftDelete a record.
   * @param entity the entity to persist on
   * @param id the primary key of the record
   * @return the number of affected records
   */
  deleteOneById<E extends object>(entity: Type<E>, id: EntityId<E>, opts?: DO): QuerierResult<W, number>;

  /**
   * delete or SoftDelete records.
   * @param entity the entity to persist on
   * @param q the criteria to look for the records
   * @return the number of affected records
   */
  deleteMany<E extends object>(entity: Type<E>, q: QuerySearch<E, QuerierSql<W>>, opts?: DO): QuerierResult<W, number>;
}

/**
 * A `querier` allows to interact with the datasource to perform persistence operations on any entity.
 */
export interface UniversalQuerier extends SharedQuerier<'server', QueryOptions> {
  /**
   * Stream the records matching the query one at a time, each with the relations and counts `findMany`
   * reads, for bulk reads. `afterLoad` runs on each row as it arrives.
   */
  findManyStream: ProjectedRead<'many', 'stream', 'server', QueryOptions>;

  /** Insert a record and resolve to its id, or the row `returning` reads back. See {@link UniversalQuerier.insertMany}. */
  insertOne<E extends object, const S extends FieldKey<E> = never, const V extends BooleanLike = true>(
    entity: Type<E>,
    payload: EntityWrite<E>,
    opts?: WriteOptions<E, S, V>,
  ): Promise<ReturningResult<S, WrittenId<E> | undefined, QueryFindResult<E, S, V>>>;

  /**
   * Insert records in as few statements as the bind limit allows, resolving to their ids in payload order, or
   * the rows `returning` reads back. Ids are exact everywhere but MySQL, which infers them from its header and
   * reports `undefined` rather than a guess for a generated key that is not `AUTO_INCREMENT`.
   */
  insertMany<E extends object, const S extends FieldKey<E> = never, const V extends BooleanLike = true>(
    entity: Type<E>,
    payload: readonly EntityWrite<E>[],
    opts?: WriteOptions<E, S, V>,
  ): Promise<ReturningResult<S, (WrittenId<E> | undefined)[], QueryFindResult<E, S, V>[]>>;

  /** Update the record with the given primary key; resolves to the number of affected rows, or the row `returning` reads back. */
  updateOneById<E extends object, const S extends FieldKey<E> = never, const V extends BooleanLike = true>(
    entity: Type<E>,
    id: EntityId<E>,
    payload: UpdateWrite<E>,
    opts?: QueryOptions & WriteOptions<E, S, V>,
  ): Promise<ReturningResult<S, number, QueryFindResult<E, S, V> | undefined>>;

  /** Update the records matching the query; resolves to the number of affected rows, or the rows `returning` reads back. */
  updateMany<E extends object, const S extends FieldKey<E> = never, const V extends BooleanLike = true>(
    entity: Type<E>,
    q: QuerySearch<E>,
    payload: UpdateWrite<E>,
    opts?: QueryOptions & WriteOptions<E, S, V>,
  ): Promise<ReturningResult<S, number, QueryFindResult<E, S, V>[]>>;

  /** Delete, or soft-delete, the record with the given key; resolves to the number of affected rows, or the row as it was. */
  deleteOneById<E extends object, const S extends FieldKey<E> = never, const V extends BooleanLike = true>(
    entity: Type<E>,
    id: EntityId<E>,
    opts?: QueryOptions & WriteOptions<E, S, V>,
  ): Promise<ReturningResult<S, number, QueryFindResult<E, S, V> | undefined>>;

  /** Delete, or soft-delete, the records matching the query; resolves to the number of affected rows, or the rows as they were. */
  deleteMany<E extends object, const S extends FieldKey<E> = never, const V extends BooleanLike = true>(
    entity: Type<E>,
    q: QuerySearch<E>,
    opts?: QueryOptions & WriteOptions<E, S, V>,
  ): Promise<ReturningResult<S, number, QueryFindResult<E, S, V>[]>>;

  /**
   * Insert or update a record by its conflict paths; resolves to its id, or the row `returning` reads back. A
   * conflicting row takes the payload less those paths, or `update` as `updateMany` takes one: `{ uses: { $inc: 1 } }`
   * counts, and `{}` leaves the row as it is. Either branch writes the cascaded relations it is given.
   */
  upsertOne<E extends object, const S extends FieldKey<E> = never, const V extends BooleanLike = true>(
    entity: Type<E>,
    conflictPaths: QueryConflictPaths<E>,
    payload: EntityWrite<E>,
    update?: UpdateWrite<E>,
    opts?: WriteOptions<E, S, V>,
  ): Promise<ReturningResult<S, WrittenId<E> | undefined, QueryFindResult<E, S, V>>>;

  /** Insert or update records by their conflict paths, as `upsertOne` does; resolves to their ids in payload order, or the rows. */
  upsertMany<E extends object, const S extends FieldKey<E> = never, const V extends BooleanLike = true>(
    entity: Type<E>,
    conflictPaths: QueryConflictPaths<E>,
    payload: readonly EntityWrite<E>[],
    update?: UpdateWrite<E>,
    opts?: WriteOptions<E, S, V>,
  ): Promise<ReturningResult<S, (WrittenId<E> | undefined)[], QueryFindResult<E, S, V>[]>>;

  /** Insert a record, or upsert one naming its key; resolves to its id, or the row `returning` reads back. */
  saveOne<E extends object, const S extends FieldKey<E> = never, const V extends BooleanLike = true>(
    entity: Type<E>,
    payload: EntityWrite<E>,
    opts?: WriteOptions<E, S, V>,
  ): Promise<ReturningResult<S, WrittenId<E> | undefined, QueryFindResult<E, S, V>>>;

  /** Insert records, or upsert those naming their key; resolves to their ids in payload order, or the rows. */
  saveMany<E extends object, const S extends FieldKey<E> = never, const V extends BooleanLike = true>(
    entity: Type<E>,
    payload: readonly EntityWrite<E>[],
    opts?: WriteOptions<E, S, V>,
  ): Promise<ReturningResult<S, (WrittenId<E> | undefined)[], QueryFindResult<E, S, V>[]>>;

  /**
   * Restore soft-deleted records (sets the soft-delete field back to `null`). Throws if the
   * entity has no soft-delete field.
   */
  restoreOneById<E extends object>(entity: Type<E>, id: EntityId<E>): Promise<number>;

  restoreMany<E extends object>(entity: Type<E>, q: QuerySearch<E>): Promise<number>;

  /**
   * runs an aggregate query (GROUP BY with aggregate functions).
   * @param entity the target entity
   * @param q the aggregate query options
   * @return the aggregate results
   */
  aggregate<E extends object, const G extends QueryGroupMap<E>, const A extends QueryAggMap<E>>(
    entity: Type<E>,
    q: QueryAggregate<E, G, A>,
    opts?: QueryOptions,
  ): Promise<QueryAggregateResult<E, G, A>[]>;

  /**
   * The table's row count as the engine's statistics state it, without reading a row: approximate, as
   * stale as the last `ANALYZE`, and unfiltered, so soft-deleted rows count. SQLite has none and throws.
   */
  estimatedCount<E extends object>(entity: Type<E>): Promise<number>;
}
