import { Type } from './utility.js';
import { Query, QueryCriteria, QueryOne, QueryOptions, QuerySearch, QueryUnique } from './query.js';
import { Repository } from './repository.js';
import { IdValue } from './entity.js';
import { UniversalQuerier } from './universalQuerier.js';

/**
 * Isolation levels for transactions.
 */
export type IsolationLevel = 'read uncommitted' | 'read committed' | 'repeteable read' | 'serializable';

export interface Querier extends UniversalQuerier {
  count<E>(entity: Type<E>, qm?: QuerySearch<E>): Promise<number>;

  findOneById<E>(entity: Type<E>, id: IdValue<E>, qm?: QueryUnique<E>): Promise<E>;

  findOne<E>(entity: Type<E>, qm: QueryOne<E>): Promise<E>;

  findMany<E>(entity: Type<E>, qm: Query<E>): Promise<E[]>;

  findManyAndCount<E>(entity: Type<E>, qm: Query<E>): Promise<[E[], number]>;

  insertOne<E>(entity: Type<E>, payload: E): Promise<IdValue<E>>;

  insertMany<E>(entity: Type<E>, payload: E[]): Promise<IdValue<E>[]>;

  updateOneById<E>(entity: Type<E>, id: IdValue<E>, payload: E): Promise<number>;

  updateMany<E>(entity: Type<E>, qm: QueryCriteria<E>, payload: E): Promise<number>;

  saveOne<E>(entity: Type<E>, payload: E): Promise<IdValue<E>>;

  saveMany<E>(entity: Type<E>, payload: E[]): Promise<IdValue<E>[]>;

  deleteOneById<E>(entity: Type<E>, id: IdValue<E>, opts?: QueryOptions): Promise<number>;

  deleteMany<E>(entity: Type<E>, qm: QueryCriteria<E>, opts?: QueryOptions): Promise<number>;

  getRepository<E>(entity: Type<E>): Repository<E>;

  /**
   * whether this querier is in a transaction or not.
   */
  readonly hasOpenTransaction: boolean;

  /**
   * run the given callback inside a transaction in this querier.
   */
  transaction<T>(callback: (querier?: ThisType<Querier>) => Promise<T>): Promise<T>;

  /**
   * starts a new transaction in this querier.
   */
  beginTransaction(): Promise<void>;

  /**
   * commits the currently active transaction in this querier.
   */
  commitTransaction(): Promise<void>;

  /**
   * aborts the currently active transaction in this querier.
   */
  rollbackTransaction(): Promise<void>;

  /**
   * release the querier to the pool.
   */
  release(): Promise<void>;
}

/**
 * logger function to debug queries.
 */
export type Logger = (message: any, ...args: any[]) => any;

export type ExtraOptions = {
  readonly logger?: Logger;
};
