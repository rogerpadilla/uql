import type { Querier } from '../type/index.js';

/**
 * Browser build of the transactional querier context: bundlers targeting the browser resolve
 * `querierContext.ts` to this file (see the `browser` map in package.json), keeping the root entrypoint
 * free of `node:async_hooks`.
 *
 * Nothing in a browser bundle opens a transaction. The browser querier serializes queries over HTTP and
 * the server owns the transaction, so there is no ambient querier to hand out and no flow to track.
 */
export function withQuerierContext<T>(_querier: Querier, callback: () => T): T {
  return callback();
}

export function currentQuerier(): Querier {
  throw new TypeError(
    'currentQuerier() is server-only: transactions run on the server, and the browser querier sends each ' +
      'request over HTTP. Call it from server code, or use the querier you already have.',
  );
}

export function currentQuerierIfAny(): Querier | undefined {
  return undefined;
}
