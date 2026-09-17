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
  logQuery?(query: string, values?: unknown[], duration?: number): void;
  /** Logs a query that took longer than the threshold, its values `undefined` unless `logValues` is on. */
  logSlowQuery?(query: string, values?: unknown[], duration?: number): void;
  /**
   * Logs a warning.
   */
  logWarn?(message: string): void;
  /**
   * Logs an error.
   */
  logError?(message: string, error?: unknown): void;
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
export type LoggerFunction = (message: unknown, ...args: unknown[]) => void;

/** How logging is configured: on or off, the levels to log, or a logger of your own. */
export type LoggingOptions = boolean | LogLevel[] | Logger | LoggerFunction;
