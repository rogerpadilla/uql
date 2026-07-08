import { AsyncLocalStorage } from 'node:async_hooks';
import type { UqlContext } from '../type/index.js';

/** Holds the current {@link UqlContext} for the active async flow (per request/transaction). */
const contextStorage = new AsyncLocalStorage<UqlContext>();

/**
 * Runs `callback` with an ambient {@link UqlContext} that parameterized filters resolve from.
 * The context propagates across `await`s, `Promise.all` fan-out, and transactions (which reuse the
 * same querier), so every query inside the callback is scoped without threading it through calls.
 * @example `await withContext({ tenantId }, () => querier.findMany(Invoice, {}))`
 */
export function withContext<T>(context: UqlContext, callback: () => T): T {
  return contextStorage.run(context, callback);
}

/** The ambient context set by the nearest enclosing {@link withContext}, or `undefined`. */
export function getContext(): UqlContext | undefined {
  return contextStorage.getStore();
}

/** Thrown when a `security` filter can't resolve its condition - fails the query closed. */
export class UqlSecurityError extends Error {
  override name = 'UqlSecurityError';
}
