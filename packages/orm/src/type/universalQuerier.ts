import type { EntityId, EntityWrite, FieldKey, UpdateWrite } from './entity.js';
import type {
  Captured,
  CursorPage,
  Query,
  QueryConflictPaths,
  QueryFilter,
  QueryFindResult,
  QueryKeyset,
  QueryOne,
  QueryOptions,
  QueryPage,
  QuerySearch,
  WriteResults,
  WriteOptions,
} from './query.js';
import type { QueryAggregate, QueryAggregateResult } from './queryAggregate.js';
import type { BooleanLike, Type } from './utility.js';
import type { QuerierCountedResult, QuerierSql, QuerierResult, QuerierTransport } from './wire.js';

/** The query each read takes, keyed by the kind of read. */
export type ReadQueries<E, Sql> = {
  readonly one: QueryOne<E, Sql>;
  readonly many: Query<E, Sql>;
  readonly page: QueryKeyset<E, Sql>;
};

/** The result type of each read on transport `W`, keyed by the kind of read. */
export type ReadResults<W extends QuerierTransport, T> = {
  readonly one: QuerierResult<W, T | undefined>;
  readonly many: QuerierResult<W, T[]>;
  readonly counted: QuerierCountedResult<W, T>;
  readonly page: QuerierResult<W, CursorPage<T>>;
  readonly stream: AsyncIterable<T>;
};

/**
 * A read that takes the entity first, then the query, and returns rows narrowed to what the query projected. `K` picks
 * the query type, `R` the result type on transport `W`, and `O` the options.
 */
export type EntityRead<
  K extends keyof ReadQueries<object, never>,
  R extends keyof ReadResults<QuerierTransport, unknown>,
  W extends QuerierTransport,
  O,
> = <E extends object, const Q extends ReadQueries<E, QuerierSql<W>>[K]>(
  entity: Type<E>,
  q: Captured<ReadQueries<E, QuerierSql<W>>[K], Q>,
  opts?: O,
) => ReadResults<W, QueryFindResult<E, Q>>[R];

/**
 * The operations the server and the browser client declare alike, per transport `W`, options `O`,
 * and delete options `DO`, which on the client also carry the {@link QueryOptions} it cannot pass otherwise.
 */
export interface SharedQuerier<W extends QuerierTransport, O, DO = O> {
  /** Find the record with the given primary key. */
  findOneById<E extends object, const Q extends QueryOne<E, QuerierSql<W>> = {}>(
    entity: Type<E>,
    id: EntityId<E>,
    q?: Captured<QueryOne<E, QuerierSql<W>>, Q>,
    opts?: O,
  ): QuerierResult<W, QueryFindResult<E, Q> | undefined>;

  /**
   * obtains the first record matching the given search parameters.
   * @param entity the target entity
   * @param q the criteria options
   * @return the record
   */
  findOne: EntityRead<'one', 'one', W, O>;

  /**
   * obtains the records matching the given search parameters.
   * @param entity the target entity
   * @param q the criteria options
   * @return the records
   */
  findMany: EntityRead<'many', 'many', W, O>;

  /** Find the records matching the query, and count every match past its page. */
  findManyAndCount: EntityRead<'many', 'counted', W, O>;

  /**
   * Read a page of the records matching the query, from a cursor instead of an offset, so every page costs
   * the same as the first and rows written in between shift no page. The sort must be total: it must end in
   * the key or a unique, non-null field. Counts nothing.
   */
  findManyPage: EntityRead<'page', 'page', W, O>;

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
  findManyStream: EntityRead<'many', 'stream', 'server', QueryOptions>;

  /** Insert a record and resolve to its id, or the row `returning` reads back. See {@link UniversalQuerier.insertMany}. */
  insertOne<E extends object, const S extends FieldKey<E> = never, const V extends BooleanLike = true>(
    entity: Type<E>,
    payload: EntityWrite<E>,
    opts?: WriteOptions<E, S, V>,
  ): Promise<WriteResults<E, S, V>['inserted']>;

