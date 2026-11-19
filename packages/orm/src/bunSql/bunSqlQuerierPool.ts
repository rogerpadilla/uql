import { SQL } from 'bun';
import { CockroachDialect } from '../cockroachdb/cockroachDialect.js';
import { type DialectOptions, dialectOptionsFrom } from '../dialect/abstractDialect.js';
import type { AbstractSqlDialect } from '../dialect/abstractSqlDialect.js';
import { MariaDialect } from '../mariadb/mariaDialect.js';
import { MySqlDialect } from '../mysql/mysqlDialect.js';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import { AbstractDriverQuerierPool } from '../querier/index.js';
import type { DriverCapabilities, DriverPoolOptions, SqlPoolCompat } from '../type/index.js';
import { noop } from '../util/object.util.js';
import {
  type BunSqlDialectName,
  type BunSqlResult,
  bunSqlExecution,
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

export class BunSqlQuerierPool extends AbstractDriverQuerierPool<SQL.Options, SQL, BunSqlQuerier, AbstractSqlDialect> {
  /** @param config Bun's own `SQL.Options`, from which the engine is inferred, a replica's on the same engine. */
  constructor(
    readonly config: SQL.Options,
    extra?: DriverPoolOptions<SQL.Options>,
  ) {
    const dialectName = inferDialectName(config);
    super(
      DIALECTS[dialectName](dialectOptionsFrom(extra)),
      config,
      extra,
      (options) => new SQL(normalizeBunOpts(options, dialectName)),
    );
  }

  /** The primary's `SQL` instance. */
  get sql(): SQL {
    return this.primary;
  }

  /**
   * Provides a pg-compatible interface for libraries like connect-pg-simple.
   * Connection release is handled automatically by Bun's native pool.
   */
  get pool(): SqlPoolCompat {
    return {
      query: (text: string, values?: unknown[]) =>
        this.sql
          .unsafe<BunSqlResult>(
            text,
            values?.map((value) => this.dialect.normalizeValue(value)),
          )
          .then((res) => {
            const { rows, changes } = bunSqlExecution(res);
            return { rows, rowCount: changes ?? rows.length };
          }),
      on: noop,
    };
  }

  protected querierOn(sql: SQL) {
    return new BunSqlQuerier(() => sql.reserve(), this.dialect, this.extra);
  }

  protected close(sql: SQL) {
    return sql.close();
  }
}
