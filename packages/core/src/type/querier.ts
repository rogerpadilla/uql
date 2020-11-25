import { Query, QueryFilter, QueryOne, QueryOptions } from './query';

/**
 * Use a class to be able to detect instances at runtime (via instanceof).
 */
export interface Querier<ID = any> {
  insert<T>(type: { new (): T }, body: T[]): Promise<ID[]>;

  insertOne<T>(type: { new (): T }, body: T): Promise<ID>;

  update<T>(type: { new (): T }, filter: QueryFilter<T>, body: T): Promise<number>;

  updateOneById<T>(type: { new (): T }, id: ID, body: T): Promise<number>;

  find<T>(type: { new (): T }, qm: Query<T>, opts?: QueryOptions): Promise<T[]>;

  findOne<T>(type: { new (): T }, qm: Query<T>, opts?: QueryOptions): Promise<T>;

  findOneById<T>(type: { new (): T }, id: ID, qo: QueryOne<T>, opts?: QueryOptions): Promise<T>;

  remove<T>(type: { new (): T }, filter: QueryFilter<T>): Promise<number>;

  removeOneById<T>(type: { new (): T }, id: ID): Promise<number>;

  count<T>(type: { new (): T }, filter?: QueryFilter<T>): Promise<number>;

  query(query: string): Promise<any>;

  readonly hasOpenTransaction: boolean;

  beginTransaction(): Promise<void>;

  commitTransaction(): Promise<void>;

  rollbackTransaction(): Promise<void>;

  release(): Promise<void>;
}
