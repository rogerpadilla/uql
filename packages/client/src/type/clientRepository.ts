import { QueryFilter, Query, QueryOne, UniversalRepository } from '@uql/core/type';
import { RequestOptions, RequestSuccessResponse } from './request';

export interface ClientRepository<E> extends UniversalRepository<E> {
  insertMany?(bodies: E[], opts?: RequestOptions): Promise<RequestSuccessResponse<any[]>>;

  insertOne(body: E, opts?: RequestOptions): Promise<RequestSuccessResponse<any>>;

  updateMany?(filter: QueryFilter<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<number>>;

  saveOne(body: E, opts?: RequestOptions): Promise<RequestSuccessResponse<E>>;

  findMany(qm: Query<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<E[]>>;

  findOne(qm: Query<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<E>>;

  findOneById(id: any, qo: QueryOne<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<E>>;

  removeMany(filter: QueryFilter<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<number>>;

  removeOneById(id: any, opts?: RequestOptions): Promise<RequestSuccessResponse<number>>;

  count(filter?: QueryFilter<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<number>>;
}
