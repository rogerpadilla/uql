import { type ReservedSQL, SQL } from 'bun';
import { CockroachDialect } from '../cockroachdb/index.js';
import type { AbstractSqlDialect } from '../dialect/index.js';
import { MariaDialect } from '../maria/index.js';
import { MySqlDialect } from '../mysql/index.js';
import { PostgresDialect } from '../postgres/index.js';
import { AbstractQuerierPool } from '../querier/index.js';
import { SqliteDialect } from '../sqlite/index.js';
import type { ExtraOptions, NamingStrategy, SqlDialect, SqlPoolCompat } from '../type/index.js';
import { type BunSqlResult, getAffectedRows, isBunSqlClient, isPoolableDialect } from './bunSql.util.js';
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

  constructor(
    readonly sqlDialect: SqlDialect,
    readonly config: string | SQL.Options | SQL,
    extra?: ExtraOptions,
  ) {
    super(new DialectMap[sqlDialect](extra?.namingStrategy), extra);

    // Support passing an instantiated SQL client directly, or a config string/object
    if (isBunSqlClient(config)) {
      this.sql = config as SQL;
    } else {
      const adapter = sqlDialect === 'cockroachdb' ? 'postgres' : sqlDialect;
      if (typeof config === 'string') {
        this.sql = new SQL(config);
      } else {
        const opts = 'adapter' in config ? config : { ...config, adapter };
        this.sql = new SQL(opts);
      }
    }
  }

  /**
   * Provides a pg-compatible interface for libraries like connect-pg-simple.
   * Connection release is handled automatically by Bun's native pool.
   */
  get pool(): SqlPoolCompat {
    return {
      query: (text: string, values?: unknown[]) =>
        this.sql.unsafe<BunSqlResult>(text, values).then((rows) => ({
          rows,
          rowCount: getAffectedRows(rows),
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
