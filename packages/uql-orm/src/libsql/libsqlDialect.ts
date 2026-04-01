import { SqliteDialect } from '../sqlite/sqliteDialect.js';

/**
 * SQLite Dialect specialization for the `@libsql/client` driver.
 *
 * @remarks Empty subclass by design: distinct type for `LibsqlQuerierPool` and a hook
 * for future libsql-specific behavior.
 */
export class LibsqlDialect extends SqliteDialect {}
