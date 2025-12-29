import type { IdValue } from './entity.js';
import type { Query, QueryConflictPaths, QueryOne, QueryOptions, QuerySearch } from './query.js';
import type { UniversalRepository } from './repository.js';
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
  findOneById<E>(entity: Type<E>, id: IdValue<E>, q?: QueryOne<E>): Promise<unknown>;

  /**
   * obtains the first record matching the given search parameters.
   * @param entity the target entity
   * @param q the criteria options
   * @return the record
   */
  findOne<E>(entity: Type<E>, q: QueryOne<E>): Promise<unknown>;

  /**
   * obtains the records matching the given search parameters.
   * @param entity the target entity
   * @param q the criteria options
   * @return the records
   */
  findMany<E>(entity: Type<E>, q: Query<E>): Promise<unknown>;

  /**
   * obtains the records matching the given search parameters,
   * also counts the number of matches ignoring pagination.
   * @param entity the target entity
   * @param q the criteria options
   * @return the records and the count
   */
  findManyAndCount<E>(entity: Type<E>, q: Query<E>): Promise<unknown>;

  /**
   * counts the number of records matching the given search parameters.
   * @param entity the target entity
   * @param q the search options
   * @return the count
   */
  count<E>(entity: Type<E>, q: QuerySearch<E>): Promise<unknown>;

  /**
   * inserts a record.
   * @param entity the entity to persist on
   * @param payload the data to be persisted
   * @return the ID
   */
  insertOne<E>(entity: Type<E>, payload: E): Promise<unknown>;

  /**
   * Inserts many records.
   * @param entity the entity to persist on
   * @param payload the data to be persisted
   * @return the IDs
   */
  insertMany?<E>(entity: Type<E>, payload: E[]): Promise<unknown>;

  /**
   * updates a record partially.
   * @param entity the entity to persist on
   * @param id the primary key of the record to be updated
   * @param payload the data to be persisted
   * @return the number of affected records
   */
  updateOneById<E>(entity: Type<E>, id: IdValue<E>, payload: E): Promise<unknown>;

  /**
   * updates many records partially.
   * @param entity the entity to persist on
   * @param q the criteria to look for the records
   * @param payload the data to be persisted
   * @return the number of affected records
   */
  updateMany?<E>(entity: Type<E>, q: QuerySearch<E>, payload: E): Promise<unknown>;

  /**
   * Insert or update a record given a search criteria.
   * @param entity the entity to persist on
   * @param conflictPaths  the keys to use for the unique search
   * @param payload the data to be persisted
   * @return void
   */
  upsertOne?<E>(entity: Type<E>, conflictPaths: QueryConflictPaths<E>, payload: E): Promise<unknown>;

  /**
   * insert or update a record.
   * @param entity the entity to persist on
   * @param payload the data to be persisted
   * @return the ID
   */
  saveOne<E>(entity: Type<E>, payload: E): Promise<unknown>;

  /**
   * Insert or update records.
   * @param entity the entity to persist on
   * @param payload the data to be persisted
   * @return the IDs
   */
  saveMany?<E>(entity: Type<E>, payload: E[]): Promise<unknown>;

  /**
   * delete or SoftDelete a record.
   * @param entity the entity to persist on
   * @param id the primary key of the record
   * @return the number of affected records
   */
  deleteOneById<E>(entity: Type<E>, id: IdValue<E>, opts?: QueryOptions): Promise<unknown>;

  /**
   * delete or SoftDelete records.
   * @param entity the entity to persist on
   * @param q the criteria to look for the records
   * @return the number of affected records
   */
  deleteMany<E>(entity: Type<E>, q: QuerySearch<E>, opts?: QueryOptions): Promise<unknown>;

  /**
   * get a repository for the given entity.
   * @param entity the entity to get the repository for
   * @return the repository
   */
  getRepository<E>(entity: Type<E>): UniversalRepository<E>;
}
