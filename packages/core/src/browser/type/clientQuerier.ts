import type { IdValue, Query, QueryOne, QueryOptions, QuerySearch, Type, UpdatePayload } from '../../type/index.js';
import type { RequestOptions, RequestSuccessResponse } from './request.js';

/**
 * Client-side querier — mirrors {@link UniversalQuerier} method names and semantics but with two structural differences:
 * 1. Every return type is wrapped in `RequestSuccessResponse<T>` (adds `data`/`count` envelope).
 * 2. Every method accepts an extra `opts?: RequestOptions` parameter.
 *
 * These differences prevent clean `extends UniversalQuerier` — TypeScript does not support
 * higher-kinded type wrappers, so the interfaces are kept in sync by convention.
 * @see UniversalQuerier for the server-side contract with direct return types.
 */
export interface ClientQuerier {
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
    payload: UpdatePayload<E>,
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
