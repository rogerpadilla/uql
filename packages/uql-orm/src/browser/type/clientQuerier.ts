import type { EntityData, QuerierResult, QueryOptions, SharedQuerier, Type, WrittenId } from '../../type/index.js';
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
  ): QuerierResult<'client', WrittenId<E> | undefined>;

  insertMany<E extends object>(
    entity: Type<E>,
    payload: EntityData<E>[],
    opts?: RequestOptions,
  ): QuerierResult<'client', (WrittenId<E> | undefined)[]>;

  saveOne<E extends object>(
    entity: Type<E>,
    payload: EntityData<E>,
    opts?: RequestOptions,
  ): QuerierResult<'client', WrittenId<E> | undefined>;

  saveMany<E extends object>(
    entity: Type<E>,
    payload: EntityData<E>[],
    opts?: RequestOptions,
  ): QuerierResult<'client', (WrittenId<E> | undefined)[]>;
}
