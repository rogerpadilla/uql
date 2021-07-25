import { IdValue } from './entity';
import { Query, QueryCriteria, QueryOne, QueryOptions, QuerySearch } from './query';

export type UniversalRepository<E> = {
  /**
   * Counts the number of records matching the given search parameters.
   * @param qm the search options
   */
  count(qm: QuerySearch<E>): Promise<any>;

  /**
   * Obtains the record with the given primary key.
   * @param id the primary key value
   * @param qo the criteria options
   */
  findOneById(id: IdValue<E>, qo?: QueryOne<E>): Promise<any>;

  /**
   * Obtains the first record matching the given search parameters.
   * @param qm the criteria options
   */
  findOne(qm: QueryOne<E>): Promise<any>;

  /**
   * Obtains the records matching the given search parameters.
   * @param qm the criteria options
   */
  findMany(qm: Query<E>): Promise<any>;

  /**
   * Obtains the records matching the given search parameters,
   * also counts the number of matches ignoring pagination.
   * @param qm the criteria options
   */
  findManyAndCount(qm: Query<E>): Promise<any>;

  /**
   * Inserts a record.
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
   * Updates a record partially.
   * @param id the primary key of the record to be updated
   * @param payload the data to be persisted
   */
  updateOneById(id: IdValue<E>, payload: E): Promise<any>;

  /**
   * Updates many records partially.
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
   * Insert or update records.
   * @param payload the data to be persisted
   */
  saveMany?(payload: E[]): Promise<any>;

  /**
   * Delete or SoftDelete a record.
   * @param id the primary key of the record
   */
  deleteOneById(id: IdValue<E>, opts?: QueryOptions): Promise<any>;

  /**
   * Delete or SoftDelete records.
   * @param qm the criteria to look for the records
   */
  deleteMany(qm: QueryCriteria<E>, opts?: QueryOptions): Promise<any>;
};

export interface Repository<E> extends UniversalRepository<E> {
  count(qm: QueryCriteria<E>): Promise<number>;

  findOneById(id: IdValue<E>, qm?: QueryOne<E>): Promise<E>;

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
