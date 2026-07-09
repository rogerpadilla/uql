import { AsyncLocalStorage } from 'node:async_hooks';
import type { UqlContext } from '../type/index.js';

export * from './securityError.js';

/** Holds the current {@link UqlContext} for the active async flow (per request/transaction). */
const contextStorage = new AsyncLocalStorage<UqlContext>();

/**
 * Runs `callback` with an ambient {@link UqlContext} that parameterized filters resolve from.
 * The context propagates across `await`s, `Promise.all` fan-out, and transactions (which reuse the
 * same querier), so every query inside the callback is scoped without threading it through calls.
 *
 * Browser bundles resolve this module to `context.browser.ts` (see the `browser` map in
 * package.json), which keeps the same API without `node:async_hooks`.
 * @example `await withContext({ tenantId }, () => querier.findMany(Invoice, {}))`
 */
export function withContext<T>(context: UqlContext, callback: () => T): T {
  return contextStorage.run(context, callback);
}

/** The ambient context set by the nearest enclosing {@link withContext}, or `undefined`. */
export function getContext(): UqlContext | undefined {
  return contextStorage.getStore();
}

/**
 * Captures the current ambient context and returns a runner that re-establishes it later. Use it to
 * carry the context across event boundaries where `AsyncLocalStorage` does not propagate - emitter
 * callbacks, timers, and queued work run on their own async ticks, so a context set by
 * {@link withContext} is not visible inside them unless replayed:
 *
 * ```ts
 * const scoped = captureContext(); // e.g. inside a scoped request or job
 * emitter.on('chunk', (chunk) => scoped(() => saveChunk(chunk))); // runs with that context
 * ```
 *
 * When no context is active at capture time, the runner just invokes the callback.
 */
export function captureContext(): <T>(callback: () => T) => T {
  const context = getContext();
  return (callback) => (context ? withContext(context, callback) : callback());
}
