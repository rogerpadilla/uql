import { IdValue } from './entity.js';
import { Querier } from './querier.js';
import { Query, QueryCriteria, QueryOne, QueryOptions, QuerySearch, QueryUnique } from './query.js';

/**
 * A `repository` allows to interact with the datasource to perform persistence operations on a specific entity.
 */
export type UniversalRepository<E> = {
  /**
   * counts the number of records matching the given search parameters.
   * @param qm the search options
   */
  count(qm: QuerySearch<E>): Promise<any>;

  /**
   * obtains the record with the given primary key.
   * @param id the primary key value
   * @param qm the criteria options
   */
  findOneById(id: IdValue<E>, qm?: QueryUnique<E>): Promise<any>;

  /**
   * obtains the first record matching the given search parameters.
   * @param qm the criteria options
   */
  findOne(qm: QueryOne<E>): Promise<any>;

  /**
   * obtains the records matching the given search parameters.
   * @param qm the criteria options
   */
  findMany(qm: Query<E>): Promise<any>;

  /**
   * obtains the records matching the given search parameters,
   * also counts the number of matches ignoring pagination.
   * @param qm the criteria options
   */
  findManyAndCount(qm: Query<E>): Promise<any>;

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
  updateMany?(qm: QueryCriteria<E>, payload: E): Promise<any>;

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
  deleteMany(qm: QueryCriteria<E>, opts?: QueryOptions): Promise<any>;
};

/**
 * base contract for the backend repositories.
 */
export interface Repository<E> extends UniversalRepository<E> {
  /**
   * the `querier` instance to which this `repository` is linked to.
   */
  readonly querier: Querier;

  count(qm: QueryCriteria<E>): Promise<number>;

  findOneById(id: IdValue<E>, qm?: QueryUnique<E>): Promise<E>;

  findOne(qm: QueryOne<E>): Promise<E>;

  findMany(qm: Query<E>): Promise<E[]>;

  findManyAndCount(qm: Query<E>): Promise<[E[], number]>;

  insertOne(payload: E): Promise<IdValue<E>>;

  insertMany(payload: E[]): Promise<IdValue<E>[]>;

  updateOneById(id: IdValue<E>, payload: E): Promise<number>;

  updateMany(qm: QueryCriteria<E>, payload: E): Promise<number>;

  saveOne(payload: E): Promise<IdValue<E>>;

  saveMany?(payload: E[]): Promise<IdValue<E>[]>;

  deleteOneById(id: IdValue<E>, opts?: QueryOptions): Promise<number>;

  deleteMany(qm: QueryCriteria<E>, opts?: QueryOptions): Promise<number>;
}
