import type { Logger, LoggerFunction, LoggingOptions, LogLevel } from '../type/logger.js';

const DEFAULT_LOG_LEVELS = [
  'query',
  'info',
  'warn',
  'error',
  'schema',
  'migration',
  'skippedMigration',
] as const satisfies LogLevel[];

/** Bound values as JSON, a `bigint` by its digits: `JSON.stringify` refuses one outright. */
function renderValues(values: unknown[]): string {
  return JSON.stringify(values, (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value));
}

/**
 * Default implementation of the Logger interface using console methods.
 */
export class DefaultLogger implements Logger {
  logQuery(query: string, values?: unknown[], duration?: number): void {
    const time = duration !== undefined ? ` [${duration}ms]` : '';
    const params = values?.length ? ` -- ${renderValues(values)}` : '';
    console.log(`\x1b[36mquery:\x1b[0m ${query}${params}\x1b[32m${time}\x1b[0m`);
  }

  logSlowQuery(query: string, values?: unknown[], duration?: number): void {
    const time = duration !== undefined ? ` [${duration}ms]` : '';
    const params = values?.length ? ` -- ${renderValues(values)}` : '';
    console.warn(`\x1b[33mslow query:\x1b[0m ${query}${params}\x1b[31m${time}\x1b[0m`);
  }

  logWarn(message: string): void {
    console.warn(`\x1b[33mwarn:\x1b[0m ${message}`);
  }

  logError(message: string, error?: unknown): void {
    console.error(`\x1b[31merror:\x1b[0m ${message}`, error);
  }

  logInfo(message: string): void {
    console.info(`\x1b[34minfo:\x1b[0m ${message}`);
  }

  logSchema(message: string): void {
    console.log(`\x1b[35mschema:\x1b[0m ${message}`);
  }

  logMigration(message: string): void {
    console.log(`\x1b[32mmigration:\x1b[0m ${message}`);
  }

  logSkippedMigration(message: string): void {
    console.info(`\x1b[33mskipped migration:\x1b[0m ${message}`);
  }
}

/**
 * Secondary {@link LoggerWrapper} settings, alongside the primary `options: LoggingOptions`
 * constructor argument.
 */
export interface LoggerWrapperConfig {
  /**
   * Whether logged queries include bound values (`logQuery` and slow-query logging alike).
   * Defaults to `false`.
   */
  logValues?: boolean;
  /** Threshold in milliseconds - queries exceeding this are logged as slow. */
  slowQuery?: number;
}

/**
 * A wrapper class that implements the Logger interface and handles different logging options.
 */
export class LoggerWrapper implements Logger {
  private readonly levels: Set<LogLevel>;
  private readonly logger?: Logger;
  private readonly loggerFunction?: LoggerFunction;
  private readonly logValues: boolean;
  private readonly slowQuery?: number;

  constructor(options: LoggingOptions, config: LoggerWrapperConfig = {}) {
    this.logValues = config.logValues ?? false;
    this.slowQuery = config.slowQuery;
    this.levels = new Set();

    if (options === true) {
      this.levels = new Set(DEFAULT_LOG_LEVELS);
      this.logger = new DefaultLogger();
    } else if (Array.isArray(options)) {
      this.levels = new Set(options);
      this.logger = new DefaultLogger();
    } else if (typeof options === 'function') {
      this.levels = new Set(DEFAULT_LOG_LEVELS);
      this.loggerFunction = options;
    } else if (options && typeof options === 'object') {
      this.levels = new Set(DEFAULT_LOG_LEVELS);
      this.logger = options;
    }

    if (this.slowQuery !== undefined && !this.logger && !this.loggerFunction) {
      this.logger = new DefaultLogger();
    }
  }

  /** Whether `logQuery` would ever actually surface bound values, given the configured levels/slowQuery/logValues. */
  willLogValues(): boolean {
    return this.logValues && (this.levels.has('query') || this.slowQuery !== undefined);
  }

  logQuery(query: string, values?: unknown[], duration?: number): void {
    const loggedValues = this.logValues ? values : undefined;

    if (this.slowQuery !== undefined && duration !== undefined && duration >= this.slowQuery) {
      if (this.logger?.logSlowQuery) {
        this.logger.logSlowQuery(query, loggedValues, duration);
        return;
      }
      if (this.loggerFunction) {
        this.loggerFunction(query, loggedValues, duration);
        return;
      }
      // If slowQuery threshold is met but no specific slowQuery logger exists,
      // it falls through to the standard logQuery below.
    }

    if (this.levels.has('query')) {
      if (this.logger?.logQuery) {
        this.logger.logQuery(query, loggedValues, duration);
      } else if (this.loggerFunction) {
        this.loggerFunction(query, loggedValues, duration);
      }
    }
  }

  logWarn(message: string): void {
    this.log('warn', message);
  }

  logError(message: string, error?: unknown): void {
    this.log('error', message, error);
  }

  logInfo(message: string): void {
    this.log('info', message);
  }

  logSchema(message: string): void {
    this.log('schema', message);
  }

  logMigration(message: string): void {
    this.log('migration', message);
  }

  logSkippedMigration(message: string): void {
    this.log('skippedMigration', message);
  }

  private log(level: LogLevel, message: string, error?: unknown) {
    if (this.levels.has(level)) {
      const method = `log${level.charAt(0).toUpperCase()}${level.slice(1)}` as keyof Logger;
      const args = error !== undefined ? [message, error] : [message];
      if (this.logger?.[method]) {
        const logFn = this.logger[method] as (m: string, e?: unknown) => void;
        logFn(...(args as [string, unknown?]));
      } else if (this.loggerFunction) {
        this.loggerFunction(...(args as [string, unknown?]));
      }
    }
  }
}

/**
 * Structural type for any EventEmitter-like connection pool that emits an
 * `'error'` event on a dropped connection (node-postgres, `mariadb`, etc.).
 */
export interface ErrorEmittingPool {
  on(event: 'error', listener: (err: Error) => void): unknown;
}

/**
 * Attaches an error listener to a connection pool so a dropped connection is logged instead of left
 * unhandled - which crashes the process for drivers that don't guard against it themselves
 * (node-postgres, `mssql`), or is silently swallowed by those that install a no-op of their own
 * (`mariadb`). Reported through the pool's own logger when it has one, and through the default one
 * otherwise: never dropped, whatever levels were configured, since a swallowed pool error is exactly
 * the failure this guards against.
 */
export function attachPoolErrorHandler(pool: ErrorEmittingPool, message: string, logging?: LoggingOptions): void {
  const logger = new LoggerWrapper(isOwnLogger(logging) ? logging : true);
  pool.on('error', (err) => {
    logger.logError(message, err);
  });
}

/** A logger the consumer wrote, as opposed to a switch or a level list for the default one. */
function isOwnLogger(logging: LoggingOptions | undefined): logging is Logger | LoggerFunction {
  return typeof logging === 'function' || (typeof logging === 'object' && !Array.isArray(logging));
}
