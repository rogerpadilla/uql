import type { SQL } from 'bun';
import { CockroachDialect } from '../cockroachdb/index.js';
import type { AbstractSqlDialect } from '../dialect/index.js';
import { MySqlDialect } from '../mysql/index.js';
import { PostgresDialect } from '../postgres/index.js';
import { AbstractQuerierPool } from '../querier/index.js';
import { SqliteDialect } from '../sqlite/index.js';
import type { ExtraOptions, NamingStrategy, SqlDialect } from '../type/index.js';
import { BunSqlQuerier } from './bunSqlQuerier.js';

const DialectMap: Readonly<Record<SqlDialect, new (namingStrategy?: NamingStrategy) => AbstractSqlDialect>> = {
  postgres: PostgresDialect,
  mysql: MySqlDialect,
  mariadb: MySqlDialect,
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
    if (typeof config === 'function' && 'unsafe' in config) {
      this.sql = config as SQL;
    } else {
      const { SQL: BunSQL } = require('bun');
      const adapter = sqlDialect === 'mariadb' ? 'mysql' : sqlDialect === 'cockroachdb' ? 'postgres' : sqlDialect;
      const opts = typeof config === 'object' && config && !('adapter' in config) ? { ...config, adapter } : config;
      this.sql = new BunSQL(opts as string | SQL.Options);
    }
  }

  async getQuerier() {
    return new BunSqlQuerier(this.sql, this.dialectInstance, this.extra);
  }

  async end() {
    await this.sql.close();
  }
}
