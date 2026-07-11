import type { DialectFeatures } from '../type/index.js';

/**
 * Wire-style parameter shaping for **Bun SQL** (and similar clients) on any Postgres-wire dialect:
 * arrays are sent as string literals (`nativeArrays: false`) via {@link PgLikeSqlDialect}'s
 * `toPgArray` path.
 *
 * `PgDialect` does **not** use this constant - it keeps base {@link PgLikeSqlDialect} defaults
 * (`nativeArrays: true`, `explicitJsonCast: false`), since node-`pg` doesn't need the fix.
 * `BunSqlPostgresDialect` and `BunSqlCockroachDialect` both spread this and set
 * `explicitJsonCast: true` - `bun:sql` routes CockroachDB through its own Postgres wire-protocol
 * implementation (see `bunSql.util.ts#normalizeBunOpts`), so it needs the identical fix: verified
 * directly that without it, `$merge`/`$push` on a JSONB column silently produce the wrong value
 * or throw on a live CockroachDB instance.
 *
 * @remarks Optional import for custom pools. Neon uses its own serverless driver (not `bun:sql`),
 * so `NeonDialect` is a separate, unverified case - do not assume it needs this without testing.
 */
export const POSTGRES_WIRE_DRIVER_CAPABILITIES = {
  nativeArrays: false,
} as const satisfies Partial<DialectFeatures>;
