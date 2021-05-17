import { QueryFilter, Query, QueryOne, UniversalRepository } from '@uql/core/type';
import { RequestOptions, RequestSuccessResponse } from './request';

export interface ClientRepository<E, ID = any> extends UniversalRepository<E, ID> {
  insertMany?(bodies: E[], opts?: RequestOptions): Promise<RequestSuccessResponse<ID[]>>;

  insertOne(body: E, opts?: RequestOptions): Promise<RequestSuccessResponse<ID>>;

  updateMany?(filter: QueryFilter<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<number>>;

  saveOne(body: E, opts?: RequestOptions): Promise<RequestSuccessResponse<E>>;

  findMany(qm: Query<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<E[]>>;

  findOne(qm: Query<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<E>>;

  findOneById(id: ID, qo: QueryOne<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<E>>;

  removeMany(filter: QueryFilter<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<number>>;

  removeOneById(id: ID, opts?: RequestOptions): Promise<RequestSuccessResponse<number>>;

  count(filter?: QueryFilter<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<number>>;
}
