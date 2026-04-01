import type { DialectOptions } from '../dialect/abstractDialect.js';
import { PostgresDialect } from './postgresDialect.js';

/**
 * Postgres dialect for the Node.js `pg` driver.
 *
 * @remarks Uses base {@link PostgresDialect} capabilities: native JS arrays for `ANY` / `ALL`
 * (`nativeArrays: true`) and `$n::jsonb` without a text re-cast. Bun SQL Postgres needs
 * `BunSqlPostgresDialect` from `uql-orm/bunSql` instead (wire array literals + text json cast).
 */
export class PgDialect extends PostgresDialect {
  constructor(options: DialectOptions = {}) {
    super(options);
  }
}
