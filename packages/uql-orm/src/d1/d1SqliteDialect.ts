import { SqliteDialect } from '../sqlite/sqliteDialect.js';

/**
 * SQLite Dialect specialization for Cloudflare D1.
 *
 * @remarks Distinct type for `D1QuerierPool` and a hook for D1-specific SQL differences.
 */
export class D1SqliteDialect extends SqliteDialect {
  // Cloudflare D1 caps bound parameters at 100 per query.
  override readonly maxBindValues: number = 100;
}
