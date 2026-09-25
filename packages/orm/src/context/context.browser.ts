import type { UqlContext } from '../type/index.js';

// The browser's `context.ts`, without `node:async_hooks`. Filters never resolve in a browser, so this
// only keeps the API; it does not carry a context across `await`s.
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
