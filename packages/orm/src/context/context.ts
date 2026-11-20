import type { UqlContext } from '../type/index.js';
import { asyncScope } from '../util/asyncScope.js';

/**
 * The active async flow's {@link UqlContext} (per request/transaction), and whether its statements are built and run
 * past every policy, at every scope they open. One scope, so a flow carries one store.
 */
const flowScope = asyncScope<{ readonly context: UqlContext; readonly past?: true }>();

/**
 * Runs `callback` with a {@link UqlContext} parameterized filters read, across `await`s and transactions.
 * @example `await withContext({ tenantId }, () => querier.findMany(Invoice, {}))`
 */
export function withContext<T>(context: UqlContext, callback: () => T): T {
  return flowScope.run({ ...flowScope.get(), context }, callback);
}

/** Runs `work` past every policy, under its context: the querier's own read-back of what a policy check settled. */
export function pastPolicies<T>(work: () => T): T {
  return flowScope.run({ context: getContext() ?? {}, past: true }, work);
}

/** Runs `work` under no caller, past every policy, as a materialized view's refresh computes every row. */
export function underNoCaller<T>(work: () => T): T {
  return withContext({}, () => pastPolicies(work));
}

/** Whether a statement built here reads past every policy. */
export function readsPastPolicies(): boolean {
  return flowScope.get()?.past === true;
}

/** The ambient context set by the nearest enclosing {@link withContext}, or `undefined`. */
export function getContext(): UqlContext | undefined {
  return flowScope.get()?.context;
}

/**
 * A runner that re-establishes the current context, for work `AsyncLocalStorage` does not follow:
 * `emitter.on('chunk', (chunk) => scoped(() => saveChunk(chunk)))`.
 */
export function captureContext(): <T>(callback: () => T) => T {
  const context = getContext();
  return (callback) => (context ? withContext(context, callback) : callback());
}
