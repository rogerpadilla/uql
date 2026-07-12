import type { CrudOperation, RequestCountedSuccessResponse, RequestSuccessResponse } from '../../http/contract.js';
import type {
  IdValue,
  Query,
  QueryFindResult,
  QueryOne,
  QueryOptions,
  QuerySearch,
  Type,
  UpdatePayload,
} from '../../type/index.js';
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
  findOneById<E extends object, const Q extends QueryOne<E>>(
    entity: Type<E>,
    id: IdValue<E>,
    q?: Q,
    opts?: RequestOptions,
  ): Promise<RequestSuccessResponse<QueryFindResult<E, Q> | undefined>>;

  findOne<E extends object, const Q extends QueryOne<E>>(
    entity: Type<E>,
    q: Q,
    opts?: RequestOptions,
  ): Promise<RequestSuccessResponse<QueryFindResult<E, Q> | undefined>>;

  findMany<E extends object, const Q extends Query<E>>(
    entity: Type<E>,
    q: Q,
    opts?: RequestOptions,
  ): Promise<RequestSuccessResponse<QueryFindResult<E, Q>[]>>;

  findManyAndCount<E extends object, const Q extends Query<E>>(
    entity: Type<E>,
    q: Q,
    opts?: RequestOptions,
  ): Promise<RequestCountedSuccessResponse<QueryFindResult<E, Q>[]>>;

  count<E>(entity: Type<E>, q?: QuerySearch<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<number>>;

  insertOne<E>(entity: Type<E>, payload: E, opts?: RequestOptions): Promise<RequestSuccessResponse<IdValue<E>>>;

  insertMany<E>(entity: Type<E>, payload: E[], opts?: RequestOptions): Promise<RequestSuccessResponse<IdValue<E>[]>>;

  updateOneById<E>(
    entity: Type<E>,
    id: IdValue<E>,
    payload: UpdatePayload<E>,
    opts?: RequestOptions,
  ): Promise<RequestSuccessResponse<number>>;

  updateMany<E>(
    entity: Type<E>,
    q: QuerySearch<E>,
    payload: UpdatePayload<E>,
    opts?: RequestOptions,
  ): Promise<RequestSuccessResponse<number>>;

  saveOne<E>(entity: Type<E>, payload: E, opts?: RequestOptions): Promise<RequestSuccessResponse<IdValue<E>>>;

  saveMany<E>(entity: Type<E>, payload: E[], opts?: RequestOptions): Promise<RequestSuccessResponse<IdValue<E>[]>>;

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

type AssertEmpty<T extends never> = T;

/**
 * Compile-time guarantee (module-private, not part of the public API) that {@link ClientQuerier}
 * implements every wire operation in CRUD_ROUTES: adding a route without a matching client
 * method breaks this alias.
 */
type ClientQuerierCoversAllCrudOperations = AssertEmpty<Exclude<CrudOperation, keyof ClientQuerier>>;
