import type { EntityId, EntityWrite, FieldKey, UpdateWrite, WritableEntity } from './entity.js';
import type {
  EntityAccess,
  FieldAccess,
  Captured,
  CursorPage,
  Query,
  QueryUpsert,
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
import type { QuerierSql, QuerierTransport } from './wire.js';

/** The query each read takes, keyed by the kind of read. */
export type ReadQueries<E, Sql> = {
  readonly one: QueryOne<E, Sql>;
  readonly many: Query<E, Sql>;
  readonly page: QueryKeyset<E, Sql>;
};

/** The result type of each read, keyed by the kind of read: alike on the server and the client. */
export type ReadResults<T> = {
  readonly one: Promise<T | undefined>;
  readonly many: Promise<T[]>;
  readonly counted: Promise<[T[], number]>;
  readonly page: Promise<CursorPage<T>>;
  readonly stream: AsyncIterable<T>;
};

/**
 * A read that takes the entity first, then the query, and returns rows narrowed to what the query projected. `K` picks
 * the query type, `R` the result type, `W` the transport, whose SQL its queries may carry, and `O` the options.
 */
export type EntityRead<
  K extends keyof ReadQueries<object, never>,
  R extends keyof ReadResults<unknown>,
  W extends QuerierTransport,
  O,
> = <E extends object, const Q extends ReadQueries<E, QuerierSql<W>>[K]>(
  entity: Type<E>,
  q: Captured<ReadQueries<E, QuerierSql<W>>[K], Q>,
  opts?: O,
) => ReadResults<QueryFindResult<E, Q>>[R];

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
  ): Promise<QueryFindResult<E, Q> | undefined>;

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
  count<E extends object>(entity: Type<E>, q?: QueryPage<E, QuerierSql<W>>, opts?: O): Promise<number>;

  /** Whether any record matches: a count capped at one row, so the engine stops at the first match. */
  exists<E extends object>(entity: Type<E>, q?: QueryFilter<E, QuerierSql<W>>, opts?: O): Promise<boolean>;

  /** Update the record with the given primary key; resolves to the number of affected rows. */
  updateOneById<E extends WritableEntity>(
    entity: Type<E>,
    id: EntityId<E>,
    payload: UpdateWrite<E, QuerierSql<W>>,
    opts?: O,
  ): Promise<number>;

  /** Update the records matching the query; resolves to the number of affected rows. */
  updateMany<E extends WritableEntity>(
    entity: Type<E>,
    q: QuerySearch<E, QuerierSql<W>>,
    payload: UpdateWrite<E, QuerierSql<W>>,
    opts?: O,
  ): Promise<number>;

  /**
   * delete or SoftDelete a record.
   * @param entity the entity to persist on
   * @param id the primary key of the record
   * @return the number of affected records
   */
  deleteOneById<E extends WritableEntity>(entity: Type<E>, id: EntityId<E>, opts?: DO): Promise<number>;

  /**
   * delete or SoftDelete records.
   * @param entity the entity to persist on
   * @param q the criteria to look for the records
   * @return the number of affected records
   */
  deleteMany<E extends WritableEntity>(entity: Type<E>, q: QuerySearch<E, QuerierSql<W>>, opts?: DO): Promise<number>;
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
  insertOne<
    E extends WritableEntity,
    const S extends FieldKey<E> = never,
    const V extends BooleanLike = true,
    const W extends boolean = false,
  >(
    entity: Type<E>,
    payload: EntityWrite<E>,
    opts?: WriteOptions<E, S, V, W>,
  ): Promise<WriteResults<E, S, V, W>['written']>;

  /**
   * Insert records in as few statements as the bind limit allows, resolving to their ids in payload order, or
   * the rows `returning` reads back.
   */
  insertMany<
    E extends WritableEntity,
    const S extends FieldKey<E> = never,
    const V extends BooleanLike = true,
    const W extends boolean = false,
  >(
    entity: Type<E>,
    payload: readonly EntityWrite<E>[],
    opts?: WriteOptions<E, S, V, W>,
  ): Promise<WriteResults<E, S, V, W>['written'][]>;

  /** Update the record with the given primary key; resolves to the number of affected rows, or the row `returning` reads back. */
  updateOneById<
    E extends WritableEntity,
    const S extends FieldKey<E> = never,
    const V extends BooleanLike = true,
    const W extends boolean = false,
  >(
    entity: Type<E>,
    id: EntityId<E>,
    payload: UpdateWrite<E>,
    opts?: QueryOptions & WriteOptions<E, S, V, W>,
  ): Promise<WriteResults<E, S, V, W>['affected']>;

  /** Update the records matching the query; resolves to the number of affected rows, or the rows `returning` reads back. */
  updateMany<
    E extends WritableEntity,
    const S extends FieldKey<E> = never,
    const V extends BooleanLike = true,
    const W extends boolean = false,
  >(
    entity: Type<E>,
    q: QuerySearch<E>,
    payload: UpdateWrite<E>,
    opts?: QueryOptions & WriteOptions<E, S, V, W>,
  ): Promise<WriteResults<E, S, V, W>['affectedMany']>;

  /** Delete, or soft-delete, the record with the given key; resolves to the number of affected rows, or the row as it was. */
  deleteOneById<
    E extends WritableEntity,
    const S extends FieldKey<E> = never,
    const V extends BooleanLike = true,
    const W extends boolean = false,
  >(
    entity: Type<E>,
    id: EntityId<E>,
    opts?: QueryOptions & WriteOptions<E, S, V, W>,
  ): Promise<WriteResults<E, S, V, W>['affected']>;

  /** Delete, or soft-delete, the records matching the query; resolves to the number of affected rows, or the rows as they were. */
  deleteMany<
    E extends WritableEntity,
    const S extends FieldKey<E> = never,
    const V extends BooleanLike = true,
    const W extends boolean = false,
  >(
    entity: Type<E>,
    q: QuerySearch<E>,
    opts?: QueryOptions & WriteOptions<E, S, V, W>,
  ): Promise<WriteResults<E, S, V, W>['affectedMany']>;

  /**
   * Insert or update a record by `q.$conflict`'s keys; resolves to its id, or the row `returning` reads back. A
   * conflicting row matching `q.$where` takes the payload less those keys, or `q.$update` as `updateMany` takes an
   * update: `{ uses: { $inc: 1 } }` counts, and `{}` leaves the row as it is. Either branch writes the cascaded relations it is given.
   */
  upsertOne<
    E extends WritableEntity,
    const S extends FieldKey<E> = never,
    const V extends BooleanLike = true,
    const W extends boolean = false,
  >(
    entity: Type<E>,
    q: QueryUpsert<E>,
    payload: EntityWrite<E>,
    opts?: WriteOptions<E, S, V, W>,
  ): Promise<WriteResults<E, S, V, W>['written']>;

  /** Insert or update records by `q.$conflict`'s keys, as `upsertOne` does; resolves to their ids in payload order, or the rows. */
  upsertMany<
    E extends WritableEntity,
    const S extends FieldKey<E> = never,
    const V extends BooleanLike = true,
    const W extends boolean = false,
  >(
    entity: Type<E>,
    q: QueryUpsert<E>,
    payload: readonly EntityWrite<E>[],
    opts?: WriteOptions<E, S, V, W>,
  ): Promise<WriteResults<E, S, V, W>['written'][]>;

  /** Insert a record, or upsert one naming its key; resolves to its id, or the row `returning` reads back. */
  saveOne<
    E extends WritableEntity,
    const S extends FieldKey<E> = never,
    const V extends BooleanLike = true,
    const W extends boolean = false,
  >(
    entity: Type<E>,
    payload: EntityWrite<E>,
    opts?: WriteOptions<E, S, V, W>,
  ): Promise<WriteResults<E, S, V, W>['written']>;

  /** Insert records, or upsert those naming their key; resolves to their ids in payload order, or the rows. */
  saveMany<
    E extends WritableEntity,
    const S extends FieldKey<E> = never,
    const V extends BooleanLike = true,
    const W extends boolean = false,
  >(
    entity: Type<E>,
    payload: readonly EntityWrite<E>[],
    opts?: WriteOptions<E, S, V, W>,
  ): Promise<WriteResults<E, S, V, W>['written'][]>;

  /**
   * Restore soft-deleted records (sets the soft-delete field back to `null`). Throws if the
   * entity has no soft-delete field.
   */
  restoreOneById<E extends WritableEntity>(entity: Type<E>, id: EntityId<E>): Promise<number>;

  restoreMany<E extends WritableEntity>(entity: Type<E>, q: QuerySearch<E>): Promise<number>;

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
   * stale as the last `ANALYZE`, and unfiltered, so soft-deleted rows count. SQLite has none and throws, and it is
   * refused for an entity whose policies the pool holds, since it would count the rows they hide, and for a view,
   * which has no rows of its own.
   */
  estimatedCount<E extends object>(entity: Type<E>): Promise<number>;
}

