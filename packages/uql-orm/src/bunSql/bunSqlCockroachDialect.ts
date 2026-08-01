import { CockroachDialect } from '../cockroachdb/cockroachDialect.js';
import { POSTGRES_WIRE_DRIVER_CAPABILITIES } from '../postgres/postgresWireDriverCapabilities.js';
import type { DialectFeatures } from '../type/index.js';

/**
 * CockroachDB Dialect specialization for the `bun:sql` driver, which routes CockroachDB
 * connections through its own Postgres wire-protocol implementation (see
 * `bunSql.util.ts#normalizeBunOpts`), so it needs the identical fix as {@link BunSqlPostgresDialect}:
 * without it, `$set`/`$push` on a JSONB column silently produce the wrong value or throw
 * (verified directly against a live CockroachDB instance via `bun:sql`).
 */
export class BunSqlCockroachDialect extends CockroachDialect {
  protected override readonly featureOverrides: Partial<DialectFeatures> = {
    ...POSTGRES_WIRE_DRIVER_CAPABILITIES,
    explicitJsonCast: true,
  };
}
