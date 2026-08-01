import { PostgresDialect } from '../postgres/postgresDialect.js';
import { POSTGRES_WIRE_DRIVER_CAPABILITIES } from '../postgres/postgresWireDriverCapabilities.js';
import type { DialectFeatures } from '../type/index.js';

/**
 * Postgres Dialect specialization for the `bun:sql` driver.
 *
 * @remarks Reuses wire array encoding plus `explicitJsonCast` so JSON merge/push binds
 * reliably; `PgDialect` omits the text re-cast.
 */
export class BunSqlPostgresDialect extends PostgresDialect {
  protected override readonly featureOverrides: Partial<DialectFeatures> = {
    ...POSTGRES_WIRE_DRIVER_CAPABILITIES,
    explicitJsonCast: true,
  };
}
