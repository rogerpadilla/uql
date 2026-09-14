import { SQL } from 'bun';
import { CockroachDialect } from '../cockroachdb/cockroachDialect.js';
import { type DialectOptions, dialectOptionsFrom } from '../dialect/abstractDialect.js';
import type { AbstractSqlDialect } from '../dialect/abstractSqlDialect.js';
import { MariaDialect } from '../maria/mariaDialect.js';
import { MySqlDialect } from '../mysql/mysqlDialect.js';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import { POSTGRES_WIRE_DRIVER_CAPABILITIES } from '../postgres/postgresWireDriverCapabilities.js';
import { AbstractSqlQuerierPool } from '../querier/index.js';
import type { DialectFeatures, ExtraOptions, SqlPoolCompat } from '../type/index.js';
import { decodeBigInts } from '../util/wideNumber.js';
import {
  type BunSqlDialectName,
  type BunSqlResult,
  getAffectedRows,
  inferDialectName,
  normalizeBunOpts,
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
} as const satisfies Record<BunSqlDialectName, readonly [DialectConstructor, Partial<DialectFeatures>?]>;

export class BunSqlQuerierPool extends AbstractSqlQuerierPool<BunSqlQuerier, AbstractSqlDialect> {
  readonly sql: SQL;
  readonly sqlDialectName: BunSqlDialectName;

  /** @param config Bun's own `SQL.Options`, from which the engine is inferred. */
  constructor(
    readonly config: SQL.Options,
    extra?: ExtraOptions,
  ) {
    const dialectName = inferDialectName(config);
    const [Dialect, driverCapabilities] = DialectMap[dialectName];
    super(new Dialect({ ...dialectOptionsFrom(extra), driverCapabilities }), extra);
    this.sqlDialectName = dialectName;
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
