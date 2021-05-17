import { QueryFilter, Query, QueryOne, Type, UniversalQuerier } from '@uql/core/type';
import { RequestOptions, RequestSuccessResponse } from './request';

export interface ClientQuerier<ID = any> extends UniversalQuerier<ID> {
  insertMany?<E>(entity: Type<E>, bodies: E[], opts?: RequestOptions): Promise<RequestSuccessResponse<ID[]>>;

  insertOne<E>(entity: Type<E>, body: E, opts?: RequestOptions): Promise<RequestSuccessResponse<ID>>;

  updateOneById<E>(entity: Type<E>, id: ID, body: E, opts?: RequestOptions): Promise<RequestSuccessResponse<number>>;

  updateMany?<E>(
    entity: Type<E>,
    filter: QueryFilter<E>,
    opts?: RequestOptions
  ): Promise<RequestSuccessResponse<number>>;

  saveOne<E>(entity: Type<E>, body: E, opts?: RequestOptions): Promise<RequestSuccessResponse<E>>;

  findMany<E>(entity: Type<E>, qm: Query<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<E[]>>;

  findOne<E>(entity: Type<E>, qm: Query<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<E>>;

  findOneById<E>(entity: Type<E>, id: ID, qo: QueryOne<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<E>>;

  removeMany<E>(
    entity: Type<E>,
    filter: QueryFilter<E>,
    opts?: RequestOptions
  ): Promise<RequestSuccessResponse<number>>;

  removeOneById<E>(entity: Type<E>, id: ID, opts?: RequestOptions): Promise<RequestSuccessResponse<number>>;

  count<E>(entity: Type<E>, filter?: QueryFilter<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<number>>;
}
