import { SqliteDialect } from './sqliteDialect.js';

/**
 * SQLite Dialect specialization for the `better-sqlite3` driver.
 *
 * @remarks Empty subclass by design: distinct type for pools/tests that target
 * better-sqlite3 and a hook for future driver-specific overrides.
 */
export class BetterSqlite3Dialect extends SqliteDialect {}
