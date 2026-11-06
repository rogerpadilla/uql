import { type EntityPathOptions, entityPathOf, type WireCall, wireJson } from '../../http/wireCall.js';
import type { AbstractType } from '../../type/index.js';
import { UqlUsageError } from '../../util/uqlError.js';
import type { ClientQuerier, ClientTransport } from '../type/index.js';
import { createClientQuerier } from './clientQuerier.js';

/** A cache key for a read: `['uql', entityPath, op, the rest of the call as JSON carries it]`, prefixed by entity. */
export type UqlQueryKey = readonly ['uql', string, ...unknown[]];

/** What `useQuery`, `queryOptions` and `prefetchQuery` take: the key a read is cached under, and the read. */
export type UqlQueryOptions<T> = {
  readonly queryKey: UqlQueryKey;
  readonly queryFn: (context: { readonly signal: AbortSignal }) => Promise<T>;
};

/** Query options for a read, and `key(entity)`, the prefix every read of an entity is cached under. */
export type QueryOptionsFor = {
  <T>(read: (querier: ClientQuerier) => Promise<T>): UqlQueryOptions<T>;
  key(entity: AbstractType<unknown>): UqlQueryKey;
};

/**
 * Query options (TanStack Query's, or any cache keyed by JSON) for reads over `transport`: each keyed by the one call
 * the read makes, so the key cannot drift from the fetch, two ops on one query never share an entry, and invalidating
 * `key(User)` reaches every read of `User`. Takes the client's options, so a key names an entity as its call does.
 */
export function createQueryOptions(transport: ClientTransport, opts: EntityPathOptions = {}): QueryOptionsFor {
  const pathOf = entityPathOf(opts);
  const options = <T>(read: (querier: ClientQuerier) => Promise<T>): UqlQueryOptions<T> => {
    const { entity, op, ...rest } = callOf(read, opts);
    return {
      queryKey: ['uql', entity, op, JSON.parse(wireJson(rest))],
      queryFn: ({ signal }) => read(createClientQuerier((call, given) => transport(call, { ...given, signal }), opts)),
    };
  };
  return Object.assign(options, { key: (entity: AbstractType<unknown>) => ['uql', pathOf(entity)] as const });
}

/** The call `read` makes, recorded without sending it: a querier hands its call to the transport before it awaits. */
function callOf(read: (querier: ClientQuerier) => Promise<unknown>, opts: EntityPathOptions): WireCall {
  const calls: WireCall[] = [];
  const recorder = createClientQuerier((call) => {
    calls.push(call);
    return new Promise<never>(() => {});
  }, opts);
  // Never settles once it has made its call; one that fails before it does is refused below.
  read(recorder).catch(() => {});
  const [call] = calls;
  if (!call || calls.length > 1) {
    const why = call ? '' : ': run the read outside `uql()` to see whether it failed before its call';
    throw new UqlUsageError(`a query reads by one call to the API, not ${calls.length}${why}`);
  }
  return call;
}
