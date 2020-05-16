import { QueryFilter, Query, QueryOne, QueryOneFilter } from '../type/query';
import { RequestSuccessResponse, RequestOptions } from '../http/type';
import { Querier } from '../datasource/type';

export interface Repository<T, ID = any> {
  readonly type: { new (): T };
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

export interface ClientRepository<T, ID = any> extends Repository<T, ID> {
  insertOne(body: T, opts?: RequestOptions): Promise<RequestSuccessResponse<ID>>;
  updateOneById(id: ID, body: T, opts?: RequestOptions): Promise<RequestSuccessResponse<ID>>;
  saveOne(body: T, opts?: RequestOptions): Promise<RequestSuccessResponse<ID>>;
  findOneById(id: ID, qm?: QueryOne<T>, opts?: RequestOptions): Promise<RequestSuccessResponse<T>>;
  findOne(qm: QueryOneFilter<T>, opts?: any): Promise<RequestSuccessResponse<T>>;
  find(qm: Query<T>, opts?: RequestOptions): Promise<RequestSuccessResponse<T[]>>;
  removeOneById(id: ID, opts?: RequestOptions): Promise<RequestSuccessResponse<ID>>;
  remove(filter: QueryFilter<T>, opts?: RequestOptions): Promise<RequestSuccessResponse<number>>;
  count(filter: QueryFilter<T>, opts?: RequestOptions): Promise<RequestSuccessResponse<number>>;
}

export interface ServerRepository<T, ID = any> extends Repository<T, ID> {
  insertOne(body: T, querier?: Querier): Promise<ID>;
  updateOneById(id: ID, body: T, querier?: Querier): Promise<ID>;
  saveOne(body: T, querier?: Querier): Promise<ID>;
  findOneById(id: ID, qm?: QueryOne<T>, querier?: Querier): Promise<T>;
  findOne(qm: QueryOneFilter<T>, opts?: any): Promise<T>;
  find(qm: Query<T>, querier?: Querier): Promise<T[]>;
  removeOneById(id: ID, querier?: Querier): Promise<ID>;
  remove(filter: QueryFilter<T>, querier?: Querier): Promise<number>;
  count(filter: QueryFilter<T>, querier?: Querier): Promise<number>;
}

export type CustomRepositoryConstructor<T, ID = any> = new () => Repository<T, ID>;

export type GenericRepositoryConstructor<T, ID = any> = new (type: { new (): T }) => Repository<T, ID>;
