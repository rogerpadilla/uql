import type { UqlContext } from '../type/index.js';

// The browser's `context.ts`, without `node:async_hooks`. Filters never resolve in a browser, so this
// only keeps the API; it does not carry a value across `await`s.

/** A value held for a synchronous callback. See `context.ts` for the server behavior. */
export function asyncScope<T>(): { run<R>(value: T, callback: () => R): R; get(): T | undefined } {
  let current: T | undefined;
  return {
    run: (value, callback) => {
      const previous = current;
      current = value;
      try {
        return callback();
      } finally {
        current = previous;
      }
    },
    get: () => current,
  };
}

const contextScope = asyncScope<UqlContext>();

/** Runs `callback` with an ambient {@link UqlContext}. See `context.ts` for the server behavior. */
export function withContext<T>(context: UqlContext, callback: () => T): T {
  return contextScope.run(context, callback);
}

/** The ambient context set by the nearest enclosing {@link withContext}, or `undefined`. */
export function getContext(): UqlContext | undefined {
  return contextScope.get();
}

/** Captures the current context and returns a runner that re-establishes it later. See `context.ts`. */
export function captureContext(): <T>(callback: () => T) => T {
  const context = getContext();
  return (callback) => (context ? withContext(context, callback) : callback());
}
