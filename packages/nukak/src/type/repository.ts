import type { IdValue } from './entity.js';
import type { QueryCriteria, QueryOptions, QueryProject, QuerySearch, QueryOneCriteria } from './query.js';
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
   * @param qm the criteria options
   */
  findOneById(id: IdValue<E>, project?: QueryProject<E>): Promise<any>;

  /**
   * obtains the first record matching the given search parameters.
   * @param qm the criteria options
   */
  findOne(qm: QueryOneCriteria<E>, project?: QueryProject<E>): Promise<any>;

  /**
   * obtains the records matching the given search parameters.
   * @param qm the criteria options
   */
  findMany(qm: QueryCriteria<E>, project?: QueryProject<E>): Promise<any>;

  /**
   * obtains the records matching the given search parameters,
   * also counts the number of matches ignoring pagination.
   * @param qm the criteria options
   */
  findManyAndCount(qm: QueryCriteria<E>, project?: QueryProject<E>): Promise<any>;

  /**
   * counts the number of records matching the given search parameters.
   * @param qm the search options
   */
  count(qm?: QuerySearch<E>): Promise<any>;

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
  findOneById(id: IdValue<E>, project?: QueryProject<E>): Promise<E>;

  findOne(qm: QueryOneCriteria<E>, project?: QueryProject<E>): Promise<E>;

  findMany(qm: QueryCriteria<E>, project?: QueryProject<E>): Promise<E[]>;

  findManyAndCount(qm: QueryCriteria<E>, project?: QueryProject<E>): Promise<[E[], number]>;

  count(qm?: QuerySearch<E>): Promise<number>;

  insertOne(payload: E): Promise<IdValue<E>>;

  insertMany(payload: E[]): Promise<IdValue<E>[]>;

  updateOneById(id: IdValue<E>, payload: E): Promise<number>;

  updateMany(qm: QuerySearch<E>, payload: E): Promise<number>;

  saveOne(payload: E): Promise<IdValue<E>>;

  saveMany?(payload: E[]): Promise<IdValue<E>[]>;

  deleteOneById(id: IdValue<E>, opts?: QueryOptions): Promise<number>;

  deleteMany(qm: QuerySearch<E>, opts?: QueryOptions): Promise<number>;
}
