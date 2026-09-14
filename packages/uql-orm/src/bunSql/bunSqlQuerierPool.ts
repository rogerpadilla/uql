import { SQL } from 'bun';
import { CockroachDialect } from '../cockroachdb/cockroachDialect.js';
import { type DialectOptions, dialectOptionsFrom } from '../dialect/abstractDialect.js';
import type { AbstractSqlDialect } from '../dialect/abstractSqlDialect.js';
import { MariaDialect } from '../maria/mariaDialect.js';
import { MySqlDialect } from '../mysql/mysqlDialect.js';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import { AbstractSqlQuerierPool } from '../querier/index.js';
import type { DriverCapabilities, ExtraOptions, SqlPoolCompat } from '../type/index.js';
import { decodeBigInts } from '../util/wideNumber.js';
import {
  type BunSqlDialectName,
  type BunSqlResult,
  getAffectedRows,
  inferDialectName,
  normalizeBunOpts,
} from './bunSql.util.js';
import { BunSqlQuerier } from './bunSqlQuerier.js';

/**
 * How `bun:sql` binds on the Postgres wire, measured live on Postgres and CockroachDB alike: an array
 * as its literal, since `unsafe()` binds no JS array, and JSON re-cast through text, without which a
 * JSONB `$set`/`$push` writes the wrong value or throws.
 */
const POSTGRES_WIRE: DriverCapabilities = { nativeArrays: false, explicitJsonCast: true };

/**
 * The dialect of each engine `bun:sql` drives: the engine's own, since Bun changes how a parameter binds,
 * never the SQL. Total over {@link BunSqlDialectName}, so a new Bun adapter has to be answered here.
 */
const DIALECTS: Record<BunSqlDialectName, (options: DialectOptions) => AbstractSqlDialect> = {
  postgres: (options) => new PostgresDialect({ ...options, driverCapabilities: POSTGRES_WIRE }),
  cockroachdb: (options) => new CockroachDialect({ ...options, driverCapabilities: POSTGRES_WIRE }),
  mysql: (options) => new MySqlDialect(options),
  mariadb: (options) => new MariaDialect(options),
};

export class BunSqlQuerierPool extends AbstractSqlQuerierPool<BunSqlQuerier, AbstractSqlDialect> {
  readonly sql: SQL;

  /** @param config Bun's own `SQL.Options`, from which the engine is inferred. */
  constructor(
    readonly config: SQL.Options,
    extra?: ExtraOptions,
  ) {
    const dialectName = inferDialectName(config);
    super(DIALECTS[dialectName](dialectOptionsFrom(extra)), extra);
    this.sql = new SQL(normalizeBunOpts(config, dialectName));
  }

  /**
   * Provides a pg-compatible interface for libraries like connect-pg-simple.
   * Connection release is handled automatically by Bun's native pool.
   */
  get pool(): SqlPoolCompat {
    return {
      query: (text: string, values?: unknown[]) =>
        this.sql.unsafe<BunSqlResult>(text, this.dialect.normalizeValues(values)).then((res) => {
          const rows = Array.from(res, decodeBigInts);
          return { rows, rowCount: getAffectedRows(res) ?? rows.length };
        }),
      on: () => {
        /* no-op for event listeners */
      },
    };
  }

  async getQuerier() {
    return new BunSqlQuerier(() => this.sql.reserve(), this.dialect, this.extra);
  }

  async end() {
    await this.sql.close();
  }
}
