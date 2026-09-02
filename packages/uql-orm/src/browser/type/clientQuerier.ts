import type { CrudOperation } from '../../http/contract.js';
import type { EntityData, IdValue, QuerierResult, QueryOptions, SharedQuerier, Type } from '../../type/index.js';
import type { RequestOptions } from './request.js';

/**
 * Client-side querier: {@link SharedQuerier} on the `'client'` transport, so every result arrives in
 * a `RequestSuccessResponse` envelope and every method takes an extra `opts?: RequestOptions`. Only
 * the writes the server declares without options are restated here.
 * @see UniversalQuerier for the same operations with direct return types.
 */
export interface ClientQuerier extends SharedQuerier<'client', RequestOptions, QueryOptions & RequestOptions> {
  insertOne<E extends object>(
    entity: Type<E>,
    payload: EntityData<E>,
    opts?: RequestOptions,
  ): QuerierResult<'client', IdValue<E> | undefined>;

  insertMany<E extends object>(
    entity: Type<E>,
    payload: EntityData<E>[],
    opts?: RequestOptions,
  ): QuerierResult<'client', IdValue<E>[]>;

  saveOne<E extends object>(
    entity: Type<E>,
    payload: EntityData<E>,
    opts?: RequestOptions,
  ): QuerierResult<'client', IdValue<E>>;

  saveMany<E extends object>(
    entity: Type<E>,
    payload: EntityData<E>[],
    opts?: RequestOptions,
  ): QuerierResult<'client', IdValue<E>[]>;
}

type AssertEmpty<T extends never> = T;

/**
 * Compile-time guarantee (module-private, not part of the public API) that {@link ClientQuerier}
 * implements every wire operation in CRUD_ROUTES: adding a route without a matching client
 * method breaks this alias.
 */
type ClientQuerierCoversAllCrudOperations = AssertEmpty<Exclude<CrudOperation, keyof ClientQuerier>>;