/** What a save does to the rows it writes, as a cascade does to the rows a write nests: inserts new ones, updates listed ones. */
export const SAVES = ['insert', 'update'] as const satisfies readonly FieldAccess[];

/**
 * What each querier method does to an entity's rows, a save or an upsert inserting or updating: the one table a pool
 * routes by, a read running on a replica where it has some, and the API checks a call's exposure by. Total, so a new
 * method says.
 */
export const QUERIER_OPS = {
  findOneById: ['read'],
  findOne: ['read'],
  findMany: ['read'],
  findManyStream: ['read'],
  findManyAndCount: ['read'],
  findManyPage: ['read'],
  count: ['read'],
  exists: ['read'],
  aggregate: ['read'],
  estimatedCount: ['read'],
  insertOne: ['insert'],
  insertMany: ['insert'],
  saveOne: SAVES,
  saveMany: SAVES,
  upsertOne: SAVES,
  upsertMany: SAVES,
  updateOneById: ['update'],
  updateMany: ['update'],
  restoreOneById: ['update'],
  restoreMany: ['update'],
  deleteOneById: ['delete'],
  deleteMany: ['delete'],
} as const satisfies Record<keyof UniversalQuerier, readonly EntityAccess[]>;

/** Whether `op` does `access` to an entity's rows: a read may run on a read replica. */
export function opDoes(op: keyof UniversalQuerier, access: EntityAccess): boolean {
  const does: readonly EntityAccess[] = QUERIER_OPS[op];
  return does.includes(access);
}
