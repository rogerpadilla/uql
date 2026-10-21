import type { UqlContext } from '../type/index.js';
import { asyncScope } from '../util/asyncScope.js';

/** Holds the current {@link UqlContext} for the active async flow (per request/transaction). */
const contextScope = asyncScope<UqlContext>();

/**
 * Runs `callback` with a {@link UqlContext} parameterized filters read, across `await`s and transactions.
 * @example `await withContext({ tenantId }, () => querier.findMany(Invoice, {}))`
 */
export function withContext<T>(context: UqlContext, callback: () => T): T {
  return contextScope.run(context, callback);
}

/** The ambient context set by the nearest enclosing {@link withContext}, or `undefined`. */
export function getContext(): UqlContext | undefined {
  return contextScope.get();
}

/**
 * A runner that re-establishes the current context, for work `AsyncLocalStorage` does not follow:
 * `emitter.on('chunk', (chunk) => scoped(() => saveChunk(chunk)))`.
 */
export function captureContext(): <T>(callback: () => T) => T {
  const context = getContext();
  return (callback) => (context ? withContext(context, callback) : callback());
}
