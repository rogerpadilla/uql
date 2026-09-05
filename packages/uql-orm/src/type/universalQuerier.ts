import type { EntityData, EntityId, FieldKey, IdValue, RelationKey, UpdatePayload } from './entity.js';
import type {
  QueryConflictPaths,
  QueryFilter,
  QueryFindResult,
  QueryOneProjected,
  QueryOptions,
  QueryPage,
  QueryProjected,
  QuerySearch,
  QueryStreamProjected,
  QueryUpdateResult,
} from './query.js';
import type { QueryAggMap, QueryAggregate, QueryAggregateResult, QueryGroupMap } from './queryAggregate.js';
import type { Type } from './utility.js';
import type { QuerierCountedResult, QuerierResult, QuerierTransport } from './wire.js';

/**
 * The operations {@link UniversalQuerier} and `ClientQuerier` declare identically, written once and
 * instantiated per transport: `SharedQuerier<'server', QueryOptions>` against
 * `SharedQuerier<'client', RequestOptions, QueryOptions & RequestOptions>`. See {@link QuerierResult}
 * for how the return type follows `W`.
 *
 * @typeParam W - which side of the wire, picking each method's return type.
 * @typeParam O - the per-call options.
 * @typeParam DO - the delete methods' options, which the client also lets carry {@link QueryOptions}
 * (`hardDelete`, `filters`) since it has no other way to reach them.
 */
export interface SharedQuerier<W extends QuerierTransport, O, DO = O> {
  /**
   * obtains the record with the given primary key.
   * @param entity the target entity
   * @param id the primary key value
   * @param q the additional criteria options
   * @return the record
   */
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
    q?: QueryOneProjected<E, S, V, X, P, C>,
    opts?: O,
  ): QuerierResult<W, QueryFindResult<E, S, V, X, P, C> | undefined>;

  /**
   * obtains the first record matching the given search parameters.
   * @param entity the target entity
   * @param q the criteria options
   * @return the record
   */
  findOne<
    E extends object,
    const S extends FieldKey<E> = never,
    const V = true,
    const X extends FieldKey<E> = never,
    const P extends RelationKey<E> = never,
    const C extends RelationKey<E> = never,
  >(
    entity: Type<E>,
    q: QueryOneProjected<E, S, V, X, P, C>,
    opts?: O,
  ): QuerierResult<W, QueryFindResult<E, S, V, X, P, C> | undefined>;

  /**
   * obtains the records matching the given search parameters.
   * @param entity the target entity
   * @param q the criteria options
   * @return the records
   */
  findMany<
    E extends object,
    const S extends FieldKey<E> = never,
    const V = true,
    const X extends FieldKey<E> = never,
    const P extends RelationKey<E> = never,
    const C extends RelationKey<E> = never,
  >(
    entity: Type<E>,
    q: QueryProjected<E, S, V, X, P, C>,
    opts?: O,
  ): QuerierResult<W, QueryFindResult<E, S, V, X, P, C>[]>;

  /**
   * obtains the records matching the given search parameters,
   * also counts the number of matches ignoring pagination.
   * @param entity the target entity
   * @param q the criteria options
   * @return the records and the count
   */
  findManyAndCount<
    E extends object,
    const S extends FieldKey<E> = never,
    const V = true,
    const X extends FieldKey<E> = never,
    const P extends RelationKey<E> = never,
    const C extends RelationKey<E> = never,
  >(
    entity: Type<E>,
    q: QueryProjected<E, S, V, X, P, C>,
    opts?: O,
  ): QuerierCountedResult<W, QueryFindResult<E, S, V, X, P, C>>;

  /**
   * counts the number of records matching the given filter, optionally paged - a `$skip`/`$limit`
   * settles the matching rows first and counts them, rather than scanning every match.
   * @param entity the target entity
   * @param q the filter
   * @return the count
   */
  count<E extends object>(entity: Type<E>, q?: QueryPage<E>, opts?: O): QuerierResult<W, number>;

  /**
   * whether any record matches the given filter - a count capped at one row, so the engine stops at
   * the first match instead of scanning every other one.
   * @param entity the target entity
   * @param q the filter
   * @return whether anything matched
   */
  exists<E extends object>(entity: Type<E>, q?: QueryFilter<E>, opts?: O): QuerierResult<W, boolean>;

  /**
   * updates a record partially.
   * @param entity the entity to persist on
   * @param id the primary key of the record to be updated
   * @param payload the data to be persisted
   * @return the number of affected records
   */
  updateOneById<E extends object>(
    entity: Type<E>,
    id: EntityId<E>,
    payload: UpdatePayload<E>,
    opts?: O,
  ): QuerierResult<W, number>;

  /**
   * updates many records partially.
   * @param entity the entity to persist on
   * @param q the criteria to look for the records
   * @param payload the data to be persisted
   * @return the number of affected records
   */
  updateMany<E extends object>(
    entity: Type<E>,
    q: QuerySearch<E>,
    payload: UpdatePayload<E>,
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
  deleteMany<E extends object>(entity: Type<E>, q: QuerySearch<E>, opts?: DO): QuerierResult<W, number>;
}

