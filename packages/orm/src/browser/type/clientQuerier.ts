import type { Type, EntityWrite, QueryOptions, SharedQuerier, WrittenId } from '../../type/index.js';
import type { CallOptions } from './transport.js';

/**
 * Client-side querier: {@link SharedQuerier} on the `'client'` transport, answering what the server querier
 * answers, every method taking an extra `opts?: CallOptions` for its transport. The writes are restated here: the
 * server's infer what `returning` reads back from their options, which the client's take none of.
 */
export interface ClientQuerier extends SharedQuerier<'client', CallOptions, QueryOptions & CallOptions> {
  insertOne<E extends object>(
    entity: Type<E>,
    payload: EntityWrite<E>,
    opts?: CallOptions,
  ): Promise<NonNullable<WrittenId<E>>>;

  insertMany<E extends object>(
    entity: Type<E>,
    payload: readonly EntityWrite<E>[],
    opts?: CallOptions,
  ): Promise<NonNullable<WrittenId<E>>[]>;

  saveOne<E extends object>(
    entity: Type<E>,
    payload: EntityWrite<E>,
    opts?: CallOptions,
  ): Promise<NonNullable<WrittenId<E>>>;

  saveMany<E extends object>(
    entity: Type<E>,
    payload: readonly EntityWrite<E>[],
    opts?: CallOptions,
  ): Promise<NonNullable<WrittenId<E>>[]>;
}
