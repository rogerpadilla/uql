import { type ReservedSQL, SQL } from 'bun';
import { CockroachDialect } from '../cockroachdb/cockroachDialect.js';
import type { DialectOptions } from '../dialect/abstractDialect.js';
import type { AbstractSqlDialect } from '../dialect/abstractSqlDialect.js';
import { MariaDialect } from '../maria/mariaDialect.js';
import { MySqlDialect } from '../mysql/mysqlDialect.js';
import { AbstractQuerierPool } from '../querier/index.js';
import type { ExtraOptions, SqlDialectName, SqlPoolCompat } from '../type/index.js';
import {
  type BunSqlResult,
  getAffectedRows,
  inferDialectName,
  isPoolableDialect,
  normalizeBunOpts,
  normalizeRows,
} from './bunSql.util.js';
import { BunSqliteDialect } from './bunSqliteDialect.js';
import { BunSqlPostgresDialect } from './bunSqlPostgresDialect.js';
import { BunSqlQuerier } from './bunSqlQuerier.js';

type DialectConstructor = new (options: DialectOptions) => AbstractSqlDialect;

const DialectMap: Readonly<Record<SqlDialectName, DialectConstructor>> = {
  postgres: BunSqlPostgresDialect,
  mysql: MySqlDialect,
  mariadb: MariaDialect,
  sqlite: BunSqliteDialect,
  cockroachdb: CockroachDialect,
};

export class BunSqlQuerierPool extends AbstractQuerierPool<AbstractSqlDialect, BunSqlQuerier> {
  readonly sql: SQL;
  readonly sqlDialectName: SqlDialectName;

  constructor(
    readonly config: SQL.Options,
    extra?: ExtraOptions,
  ) {
    const dialectName = inferDialectName(config);
    super(new DialectMap[dialectName]({ namingStrategy: extra?.namingStrategy }), extra);
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
        this.sql.unsafe<BunSqlResult>(text, this.dialect.normalizeValues(values)).then((res) => ({
          rows: normalizeRows(res),
          rowCount: getAffectedRows(res),
        })),
      on: () => {
        /* no-op for event listeners */
      },
    };
  }

  async getQuerier() {
    const connFactory = async () => {
      // Bun's SQLite adapter does not support connection reservation (it's unpooled).
      if (!isPoolableDialect(this.sqlDialectName)) {
        return this.sql as ReservedSQL;
      }
      return this.sql.reserve();
    };
    return new BunSqlQuerier(this.sql, this.dialect, connFactory, this.extra);
  }

  async end() {
    await this.sql.close();
  }
}
