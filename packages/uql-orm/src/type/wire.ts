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
 * A querier method's result on the given transport, so one signature serves both:
 * `QuerierResult<'server', User[]>` is `Promise<User[]>` and `QuerierResult<'client', User[]>` is
 * `Promise<RequestSuccessResponse<User[]>>`. Indexing a map by the transport is what stands in for
 * the higher-kinded wrapper TypeScript cannot express, and it resolves away: errors and hovers show
 * the `Promise<User[]>` it picked, never this indirection.
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
