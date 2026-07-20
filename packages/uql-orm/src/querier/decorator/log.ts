import type { LoggerWrapper } from '../../util/logger.js';

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
 * Tags `err` with the query it failed on (as `QueryError`) and re-throws. `values` is only attached
 * when `logger?.willLogValues()` is true - i.e. the app already has query values surfacing somewhere
 * (query-level or slow-query logging), so attaching them here doesn't introduce a new leak surface.
 * Shared by every query call site - `@Log()`, streams, transaction statements - so this logic lives
 * in one place.
 *
 * Not typed `never`: an async `catch` that calls a `never`-returning function ahead of a `finally`
 * containing an `if` trips a TS control-flow bug (`TS7027 Unreachable code`) unrelated to this logic.
 */
export function enrichError(err: unknown, logger: LoggerWrapper | undefined, query: string, values?: unknown[]): void {
  if (err instanceof Error) {
    const queryError = err as QueryError;
    queryError.query ??= query;
    if (values !== undefined && logger?.willLogValues()) {
      queryError.values ??= values;
    }
  }
  throw err;
}

/**
 * Decorator that logs the execution of a query method.
 * It tracks execution time and logs the query, parameters, and duration.
 * The decorated class must have a `logger` property of type LoggerWrapper.
 *
 * On failure, also attaches the query (and values, when the logger surfaces them) to the thrown
 * error via {@link enrichError} - so that context survives even when nothing gets logged, or is
 * printed in full when the app already opted into it.
 */
export function Log() {
  return (_target: object, _key: string, propDescriptor: PropertyDescriptor): void => {
    const originalMethod = propDescriptor.value;
    propDescriptor.value = async function (this: { logger?: LoggerWrapper }, ...args: unknown[]) {
      const startTime = performance.now();
      const isSql = typeof args[0] === 'string';
      const query = isSql ? (args[0] as string) : _key;
      const values = isSql ? (args[1] as unknown[] | undefined) : args;
      try {
        return await originalMethod.apply(this, args);
      } catch (err) {
        enrichError(err, this.logger, query, values);
      } finally {
        if (this.logger) {
          const duration = performance.now() - startTime;
          this.logger.logQuery(query, values, Math.round(duration));
        }
      }
    };
  };
}