  /**
   * Insert records in as few statements as the bind limit allows, resolving to their ids in payload order, or
   * the rows `returning` reads back. Ids are exact everywhere but MySQL, which infers them from its header and
   * reports `undefined` rather than a guess for a generated key that is not `AUTO_INCREMENT`.
   */
  insertMany<E extends object, const S extends FieldKey<E> = never, const V extends BooleanLike = true>(
    entity: Type<E>,
    payload: readonly EntityWrite<E>[],
    opts?: WriteOptions<E, S, V>,
  ): Promise<WriteResults<E, S, V>['inserted'][]>;

  /** Update the record with the given primary key; resolves to the number of affected rows, or the row `returning` reads back. */
  updateOneById<E extends object, const S extends FieldKey<E> = never, const V extends BooleanLike = true>(
    entity: Type<E>,
    id: EntityId<E>,
    payload: UpdateWrite<E>,
    opts?: QueryOptions & WriteOptions<E, S, V>,
  ): Promise<WriteResults<E, S, V>['affected']>;

  /** Update the records matching the query; resolves to the number of affected rows, or the rows `returning` reads back. */
  updateMany<E extends object, const S extends FieldKey<E> = never, const V extends BooleanLike = true>(
    entity: Type<E>,
    q: QuerySearch<E>,
    payload: UpdateWrite<E>,
    opts?: QueryOptions & WriteOptions<E, S, V>,
  ): Promise<WriteResults<E, S, V>['affectedMany']>;

  /** Delete, or soft-delete, the record with the given key; resolves to the number of affected rows, or the row as it was. */
  deleteOneById<E extends object, const S extends FieldKey<E> = never, const V extends BooleanLike = true>(
    entity: Type<E>,
    id: EntityId<E>,
    opts?: QueryOptions & WriteOptions<E, S, V>,
  ): Promise<WriteResults<E, S, V>['affected']>;

  /** Delete, or soft-delete, the records matching the query; resolves to the number of affected rows, or the rows as they were. */
  deleteMany<E extends object, const S extends FieldKey<E> = never, const V extends BooleanLike = true>(
    entity: Type<E>,
    q: QuerySearch<E>,
    opts?: QueryOptions & WriteOptions<E, S, V>,
  ): Promise<WriteResults<E, S, V>['affectedMany']>;

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
  ): Promise<WriteResults<E, S, V>['inserted']>;

  /** Insert or update records by their conflict paths, as `upsertOne` does; resolves to their ids in payload order, or the rows. */
  upsertMany<E extends object, const S extends FieldKey<E> = never, const V extends BooleanLike = true>(
    entity: Type<E>,
    conflictPaths: QueryConflictPaths<E>,
    payload: readonly EntityWrite<E>[],
    update?: UpdateWrite<E>,
    opts?: WriteOptions<E, S, V>,
  ): Promise<WriteResults<E, S, V>['inserted'][]>;

  /** Insert a record, or upsert one naming its key; resolves to its id, or the row `returning` reads back. */
  saveOne<E extends object, const S extends FieldKey<E> = never, const V extends BooleanLike = true>(
    entity: Type<E>,
    payload: EntityWrite<E>,
    opts?: WriteOptions<E, S, V>,
  ): Promise<WriteResults<E, S, V>['inserted']>;

  /** Insert records, or upsert those naming their key; resolves to their ids in payload order, or the rows. */
  saveMany<E extends object, const S extends FieldKey<E> = never, const V extends BooleanLike = true>(
    entity: Type<E>,
    payload: readonly EntityWrite<E>[],
    opts?: WriteOptions<E, S, V>,
  ): Promise<WriteResults<E, S, V>['inserted'][]>;

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
  aggregate<E extends object, const Q extends QueryAggregate<E>>(
    entity: Type<E>,
    q: Captured<QueryAggregate<E, Q>, Q>,
    opts?: QueryOptions,
  ): Promise<QueryAggregateResult<E, Q>[]>;

  /**
   * The table's row count as the engine's statistics state it, without reading a row: approximate, as
   * stale as the last `ANALYZE`, and unfiltered, so soft-deleted rows count. SQLite has none and throws.
   */
  estimatedCount<E extends object>(entity: Type<E>): Promise<number>;
}
