import type { DialectFeatures } from '../type/index.js';

/**
 * Wire-style parameter shaping for **Bun SQL** (and similar clients) on PostgreSQL: arrays are
 * sent as string literals (`nativeArrays: false`) via the {@link PostgresDialect} `toPgArray` path.
 *
 * `PgDialect` does **not** use this constant — it keeps base {@link PostgresDialect} defaults
 * (`nativeArrays: true`, `explicitJsonCast: false`). `BunSqlPostgresDialect` spreads this
 * and sets `explicitJsonCast: true`.
 *
 * @remarks Optional import for custom pools; Neon / Cockroach `PostgresDialect` subclasses
 * typically use base defaults without these patches.
 */
export const POSTGRES_WIRE_DRIVER_CAPABILITIES = {
  nativeArrays: false,
} as const satisfies Partial<DialectFeatures>;
