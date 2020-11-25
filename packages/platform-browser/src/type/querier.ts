import { QueryFilter, Query, QueryOne } from '@uql/core/type';
import { RequestOptions, RequestSuccessResponse } from './request';

export interface Querier<ID = any> {
  insertOne<T>(type: { new (): T }, body: T, opts?: RequestOptions): Promise<RequestSuccessResponse<ID>>;

  updateOneById<T>(
    type: { new (): T },
    id: ID,
    body: T,
    opts?: RequestOptions
  ): Promise<RequestSuccessResponse<number>>;

  saveOne<T>(type: { new (): T }, body: T, opts?: RequestOptions): Promise<RequestSuccessResponse<T>>;

  find<T>(type: { new (): T }, qm: Query<T>, opts?: RequestOptions): Promise<RequestSuccessResponse<T[]>>;

  findOne<T>(type: { new (): T }, qm: Query<T>, opts?: RequestOptions): Promise<RequestSuccessResponse<T>>;

  findOneById<T>(
    type: { new (): T },
    id: ID,
    qo: QueryOne<T>,
    opts?: RequestOptions
  ): Promise<RequestSuccessResponse<T>>;

  remove<T>(
    type: { new (): T },
    filter: QueryFilter<T>,
    opts?: RequestOptions
  ): Promise<RequestSuccessResponse<number>>;

  removeOneById<T>(type: { new (): T }, id: ID, opts?: RequestOptions): Promise<RequestSuccessResponse<number>>;

  count<T>(
    type: { new (): T },
    filter?: QueryFilter<T>,
    opts?: RequestOptions
  ): Promise<RequestSuccessResponse<number>>;
}
