import type { IdValue, Query, QueryOne, QueryOptions, QuerySearch, Type, UniversalQuerier } from '../../type/index.js';
import type { RequestOptions, RequestSuccessResponse } from './request.js';

export interface ClientQuerier extends UniversalQuerier {
  findOneById<E>(
    entity: Type<E>,
    id: IdValue<E>,
    q?: QueryOne<E>,
    opts?: RequestOptions,
  ): Promise<RequestSuccessResponse<E | undefined>>;

  findOne<E>(entity: Type<E>, q: QueryOne<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<E | undefined>>;

  findMany<E>(entity: Type<E>, q: Query<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<E[]>>;

  findManyAndCount<E>(entity: Type<E>, q: Query<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<E[]>>;

  count<E>(entity: Type<E>, q?: QuerySearch<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<number>>;

  insertOne<E>(entity: Type<E>, payload: E, opts?: RequestOptions): Promise<RequestSuccessResponse<IdValue<E>>>;

  updateOneById<E>(
    entity: Type<E>,
    id: IdValue<E>,
    payload: E,
    opts?: RequestOptions,
  ): Promise<RequestSuccessResponse<number>>;

  saveOne<E>(entity: Type<E>, payload: E, opts?: RequestOptions): Promise<RequestSuccessResponse<IdValue<E>>>;

  deleteOneById<E>(
    entity: Type<E>,
    id: IdValue<E>,
    opts?: QueryOptions & RequestOptions,
  ): Promise<RequestSuccessResponse<number>>;

  deleteMany<E>(
    entity: Type<E>,
    qm: QuerySearch<E>,
    opts?: QueryOptions & RequestOptions,
  ): Promise<RequestSuccessResponse<number>>;
}
