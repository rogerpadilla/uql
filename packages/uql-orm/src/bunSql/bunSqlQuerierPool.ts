import { SQL } from 'bun';
import { CockroachDialect } from '../cockroachdb/cockroachDialect.js';
import { type DialectOptions, dialectOptionsFrom } from '../dialect/abstractDialect.js';
import type { AbstractSqlDialect } from '../dialect/abstractSqlDialect.js';
import { MariaDialect } from '../maria/mariaDialect.js';
import { MySqlDialect } from '../mysql/mysqlDialect.js';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import { POSTGRES_WIRE_DRIVER_CAPABILITIES } from '../postgres/postgresWireDriverCapabilities.js';
import { AbstractSqlQuerierPool } from '../querier/index.js';
import { SqliteDialect } from '../sqlite/sqliteDialect.js';
import type { DialectFeatures, ExtraOptions, SqlPoolCompat } from '../type/index.js';
import {
  type BunSqlConn,
  type BunSqlDialectName,
  type BunSqlResult,
  getAffectedRows,
  inferDialectName,
  normalizeBunOpts,
  normalizeRows,
} from './bunSql.util.js';
import { BunSqlQuerier } from './bunSqlQuerier.js';

type DialectConstructor = new (options: DialectOptions) => AbstractSqlDialect;

/**
 * The dialect each engine `bun:sql` drives is given, and how this driver shapes its parameters.
 *
 * The engine dialects themselves, not `bun:sql` subclasses of them: what Bun changes is the binding,
 * never the SQL, and a per-instance `driverCapabilities` is where the base class already takes that -
 * so the Postgres and CockroachDB entries differ from `PgQuerierPool`'s only by naming the same
 * constant. Total over {@link BunSqlDialectName}, so a new Bun adapter has to be answered here.
 */
const DialectMap = {
  postgres: [PostgresDialect, POSTGRES_WIRE_DRIVER_CAPABILITIES],
  cockroachdb: [CockroachDialect, POSTGRES_WIRE_DRIVER_CAPABILITIES],
  mysql: [MySqlDialect],
  mariadb: [MariaDialect],
  sqlite: [SqliteDialect],
} as const satisfies Record<BunSqlDialectName, readonly [DialectConstructor, Partial<DialectFeatures>?]>;

export class BunSqlQuerierPool extends AbstractSqlQuerierPool<BunSqlQuerier, AbstractSqlDialect> {
  readonly sql: SQL;
  readonly sqlDialectName: BunSqlDialectName;

  private foreignKeysOn?: Promise<unknown>;

  constructor(
    readonly config: SQL.Options,
    extra?: ExtraOptions,
  ) {
    const dialectName = inferDialectName(config);
    const [Dialect, driverCapabilities] = DialectMap[dialectName];
    super(new Dialect({ ...dialectOptionsFrom(extra), driverCapabilities }), extra);
    this.sqlDialectName = dialectName;

    const opts = normalizeBunOpts(config, dialectName);
    this.sql = new SQL(opts);
  }

  /**
   * Provides a pg-compatible interface for libraries like connect-pg-simple.
   * Connection release is handled automatically by Bun's native pool.
   */
  get pool(): SqlPoolCompat {
    return {
      query: (text: string, values?: unknown[]) =>
        this.sql.unsafe<BunSqlResult>(text, this.dialect.normalizeValues(values)).then((res) => {
          const rows = normalizeRows(res);
          return { rows, rowCount: getAffectedRows(res) ?? rows.length };
        }),
      on: () => {
        /* no-op for event listeners */
      },
    };
  }

  async getQuerier() {
    return new BunSqlQuerier(this.sql, this.dialect, () => this.acquire(), this.extra);
  }

  /**
   * Bun's SQLite adapter does not support connection reservation (it's unpooled), and leaves
   * `foreign_keys` off as `bun:sqlite` does, so without the pragma the constraints uql emits in its
   * own DDL are decorative. One connection means one pragma, issued on the first acquisition, and a
   * `release` that does nothing: the handle is the pool's, and outlives every querier over it.
   */
  private async acquire(): Promise<BunSqlConn> {
    if (this.sqlDialectName !== 'sqlite') {
      return this.sql.reserve();
    }
    this.foreignKeysOn ??= this.sql.unsafe('PRAGMA foreign_keys = ON');
    await this.foreignKeysOn;
    return { unsafe: this.sql.unsafe.bind(this.sql), release: () => {} };
  }

  async end() {
    await this.sql.close();
  }
}