/**
 * A `querier` allows to interact with the datasource to perform persistence operations on any entity.
 */
export interface UniversalQuerier extends SharedQuerier<'server', QueryOptions> {
  /**
   * streams the records matching the given search parameters as an async iterable.
   * Does not fill relations or fire lifecycle hooks - designed for high-performance
   * bulk reads (ETL, exports, migrations).
   * @param entity the target entity
   * @param q the criteria options
   * @return an async iterable of records
   */
  findManyStream<
    E extends object,
    const S extends FieldKey<E> = never,
    const V = true,
    const X extends FieldKey<E> = never,
    const P extends RelationKey<E> = never,
  >(
    entity: Type<E>,
    q: QueryStreamProjected<E, S, V, X, P>,
    opts?: QueryOptions,
  ): AsyncIterable<QueryFindResult<E, S, V, X, P>>;

  /**
   * Insert a single record and return its ID (provided, `onInsert`-generated, or
   * database-generated - see {@link UniversalQuerier.insertMany} for the exact semantics).
   * Returns `undefined` only where the database cannot report one: MySQL, whose `LAST_INSERT_ID()`
   * speaks for `AUTO_INCREMENT` columns alone and is left *stale* rather than cleared otherwise, so
   * a non-auto-increment key the caller did not supply has no id to give and a header read would
   * hand back an earlier row's. Every other backend uses `RETURNING` and is exact, SQLite included.
   * @param entity the entity to persist on
   * @param payload the data to be persisted
   * @return the ID
   */
  insertOne<E extends object>(entity: Type<E>, payload: EntityData<E>): Promise<IdValue<E> | undefined>;

  /**
   * Insert multiple records in a single statement (auto-chunked when the batch exceeds the
   * dialect's bind-parameter limit) and return their IDs in payload order.
   *
   * Provided IDs and client-generated ones (`@Id({ onInsert })`) are always returned as-is.
   * Database-generated IDs are exact on `'returning'` dialects (Postgres, MariaDB, MongoDB);
   * on MySQL/SQLite they are inferred from the driver header, which is only reliable for
   * auto-increment keys in batches without explicit IDs - otherwise those entries are
   * `undefined` rather than potentially wrong values.
   * @param entity the entity to persist on
   * @param payload the data to be persisted
   * @return the IDs
   */
  insertMany<E extends object>(entity: Type<E>, payload: EntityData<E>[]): Promise<(IdValue<E> | undefined)[]>;

  /**
   * Insert or update a record based on the conflict paths.
   * @param entity the entity to persist on
   * @param conflictPaths the keys to use for the unique search
   * @param payload the data to be persisted
   * @return operation metadata; see {@link QueryUpdateResult}
   */
  upsertOne<E extends object>(
    entity: Type<E>,
    conflictPaths: QueryConflictPaths<E>,
    payload: EntityData<E>,
  ): Promise<QueryUpdateResult>;

  /**
   * Insert or update many records based on the conflict paths.
   * @param entity the entity to persist on
   * @param conflictPaths the keys to use for the unique search
   * @param payload the data to be persisted
   * @return operation metadata; see {@link QueryUpdateResult}
   */
  upsertMany<E extends object>(
    entity: Type<E>,
    conflictPaths: QueryConflictPaths<E>,
    payload: EntityData<E>[],
  ): Promise<QueryUpdateResult>;

  /**
   * insert or update a record.
   * @param entity the entity to persist on
   * @param payload the data to be persisted
   * @return the ID
   */
  saveOne<E extends object>(entity: Type<E>, payload: EntityData<E>): Promise<IdValue<E> | undefined>;

  /**
   * Insert or update records.
   * @param entity the entity to persist on
   * @param payload the data to be persisted
   * @return the IDs
   */
  saveMany<E extends object>(entity: Type<E>, payload: EntityData<E>[]): Promise<(IdValue<E> | undefined)[]>;

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
   * How many rows the engine's own statistics say the table holds, without reading one: Postgres'
   * `pg_class.reltuples`, CockroachDB's table statistics, MySQL/MariaDB's `information_schema`,
   * MongoDB's `estimatedDocumentCount`. For a table too big to {@link count} cheaply.
   *
   * The whole table, and only ever approximately. It takes no filter because none of those sources
   * can answer one, which also puts soft-deleted rows and every entity `filters` inside the number.
   * It is as stale as the last `ANALYZE`/autovacuum (Postgres reports nothing at all until the
   * first one, which reads here as `0`), and a table SQLite can answer for does not exist - it
   * throws there rather than quietly running the scan this exists to avoid.
   * @param entity the target entity
   * @return the estimated number of rows
   */
  estimatedCount<E extends object>(entity: Type<E>): Promise<number>;
}
