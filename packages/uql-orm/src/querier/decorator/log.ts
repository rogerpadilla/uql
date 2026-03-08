import type { LoggerWrapper } from '../../util/logger.js';

/**
 * Decorator that logs the execution of a query method.
 * It tracks execution time and logs the query, parameters, and duration.
 * The decorated class must have a `logger` property of type LoggerWrapper.
 */
export function Log() {
  return (_target: object, _key: string, propDescriptor: PropertyDescriptor): void => {
    const originalMethod = propDescriptor.value;
    propDescriptor.value = async function (this: { logger?: LoggerWrapper }, ...args: unknown[]) {
      if (!this.logger) {
        return originalMethod.apply(this, args);
      }
      const startTime = performance.now();
      try {
        return await originalMethod.apply(this, args);
      } finally {
        const duration = performance.now() - startTime;
        const isSql = typeof args[0] === 'string';
        const query = isSql ? (args[0] as string) : _key;
        const values = isSql ? (args[1] as unknown[] | undefined) : args;
        this.logger.logQuery(query, values, Math.round(duration));
      }
    };
  };
}
