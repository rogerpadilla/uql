import type { Type } from './utility.js';
import type { QueryOptions, QuerySearch, Query, QueryOne } from './query.js';
import type { Repository } from './repository.js';
import type { IdValue } from './entity.js';
import type { UniversalQuerier } from './universalQuerier.js';

/**
 * Isolation levels for transactions.
 */
export type IsolationLevel = 'read uncommitted' | 'read committed' | 'repeteable read' | 'serializable';

export interface Querier extends UniversalQuerier {
  findOneById<E>(entity: Type<E>, id: IdValue<E>, q?: QueryOne<E>): Promise<E>;

  findOne<E>(entity: Type<E>, q: QueryOne<E>): Promise<E>;

  findMany<E>(entity: Type<E>, q: Query<E>): Promise<E[]>;

  findManyAndCount<E>(entity: Type<E>, q: Query<E>): Promise<[E[], number]>;

  count<E>(entity: Type<E>, q: QuerySearch<E>): Promise<number>;

  insertOne<E>(entity: Type<E>, payload: E): Promise<IdValue<E>>;

  insertMany<E>(entity: Type<E>, payload: E[]): Promise<IdValue<E>[]>;

  updateOneById<E>(entity: Type<E>, id: IdValue<E>, payload: E): Promise<number>;

  updateMany<E>(entity: Type<E>, q: QuerySearch<E>, payload: E): Promise<number>;

  saveOne<E>(entity: Type<E>, payload: E): Promise<IdValue<E>>;

  saveMany<E>(entity: Type<E>, payload: E[]): Promise<IdValue<E>[]>;

  deleteOneById<E>(entity: Type<E>, id: IdValue<E>, opts?: QueryOptions): Promise<number>;

  deleteMany<E>(entity: Type<E>, q: QuerySearch<E>, opts?: QueryOptions): Promise<number>;

  getRepository<E>(entity: Type<E>): Repository<E>;

  /**
   * whether this querier is in a transaction or not.
   */
  readonly hasOpenTransaction: boolean;

  /**
   * run the given callback inside a transaction in this querier.
   */
  transaction<T>(callback: () => Promise<T>): Promise<T>;

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
export type Logger = (message: unknown, ...args: unknown[]) => unknown;

export type ExtraOptions = {
  readonly logger?: Logger;
};
