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
