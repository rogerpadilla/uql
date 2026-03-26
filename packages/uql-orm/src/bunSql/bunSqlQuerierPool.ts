import { type ReservedSQL, SQL } from 'bun';
import { CockroachDialect } from '../cockroachdb/index.js';
import type { AbstractSqlDialect } from '../dialect/index.js';
import { MariaDialect } from '../maria/index.js';
import { MySqlDialect } from '../mysql/index.js';
import { PostgresDialect } from '../postgres/index.js';
import { AbstractQuerierPool } from '../querier/index.js';
import { SqliteDialect } from '../sqlite/index.js';
import type { ExtraOptions, NamingStrategy, SqlDialect, SqlPoolCompat } from '../type/index.js';
import {
  type BunSqlResult,
  getAffectedRows,
  inferDialect,
  isPoolableDialect,
  normalizeBunOpts,
  normalizeRows,
} from './bunSql.util.js';
import { BunSqlQuerier } from './bunSqlQuerier.js';

const DialectMap: Readonly<Record<SqlDialect, new (namingStrategy?: NamingStrategy) => AbstractSqlDialect>> = {
  postgres: PostgresDialect,
  mysql: MySqlDialect,
  mariadb: MariaDialect,
  sqlite: SqliteDialect,
  cockroachdb: CockroachDialect,
};

export class BunSqlQuerierPool extends AbstractQuerierPool<AbstractSqlDialect, BunSqlQuerier> {
  readonly sql: SQL;
  readonly sqlDialect: SqlDialect;

  constructor(
    readonly config: SQL.Options,
    extra?: ExtraOptions,
  ) {
    const dialect = inferDialect(config);
    super(new DialectMap[dialect](extra?.namingStrategy), extra);
    this.sqlDialect = dialect;

    const opts = normalizeBunOpts(config, dialect);
    this.sql = new SQL(opts);
  }

  /**
   * Provides a pg-compatible interface for libraries like connect-pg-simple.
   * Connection release is handled automatically by Bun's native pool.
   */
  get pool(): SqlPoolCompat {
    return {
      query: (text: string, values?: unknown[]) =>
        this.sql.unsafe<BunSqlResult>(text, this.dialectInstance.normalizeValues(values)).then((res) => ({
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
      if (!isPoolableDialect(this.sqlDialect)) {
        return this.sql as ReservedSQL;
      }
      return this.sql.reserve();
    };
    return new BunSqlQuerier(this.sql, this.dialectInstance, connFactory, this.extra);
  }

  async end() {
    await this.sql.close();
  }
}
