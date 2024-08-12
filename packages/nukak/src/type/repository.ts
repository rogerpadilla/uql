import type { IdValue } from './entity.js';
import type { Query, QueryConflictPaths, QueryOne, QueryOptions, QuerySearch } from './query.js';
import type { UniversalQuerier } from './universalQuerier.js';
import type { Type } from './utility.js';

/**
 * A `repository` allows to interact with the datasource to perform persistence operations on a specific entity.
 */
export type UniversalRepository<E> = {
  /**
   * the `entity` class to which this `repository` is linked to.
   */
  readonly entity: Type<E>;

  /**
   * the `querier` instance to which this `repository` is linked to.
   */
  readonly querier: UniversalQuerier;

  /**
   * obtains the record with the given primary key.
   * @param id the primary key value
   * @param q the criteria options
   */
  findOneById(id: IdValue<E>, q?: QueryOne<E>): Promise<any>;

  /**
   * obtains the first record matching the given search parameters.
   * @param q the criteria options
   */
  findOne(q: QueryOne<E>): Promise<any>;

  /**
   * obtains the records matching the given search parameters.
   * @param q the criteria options
   */
  findMany(q: Query<E>): Promise<any>;

  /**
   * obtains the records matching the given search parameters,
   * also counts the number of matches ignoring pagination.
   * @param q the criteria options
   */
  findManyAndCount(q: Query<E>): Promise<any>;

  /**
   * counts the number of records matching the given search parameters.
   * @param q the search options
   */
  count(q: QuerySearch<E>): Promise<any>;

  /**
   * inserts a record.
   * @param payload the data to be persisted
   */
  insertOne(payload: E): Promise<any>;

  /**
   * Inserts many records.
   * @param entity the entity to persist on
   * @param payload the data to be persisted
   */
  insertMany?(payload: E[]): Promise<any>;

  /**
   * updates a record partially.
   * @param id the primary key of the record to be updated
   * @param payload the data to be persisted
   */
  updateOneById(id: IdValue<E>, payload: E): Promise<any>;

  /**
   * updates many records partially.
   * @param qm the criteria to look for the records
   * @param payload the data to be persisted
   */
  updateMany?(qm: QuerySearch<E>, payload: E): Promise<any>;

  /**
   * Insert or update a record given a search criteria.
   * @param conflictPaths the keys to use for the unique search.
   * @param payload the data to insert or update.
   */
  upsertOne?(conflictPaths: QueryConflictPaths<E>, payload: E): Promise<any>;

  /**
   * Insert or update a record.
   * @param payload the data to be persisted
   */
  saveOne(payload: E): Promise<any>;

  /**
   * insert or update records.
   * @param payload the data to be persisted
   */
  saveMany?(payload: E[]): Promise<any>;

  /**
   * delete or SoftDelete a record.
   * @param id the primary key of the record
   */
  deleteOneById(id: IdValue<E>, opts?: QueryOptions): Promise<any>;

  /**
   * delete or SoftDelete records.
   * @param qm the criteria to look for the records
   */
  deleteMany(qm: QuerySearch<E>, opts?: QueryOptions): Promise<any>;
};

/**
 * base contract for the backend repositories.
 */
export interface Repository<E> extends UniversalRepository<E> {
  findOneById(id: IdValue<E>, q?: QueryOne<E>): Promise<E>;

  findOne(qm: QueryOne<E>): Promise<E>;

  findMany(qm: Query<E>): Promise<E[]>;

  findManyAndCount(qm: Query<E>): Promise<[E[], number]>;

  count(q?: QuerySearch<E>): Promise<number>;

  insertOne(payload: E): Promise<IdValue<E>>;

  insertMany(payload: E[]): Promise<IdValue<E>[]>;

  updateOneById(id: IdValue<E>, payload: E): Promise<number>;

  updateMany(qm: QuerySearch<E>, payload: E): Promise<number>;

  upsertOne(conflictPaths: QueryConflictPaths<E>, payload: E): Promise<void>;

  saveOne(payload: E): Promise<IdValue<E>>;

  saveMany?(payload: E[]): Promise<IdValue<E>[]>;

  deleteOneById(id: IdValue<E>, opts?: QueryOptions): Promise<number>;

  deleteMany(qm: QuerySearch<E>, opts?: QueryOptions): Promise<number>;
}
