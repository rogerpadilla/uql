import { SQLITE_FEATURES, SqliteDialect } from '../sqlite/sqliteDialect.js';
import type { SqlDialectFeatures } from '../type/index.js';
import { UqlUsageError } from '../util/uqlError.js';

/**
 * SQLite Dialect specialization for Cloudflare D1.
 *
 * @remarks Distinct type for `D1QuerierPool` and a hook for D1-specific SQL differences.
 */
export class D1SqliteDialect extends SqliteDialect {
  /** A vector stays text: D1 answers a BLOB as an array of its byte values, which reads like a vector. */
  override readonly features: SqlDialectFeatures = { ...SQLITE_FEATURES, vectorBytes: false, transactions: false };

  // Cloudflare D1 caps bound parameters at 100 per query.
  override readonly maxBindValues: number = 100;

  // And a function call at 32 arguments.
  override readonly maxFunctionArgs: number = 32;

  /**
   * D1's Worker API refuses a `bigint` bind ([workerd#4195](https://github.com/cloudflare/workerd/issues/4195)),
   * so one goes as its exact text, which SQLite's INTEGER affinity stores as the same integer.
   */
  override normalizeValue(value: unknown): unknown {
    return typeof value === 'bigint' ? String(value) : super.normalizeValue(value);
  }

  /**
   * D1 loads no extensions (its allowlist is FTS5, JSON and the math functions) and has no vector
   * functions of its own, so the sqlite-vec names inherited from {@link SqliteDialect} would compile
   * to SQL that only fails once it reaches the edge. `raw()` is no escape hatch either, hence a
   * message that names the product that does the job.
   */
  protected override appendVectorDistance(): never {
    throw new UqlUsageError(
      'Cloudflare D1 has no vector functions and cannot load sqlite-vec. Use Cloudflare Vectorize for vector search.',
    );
  }
}
