import type { QueryRaw } from './queryRaw.js';

/**
 * The envelope a wire response wraps its result in.
 */
export type RequestSuccessResponse<E> = {
  data: E;
  count?: number;
};

/**
 * A {@link RequestSuccessResponse} whose `count` is always present - what `findManyAndCount` sends.
 */
export type RequestCountedSuccessResponse<E> = RequestSuccessResponse<E> & {
  count: number;
};

/**
 * Which side of the wire a querier sits on. A server querier hands the result back directly, a
 * client one hands back the envelope its transport wrapped it in.
 */
export type QuerierTransport = 'server' | 'client';

/**
 * The `raw` SQL a transport carries. A client's query and payload travel as JSON, which a `raw` fragment
 * is not: it would arrive as `{}`, so the client's types refuse one rather than let it leave.
 */
export type QuerierRaw<W extends QuerierTransport> = { server: QueryRaw; client: never }[W];

/**
 * A querier method's result on a transport: `Promise<User[]>` on the server, the response envelope on
 * the client. A map indexed by the transport, which resolves away in hovers.
 */
export type QuerierResult<W extends QuerierTransport, T> = {
  server: Promise<T>;
  client: Promise<RequestSuccessResponse<T>>;
}[W];

/**
 * `findManyAndCount`'s result: the one shape the transports disagree on past the envelope, a tuple
 * on the server against a counted envelope on the client.
 */
export type QuerierCountedResult<W extends QuerierTransport, T> = {
  server: Promise<[T[], number]>;
  client: Promise<RequestCountedSuccessResponse<T[]>>;
}[W];
