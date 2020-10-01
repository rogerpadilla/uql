import { Query, QueryFilter, QueryOneFilter, QueryOptions } from './query';

export interface QuerierPoolConnection {
  query(query: string): Promise<any>;
  release(): void | Promise<void>;
}

export interface QuerierPool<T extends Querier = Querier> {
  getQuerier(): Promise<T>;
  end(): Promise<void>;
}

/**
 * Use a class to be able to detect instances at runtime (via instanceof).
 */
export abstract class Querier<ID = any> {
  abstract insert<T>(type: { new (): T }, body: T[]): Promise<ID>;
  abstract insertOne<T>(type: { new (): T }, body: T): Promise<ID>;
  abstract update<T>(type: { new (): T }, filter: QueryFilter<T>, body: T): Promise<number>;
  abstract findOne<T>(type: { new (): T }, qm: QueryOneFilter<T>, opts?: QueryOptions): Promise<T>;
  abstract find<T>(type: { new (): T }, qm: Query<T>, opts?: QueryOptions): Promise<T[]>;
  abstract query(query: string): Promise<any>;
  abstract count<T>(type: { new (): T }, filter?: QueryFilter<T>): Promise<number>;
  abstract remove<T>(type: { new (): T }, filter: QueryFilter<T>): Promise<number>;
  abstract readonly hasOpenTransaction: boolean;
  abstract beginTransaction(): Promise<void>;
  abstract commitTransaction(): Promise<void>;
  abstract rollbackTransaction(): Promise<void>;
  abstract release(): Promise<void>;
}
