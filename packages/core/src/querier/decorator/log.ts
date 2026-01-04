/**
 * Decorator that logs the execution of a query method.
 * It tracks execution time and logs the query, parameters, and duration.
 * The decorated class must have a `logger` property of type LoggerWrapper.
 */
export function Log() {
  return (_target: object, _key: string, propDescriptor: PropertyDescriptor): void => {
    const originalMethod = propDescriptor.value;
    propDescriptor.value = async function (this: any, ...args: any[]) {
      if (!this.logger) {
        return originalMethod.apply(this, args);
      }
      const startTime = performance.now();
      try {
        return await originalMethod.apply(this, args);
      } finally {
        const duration = performance.now() - startTime;
        const isSql = _key === 'all' || _key === 'run';
        const query = isSql ? args[0] : _key;
        const values = isSql ? args[1] : args;
        this.logger.logQuery(query, values, Math.round(duration));
      }
    };
  };
}
