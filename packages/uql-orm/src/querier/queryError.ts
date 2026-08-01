import type { LoggerWrapper } from '../util/logger.js';

/**
 * A driver error enriched with context by {@link enrichError}. `query` is always attached; `values`
 * only when the querier's logger is configured to surface them (see {@link enrichError}) - they can
 * carry sensitive data (PII, tokens, etc.) and would otherwise leak into whatever error-tracking
 * pipeline (Sentry, console.error, ...) serializes the error, without the developer opting in.
 */
export interface QueryError extends Error {
  query?: string;
  values?: unknown[];
}

/**
 * Tags `err` with the query it failed on (as {@link QueryError}) and hands it back for the caller to
 * throw. `values` is only attached when `logger?.willLogValues()` is true, i.e. the app already has
 * query values surfacing somewhere (query-level or slow-query logging), so attaching them here does not
 * introduce a new leak surface. Shared by every query call site (timed queries, streams, transaction
 * statements) so the logic lives in one place.
 *
 * Returns rather than throws so `throw enrichError(...)` reads as the control flow it is, which also
 * means callers need no `never` annotation and no unreachable-code suppression.
 */
export function enrichError(
  err: unknown,
  logger: LoggerWrapper | undefined,
  query: string,
  values?: unknown[],
): unknown {
  if (err instanceof Error) {
    const queryError = err as QueryError;
    queryError.query ??= query;
    if (values !== undefined && logger?.willLogValues()) {
      queryError.values ??= values;
    }
  }
  return err;
}
