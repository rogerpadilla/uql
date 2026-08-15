import type { CrudOperation, RequestCountedSuccessResponse, RequestSuccessResponse } from '../../http/contract.js';
import type { IdValue, Query, QueryOne, QueryOptions, QuerySearch, Type, UpdatePayload } from '../../type/index.js';
import type { RequestOptions } from './request.js';

/**
 * Client-side querier - mirrors {@link UniversalQuerier} method names and semantics but with two structural differences:
 * 1. Every return type is wrapped in `RequestSuccessResponse<T>` (adds `data`/`count` envelope).
 * 2. Every method accepts an extra `opts?: RequestOptions` parameter.
 *
 * These differences prevent clean `extends UniversalQuerier` - TypeScript does not support
 * higher-kinded type wrappers, so the interfaces are kept in sync by convention.
 * @see UniversalQuerier for the server-side contract with direct return types.
 */

export interface ClientQuerier {
  findOneById<E extends object>(
    entity: Type<E>,
    id: IdValue<E>,
    q?: QueryOne<E>,
    opts?: RequestOptions,
  ): Promise<RequestSuccessResponse<E | undefined>>;

  findOne<E extends object>(
    entity: Type<E>,
    q: QueryOne<E>,
    opts?: RequestOptions,
  ): Promise<RequestSuccessResponse<E | undefined>>;

  findMany<E extends object>(entity: Type<E>, q: Query<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<E[]>>;

  findManyAndCount<E extends object>(
    entity: Type<E>,
    q: Query<E>,
    opts?: RequestOptions,
  ): Promise<RequestCountedSuccessResponse<E[]>>;

  count<E extends object>(
    entity: Type<E>,
    q?: QuerySearch<E>,
    opts?: RequestOptions,
  ): Promise<RequestSuccessResponse<number>>;

  insertOne<E extends object>(
    entity: Type<E>,
    payload: E,
    opts?: RequestOptions,
  ): Promise<RequestSuccessResponse<IdValue<E> | undefined>>;

  insertMany<E extends object>(
    entity: Type<E>,
    payload: E[],
    opts?: RequestOptions,
  ): Promise<RequestSuccessResponse<IdValue<E>[]>>;

  updateOneById<E extends object>(
    entity: Type<E>,
    id: IdValue<E>,
    payload: UpdatePayload<E>,
    opts?: RequestOptions,
  ): Promise<RequestSuccessResponse<number>>;

  updateMany<E extends object>(
    entity: Type<E>,
    q: QuerySearch<E>,
    payload: UpdatePayload<E>,
    opts?: RequestOptions,
  ): Promise<RequestSuccessResponse<number>>;

  saveOne<E extends object>(
    entity: Type<E>,
    payload: E,
    opts?: RequestOptions,
  ): Promise<RequestSuccessResponse<IdValue<E>>>;

  saveMany<E extends object>(
    entity: Type<E>,
    payload: E[],
    opts?: RequestOptions,
  ): Promise<RequestSuccessResponse<IdValue<E>[]>>;

  deleteOneById<E extends object>(
    entity: Type<E>,
    id: IdValue<E>,
    opts?: QueryOptions & RequestOptions,
  ): Promise<RequestSuccessResponse<number>>;

  deleteMany<E extends object>(
    entity: Type<E>,
    qm: QuerySearch<E>,
    opts?: QueryOptions & RequestOptions,
  ): Promise<RequestSuccessResponse<number>>;
}

type AssertEmpty<T extends never> = T;

/**
 * Compile-time guarantee (module-private, not part of the public API) that {@link ClientQuerier}
 * implements every wire operation in CRUD_ROUTES: adding a route without a matching client
 * method breaks this alias.
 */
type ClientQuerierCoversAllCrudOperations = AssertEmpty<Exclude<CrudOperation, keyof ClientQuerier>>;
