import type { LoggerWrapper } from '../../util/logger.js';

/**
 * A driver error enriched with the query it failed on, attached by `@Log()`. Only the query/method
 * name is attached, never the bound values - those can carry sensitive data (PII, tokens, etc.) and
 * would otherwise leak into whatever error-tracking pipeline (Sentry, console.error, ...) serializes
 * the error, without the developer opting in.
 */
export interface QueryError extends Error {
  query?: string;
}

/**
 * Decorator that logs the execution of a query method.
 * It tracks execution time and logs the query, parameters, and duration.
 * The decorated class must have a `logger` property of type LoggerWrapper.
 *
 * On failure, also attaches the query to the thrown error (as `QueryError`) so that context
 * survives even when no logger is configured - drivers don't otherwise carry it.
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
        if (err instanceof Error) {
          (err as QueryError).query ??= query;
        }
        throw err;
      } finally {
        if (this.logger) {
          const duration = performance.now() - startTime;
          this.logger.logQuery(query, values, Math.round(duration));
        }
      }
    };
  };
}
