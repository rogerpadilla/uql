import { SqliteDialect } from '../sqlite/sqliteDialect.js';

/**
 * SQLite Dialect specialization for Cloudflare D1.
 *
 * @remarks Empty subclass by design: distinct type for `D1QuerierPool` and a hook for
 * future D1-specific SQL differences.
 */
export class D1SqliteDialect extends SqliteDialect {}
