import { CockroachDialect } from '../cockroachdb/cockroachDialect.js';
import type { DialectOptions } from '../dialect/abstractDialect.js';
import { POSTGRES_WIRE_DRIVER_CAPABILITIES } from '../postgres/postgresWireDriverCapabilities.js';

/**
 * CockroachDB Dialect specialization for the `bun:sql` driver, which routes CockroachDB
 * connections through its own Postgres wire-protocol implementation (see
 * `bunSql.util.ts#normalizeBunOpts`), so it needs the identical fix as {@link BunSqlPostgresDialect}:
 * without it, `$merge`/`$push` on a JSONB column silently produce the wrong value or throw
 * (verified directly against a live CockroachDB instance via `bun:sql`).
 */
export class BunSqlCockroachDialect extends CockroachDialect {
  constructor(options: DialectOptions = {}) {
    super({
      ...options,
      driverCapabilities: {
        ...POSTGRES_WIRE_DRIVER_CAPABILITIES,
        explicitJsonCast: true,
        ...options.driverCapabilities,
      },
    });
  }
}
