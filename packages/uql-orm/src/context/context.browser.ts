import type { UqlContext } from '../type/index.js';

export * from './securityError.js';

/**
 * Browser build of the UQL context - bundlers targeting the browser resolve `context.ts` to this
 * file (see the `browser` map in package.json), keeping the root entrypoint free of
 * `node:async_hooks` while exposing the exact same API.
 *
 * Query filters only resolve on the server (the browser querier serializes queries over HTTP and
 * never applies filters), so nothing in a browser bundle reads this context. The save/restore
 * below covers synchronous callbacks; unlike the server's AsyncLocalStorage, it does not propagate
 * across `await` boundaries.
 */
let current: UqlContext | undefined;

/** Runs `callback` with an ambient {@link UqlContext}. See `context.ts` for the server behavior. */
export function withContext<T>(context: UqlContext, callback: () => T): T {
  const previous = current;
  current = context;
  try {
    return callback();
  } finally {
    current = previous;
  }
}

/** The ambient context set by the nearest enclosing {@link withContext}, or `undefined`. */
export function getContext(): UqlContext | undefined {
  return current;
}

/** Captures the current context and returns a runner that re-establishes it later. See `context.ts`. */
export function captureContext(): <T>(callback: () => T) => T {
  const context = getContext();
  return (callback) => (context ? withContext(context, callback) : callback());
}
