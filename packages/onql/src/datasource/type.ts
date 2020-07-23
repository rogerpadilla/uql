import { Query, QueryOptions, QueryFilter, QueryOneFilter } from '../type/query';

export interface QuerierPoolConnection {
  query<T>(sql: string): Promise<T>;
  release(): void | Promise<void>;
}

export interface QuerierPool {
  getQuerier(): Promise<Querier>;
  end(): Promise<void>;
}

export interface QuerierPoolOptions {
  host?: string;
  user?: string;
  password?: string;
  database?: string;
  port?: number;
}

/**
 * Use a class to be able to detect instances at runtime (via instanceof).
 */
export abstract class Querier<ID = any> {
  abstract insert<T>(type: { new (): T }, body: T[]): Promise<ID[]>;
  abstract insertOne<T>(type: { new (): T }, body: T): Promise<ID>;
  abstract update<T>(type: { new (): T }, filter: QueryFilter<T>, body: T): Promise<number>;
  abstract findOne<T>(type: { new (): T }, qm: QueryOneFilter<T>, opts?: QueryOptions): Promise<T>;
  abstract find<T>(type: { new (): T }, qm: Query<T>, opts?: QueryOptions): Promise<T[]>;
  abstract count<T>(type: { new (): T }, filter?: QueryFilter<T>): Promise<number>;
  abstract remove<T>(type: { new (): T }, filter: QueryFilter<T>): Promise<number>;
  abstract readonly hasOpenTransaction: boolean;
  abstract beginTransaction(): Promise<void>;
  abstract commit(): Promise<void>;
  abstract rollback(): Promise<void>;
  abstract release(): Promise<void>;
}

export type DatasourceDriver = 'mysql' | 'mysql2' | 'mariadb' | 'pg' | 'sqlite3' | 'mongodb';

export type DatasourceOptions = { driver: DatasourceDriver } & QuerierPoolOptions;
