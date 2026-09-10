import type { DialectFeatures } from '../type/index.js';

/**
 * Driver-shaped parameter handling for **Bun SQL** (and any client like it) on a Postgres-wire
 * dialect: arrays go as string literals (`nativeArrays: false`, {@link PgLikeSqlDialect}'s `toPgArray`
 * path) and a JSON bind is re-cast through text (`explicitJsonCast: true`). Both are measured, on a
 * live server: `bun:sql` binds neither `sql.array(...)` nor a plain JS array through `unsafe()`
 * (verified again on Bun 1.4.2), and without the text re-cast a `$set`/`$push` on a JSONB column
 * silently writes the wrong value or throws - on Postgres and, identically, on CockroachDB, which
 * `bun:sql` reaches through its own Postgres wire implementation.
 *
 * The pair is one constant because it is one driver's shape, and `BunSqlQuerierPool` hands it to
 * `PostgresDialect`/`CockroachDialect` as their `driverCapabilities` rather than subclassing either:
 * Bun changes how a parameter binds, never the SQL. `PgQuerierPool` uses neither, keeping the base
 * {@link PgLikeSqlDialect} defaults, since node-`pg` needs no fix.
 *
 * @remarks Optional import for custom pools. Neon uses its own serverless driver (not `bun:sql`),
 * so `NeonQuerierPool` is a separate, unverified case - do not assume it needs this without testing.
 */
export const POSTGRES_WIRE_DRIVER_CAPABILITIES = {
  nativeArrays: false,
  explicitJsonCast: true,
} as const satisfies Partial<DialectFeatures>;
