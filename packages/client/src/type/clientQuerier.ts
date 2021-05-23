import { QueryFilter, Query, QueryOne, Type, UniversalQuerier } from '@uql/core/type';
import { RequestOptions, RequestSuccessResponse } from './request';

export interface ClientQuerier extends UniversalQuerier {
  insertMany?<E>(entity: Type<E>, bodies: E[], opts?: RequestOptions): Promise<RequestSuccessResponse<any[]>>;

  insertOne<E>(entity: Type<E>, body: E, opts?: RequestOptions): Promise<RequestSuccessResponse<any>>;

  updateOneById<E>(entity: Type<E>, id: any, body: E, opts?: RequestOptions): Promise<RequestSuccessResponse<number>>;

  updateMany?<E>(
    entity: Type<E>,
    filter: QueryFilter<E>,
    opts?: RequestOptions
  ): Promise<RequestSuccessResponse<number>>;

  saveOne<E>(entity: Type<E>, body: E, opts?: RequestOptions): Promise<RequestSuccessResponse<E>>;

  findMany<E>(entity: Type<E>, qm: Query<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<E[]>>;

  findOne<E>(entity: Type<E>, qm: Query<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<E>>;

  findOneById<E>(entity: Type<E>, id: any, qo: QueryOne<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<E>>;

  removeMany<E>(
    entity: Type<E>,
    filter: QueryFilter<E>,
    opts?: RequestOptions
  ): Promise<RequestSuccessResponse<number>>;

  removeOneById<E>(entity: Type<E>, id: any, opts?: RequestOptions): Promise<RequestSuccessResponse<number>>;

  count<E>(entity: Type<E>, filter?: QueryFilter<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<number>>;
}
