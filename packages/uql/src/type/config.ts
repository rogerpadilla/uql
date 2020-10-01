import { EntityMeta } from './entity';
import { Querier } from './querier';
import { Query, QueryFilter, QueryOne, QueryOneFilter } from './query';

export interface IsomorphicRepository<T, ID = any> {
  readonly meta: EntityMeta<T>;
  insertOne(body: T, opts?: any): Promise<any>;
  updateOneById(id: ID, body: T, opts?: any): Promise<any>;
  saveOne(body: T, opts?: any): Promise<any>;
  findOneById(id: ID, qm?: QueryOne<T>, opts?: any): Promise<any>;
  findOne(qm: QueryOneFilter<T>, opts?: any): Promise<any>;
  find(qm: Query<T>, opts?: any): Promise<any>;
  removeOneById(id: ID, opts?: any): Promise<any>;
  remove(filter: QueryFilter<T>, opts?: any): Promise<any>;
  count(filter: QueryFilter<T>, opts?: any): Promise<any>;
}

export interface ServerRepository<T, ID = any> extends IsomorphicRepository<T, ID> {
  insertOne(body: T, querier?: Querier<ID>): Promise<ID>;
  updateOneById(id: ID, body: T, querier?: Querier<ID>): Promise<void>;
  saveOne(body: T, querier?: Querier<ID>): Promise<ID>;
  findOneById(id: ID, qm?: QueryOne<T>, querier?: Querier<ID>): Promise<T>;
  findOne(qm: QueryOneFilter<T>, opts?: any): Promise<T>;
  find(qm: Query<T>, querier?: Querier<ID>): Promise<T[]>;
  removeOneById(id: ID, querier?: Querier<ID>): Promise<void>;
  remove(filter: QueryFilter<T>, querier?: Querier<ID>): Promise<number>;
  count(filter: QueryFilter<T>, querier?: Querier<ID>): Promise<number>;
}

export interface QuerierPoolOptions {
  host?: string;
  user?: string;
  password?: string;
  database?: string;
  port?: number;
}

export type DatasourceDriver = 'mysql' | 'mysql2' | 'mariadb' | 'pg' | 'sqlite3' | 'mongodb';

export type DatasourceOptions = { driver: DatasourceDriver } & QuerierPoolOptions;

export type CustomRepositoryConstructor<T, ID = any> = new () => IsomorphicRepository<T, ID>;

export type GenericRepositoryConstructor<T, ID = any> = new (type: { new (): T }) => IsomorphicRepository<T, ID>;

export type UqlOptions = {
  autoCount?: boolean;
  datasource?: DatasourceOptions;
  defaultRepositoryClass?: GenericRepositoryConstructor<any>;
  logger?: UqlLogger;
  loggingLevel?: UqlLoggingLevel;
};

export type UqlLogger = {
  debug(message?: any, ...optionalParams: any[]): any;
  info(message?: any, ...optionalParams: any[]): any;
  warn(message?: any, ...optionalParams: any[]): any;
  error(message?: any, ...optionalParams: any[]): any;
};

export type UqlLoggingLevel = 'debug' | 'info' | 'warn' | 'error' | number;
