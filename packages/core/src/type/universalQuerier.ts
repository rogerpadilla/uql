import type { IdValue, UpdatePayload } from './entity.js';
import type { Query, QueryConflictPaths, QueryOne, QueryOptions, QuerySearch, QueryUpdateResult } from './query.js';

import type { Type } from './utility.js';

/**
 * A `querier` allows to interact with the datasource to perform persistence operations on any entity.
 */
export interface UniversalQuerier {
  /**
   * obtains the record with the given primary key.
   * @param entity the target entity
   * @param id the primary key value
   * @param q the additional criteria options
   * @return the record
   */
  findOneById<E extends object>(entity: Type<E>, id: IdValue<E>, q?: QueryOne<E>): Promise<E | undefined>;

  /**
   * obtains the first record matching the given search parameters.
   * @param entity the target entity
   * @param q the criteria options
   * @return the record
   */
  findOne<E extends object>(entity: Type<E>, q: QueryOne<E>): Promise<E | undefined>;

  /**
   * obtains the records matching the given search parameters.
   * @param entity the target entity
   * @param q the criteria options
   * @return the records
   */
  findMany<E extends object>(entity: Type<E>, q: Query<E>): Promise<E[]>;

  /**
   * obtains the records matching the given search parameters,
   * also counts the number of matches ignoring pagination.
   * @param entity the target entity
   * @param q the criteria options
   * @return the records and the count
   */
  findManyAndCount<E extends object>(entity: Type<E>, q: Query<E>): Promise<[E[], number]>;

  /**
   * counts the number of records matching the given search parameters.
   * @param entity the target entity
   * @param q the search options
   * @return the count
   */
  count<E extends object>(entity: Type<E>, q: QuerySearch<E>): Promise<number>;

  /**
   * inserts a record.
   * @param entity the entity to persist on
   * @param payload the data to be persisted
   * @return the ID
   */
  insertOne<E extends object>(entity: Type<E>, payload: E): Promise<IdValue<E>>;

  /**
   * Inserts many records.
   * @param entity the entity to persist on
   * @param payload the data to be persisted
   * @return the IDs
   */
  insertMany?<E extends object>(entity: Type<E>, payload: E[]): Promise<IdValue<E>[]>;

  /**
   * updates a record partially.
   * @param entity the entity to persist on
   * @param id the primary key of the record to be updated
   * @param payload the data to be persisted
   * @return the number of affected records
   */
  updateOneById<E extends object>(entity: Type<E>, id: IdValue<E>, payload: UpdatePayload<E>): Promise<number>;

  /**
   * updates many records partially.
   * @param entity the entity to persist on
   * @param q the criteria to look for the records
   * @param payload the data to be persisted
   * @return the number of affected records
   */
  updateMany?<E extends object>(entity: Type<E>, q: QuerySearch<E>, payload: UpdatePayload<E>): Promise<number>;

  /**
   * Insert or update a record given a search criteria.
   * @param entity the entity to persist on
   * @param conflictPaths  the keys to use for the unique search
   * @param payload the data to be persisted
   * @return void
   */
  upsertOne?<E extends object>(
    entity: Type<E>,
    conflictPaths: QueryConflictPaths<E>,
    payload: E,
  ): Promise<QueryUpdateResult>;

  /**
   * Insert or update many records given a search criteria.
   * @param entity the entity to persist on
   * @param conflictPaths the keys to use for the unique search
   * @param payload the data to be persisted
   * @return void
   */
  upsertMany?<E extends object>(
    entity: Type<E>,
    conflictPaths: QueryConflictPaths<E>,
    payload: E[],
  ): Promise<QueryUpdateResult>;

  /**
   * insert or update a record.
   * @param entity the entity to persist on
   * @param payload the data to be persisted
   * @return the ID
   */
  saveOne<E extends object>(entity: Type<E>, payload: E): Promise<IdValue<E>>;

  /**
   * Insert or update records.
   * @param entity the entity to persist on
   * @param payload the data to be persisted
   * @return the IDs
   */
  saveMany?<E extends object>(entity: Type<E>, payload: E[]): Promise<IdValue<E>[]>;

  /**
   * delete or SoftDelete a record.
   * @param entity the entity to persist on
   * @param id the primary key of the record
   * @return the number of affected records
   */
  deleteOneById<E extends object>(entity: Type<E>, id: IdValue<E>, opts?: QueryOptions): Promise<number>;

  /**
   * delete or SoftDelete records.
   * @param entity the entity to persist on
   * @param q the criteria to look for the records
   * @return the number of affected records
   */
  deleteMany<E extends object>(entity: Type<E>, q: QuerySearch<E>, opts?: QueryOptions): Promise<number>;
}
