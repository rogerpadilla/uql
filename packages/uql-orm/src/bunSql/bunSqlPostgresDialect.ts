import type { DialectOptions } from '../dialect/abstractDialect.js';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import { POSTGRES_WIRE_DRIVER_CAPABILITIES } from '../postgres/postgresWireDriverCapabilities.js';

/**
 * Postgres Dialect specialization for the `bun:sql` driver.
 *
 * @remarks Reuses wire array encoding plus `explicitJsonCast` so JSON merge/push binds
 * reliably; `PgDialect` omits the text re-cast.
 */
export class BunSqlPostgresDialect extends PostgresDialect {
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
