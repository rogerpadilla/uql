/** A value held for a flow: set for the length of a callback, read anywhere inside it. */
type Scope<T> = { run<R>(value: T, callback: () => R): R; get(): T | undefined };

/**
 * The runtime's `AsyncLocalStorage`, read when the module loads rather than imported, so no bundler sees a Node
 * builtin: Node, Bun, Deno and Workers (`nodejs_compat`) have it, a browser does not.
 */
const RUNTIME_STORAGE = globalThis.process?.getBuiltinModule?.('node:async_hooks').AsyncLocalStorage;

/**
 * A value held for the active async flow, across `await`s; in a browser, for a synchronous callback only, which
 * is all it needs there, where filters never resolve.
 */
export function asyncScope<T>(): Scope<T> {
  if (RUNTIME_STORAGE) {
    const store = new RUNTIME_STORAGE<T>();
    return { run: (value, callback) => store.run(value, callback), get: () => store.getStore() };
  }
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
