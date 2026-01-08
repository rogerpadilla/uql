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

/**
 * Default implementation of the Logger interface using console methods.
 */
export class DefaultLogger implements Logger {
  logQuery(query: string, values?: any[], duration?: number): void {
    const time = duration !== undefined ? ` [${duration}ms]` : '';
    const params = values?.length ? ` -- ${JSON.stringify(values)}` : '';
    console.log(`\x1b[36mquery:\x1b[0m ${query}${params}\x1b[32m${time}\x1b[0m`);
  }

  logSlowQuery(query: string, values?: any[], duration?: number): void {
    const time = duration !== undefined ? ` [${duration}ms]` : '';
    const params = values?.length ? ` -- ${JSON.stringify(values)}` : '';
    console.warn(`\x1b[33mslow query:\x1b[0m ${query}${params}\x1b[31m${time}\x1b[0m`);
  }

  logWarn(message: string): void {
    console.warn(`\x1b[33mwarn:\x1b[0m ${message}`);
  }

  logError(message: string, error?: any): void {
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
 * A wrapper class that implements the Logger interface and handles different logging options.
 */
export class LoggerWrapper implements Logger {
  private readonly levels: Set<LogLevel>;
  private readonly logger?: Logger;
  private readonly loggerFunction?: LoggerFunction;

  constructor(
    options: LoggingOptions,
    private readonly slowQueryThreshold?: number,
  ) {
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

    if (slowQueryThreshold !== undefined && !this.logger && !this.loggerFunction) {
      this.logger = new DefaultLogger();
    }
  }

  logQuery(query: string, values?: any[], duration?: number): void {
    if (this.slowQueryThreshold !== undefined && duration !== undefined && duration >= this.slowQueryThreshold) {
      if (this.logger?.logSlowQuery) {
        this.logger.logSlowQuery(query, values, duration);
        return;
      }
      if (this.loggerFunction) {
        this.loggerFunction(query, values, duration);
        return;
      }
      // If slowQueryThreshold is met but no specific slowQuery logger exists,
      // it falls through to the standard logQuery below.
    }

    if (this.levels.has('query')) {
      if (this.logger?.logQuery) {
        this.logger.logQuery(query, values, duration);
      } else if (this.loggerFunction) {
        this.loggerFunction(query, values, duration);
      }
    }
  }

  logWarn(message: string): void {
    this.log('warn', message);
  }

  logError(message: string, error?: any): void {
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

  private log(level: LogLevel, message: string, error?: any) {
    if (this.levels.has(level)) {
      const method = `log${level.charAt(0).toUpperCase()}${level.slice(1)}` as keyof Logger;
      const args = error !== undefined ? [message, error] : [message];
      if (this.logger?.[method]) {
        const logFn = this.logger[method] as (m: string, e?: any) => void;
        logFn(...(args as [string, any?]));
      } else if (this.loggerFunction) {
        this.loggerFunction(...(args as [string, any?]));
      }
    }
  }
}
