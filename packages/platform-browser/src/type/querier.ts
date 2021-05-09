import { QueryFilter, Query, QueryOne } from '@uql/core/type';
import { RequestOptions, RequestSuccessResponse } from './request';

export type Querier<ID = any> = {
  insertOne<E>(entity: { new (): E }, body: E, opts?: RequestOptions): Promise<RequestSuccessResponse<ID>>;

  updateOneById<E>(
    entity: { new (): E },
    id: ID,
    body: E,
    opts?: RequestOptions
  ): Promise<RequestSuccessResponse<number>>;

  saveOne<E>(entity: { new (): E }, body: E, opts?: RequestOptions): Promise<RequestSuccessResponse<E>>;

  find<E>(entity: { new (): E }, qm: Query<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<E[]>>;

  findOne<E>(entity: { new (): E }, qm: Query<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<E>>;

  findOneById<E>(
    entity: { new (): E },
    id: ID,
    qo: QueryOne<E>,
    opts?: RequestOptions
  ): Promise<RequestSuccessResponse<E>>;

  remove<E>(
    entity: { new (): E },
    filter: QueryFilter<E>,
    opts?: RequestOptions
  ): Promise<RequestSuccessResponse<number>>;

  removeOneById<E>(entity: { new (): E }, id: ID, opts?: RequestOptions): Promise<RequestSuccessResponse<number>>;

  count<E>(
    entity: { new (): E },
    filter?: QueryFilter<E>,
    opts?: RequestOptions
  ): Promise<RequestSuccessResponse<number>>;
};
