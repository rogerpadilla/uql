/**
 * Available log levels for the ORM.
 */
export type LogLevel = 'query' | 'info' | 'warn' | 'error' | 'schema' | 'migration' | 'skippedMigration';

/**
 * Interface for custom logger implementations.
 */
export interface Logger {
  /**
   * Logs a database query.
   * @param query - The SQL query string.
   * @param values - The parameters passed to the query.
   * @param duration - The time it took to execute the query in milliseconds.
   */
  logQuery?(query: string, values?: any[], duration?: number): void;
  /**
   * Logs a slow query.
   * @param query - The SQL query string.
   * @param values - The parameters passed to the query.
   * @param duration - The time it took to execute the query in milliseconds.
   */
  logSlowQuery?(query: string, values?: any[], duration?: number): void;
  /**
   * Logs a warning.
   */
  logWarn?(message: string): void;
  /**
   * Logs an error.
   */
  logError?(message: string, error?: any): void;
  /**
   * Logs informative messages.
   */
  logInfo?(message: string): void;
  /**
   * Logs schema synchronization messages.
   */
  logSchema?(message: string): void;
  /**
   * Logs migration messages.
   */
  logMigration?(message: string): void;
  /**
   * Logs skipped migration messages.
   */
  logSkippedMigration?(message: string): void;
}

/**
 * Function type for backward compatibility with simple loggers.
 */
export type LoggerFunction = (message: any, ...args: any[]) => void;

/**
 * Options for configuring ORM logging.
 * - boolean: true to enable all logs with DefaultLogger, false to disable.
 * - LogLevel[]: enable specific log levels with DefaultLogger.
 * - Logger: use a custom logger implementation.
 * - LoggerFunction: use a custom function (backward compatibility).
 */
export type LoggingOptions = boolean | LogLevel[] | Logger | LoggerFunction;
