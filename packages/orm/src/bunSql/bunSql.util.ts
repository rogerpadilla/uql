import type { SQL } from 'bun';
import type { PrimaryKey, RawRow, SqlDialectName } from '../type/index.js';
import type { SqlExecution } from '../util/sql.util.js';
import { UqlUsageError } from '../util/uqlError.js';
import { decodeBigInts, decodeWideNumber } from '../util/wideNumber.js';

/** The header a `bun:sql` result carries next to its rows. */
export type BunSqlHeader = {
  count?: number;
  affectedRows?: number | null;
  lastInsertRowid?: PrimaryKey;
};

export type BunSqlResult<T = RawRow> = T[] & BunSqlHeader;

/** The connection a {@link BunSqlQuerier} holds: what a `ReservedSQL` exposes of itself. */
export type BunSqlConn = Pick<SQL, 'unsafe'> & { release(): void };

/**
 * The engines `bun:sql` can drive. Its own union rather than {@link SqlDialectName}: every other
 * engine uql supports reaches it through a dedicated pool, and keeping this one total means Bun
 * gaining an adapter is a compile error here until the dialect is named.
 */
export type BunSqlDialectName = 'postgres' | 'cockroachdb' | 'mysql' | 'mariadb';

/**
 * A `bun:sql` result as the querier reads it: its rows, each BIGINT decoded exactly; the rows it touched,
 * `affectedRows` on MySQL (whose `count` is 0 on a write) then `count` on Postgres, `undefined` to leave it to
 * the rows; and a MySQL-family insert's id, by the same wide-integer rule.
 */
export function bunSqlExecution(res: BunSqlResult): SqlExecution {
  const id = typeof res.lastInsertRowid === 'bigint' ? decodeWideNumber(res.lastInsertRowid) : res.lastInsertRowid;
  return { rows: Array.from(res, decodeBigInts), changes: res.affectedRows || res.count || undefined, id };
}

/**
 * Normalizes `SQL.Options` into what Bun's SQL engine expects for a given dialect: the adapter a
 * CockroachDB URL dials, and every BIGINT read as a `bigint` whatever the config asks, for
 * `decodeBigInts` to decode exactly.
 */
export function normalizeBunOpts(config: SQL.Options, dialectName: BunSqlDialectName): SQL.PostgresOrMySQLOptions {
  const adapter = dialectName === 'cockroachdb' ? 'postgres' : dialectName;
  const opts: SQL.PostgresOrMySQLOptions = { ...config, adapter, bigint: true };

  if (!opts.url) {
    return opts;
  }

  try {
    const url = opts.url instanceof URL ? opts.url : new URL(opts.url);
    if (url.searchParams.get('sslmode') === 'no-verify') {
      url.searchParams.delete('sslmode');
      opts.url = url.toString();
      opts.tls = { rejectUnauthorized: false, ...(typeof opts.tls === 'object' ? opts.tls : undefined) };
    }
  } catch (_) {}

  return opts;
}

/**
 * The engine a Bun `SQL.Options` points at: the URL's scheme - a SQLite file or `:memory:` counting as
 * `sqlite` - then the `adapter` Bun itself would read, and Postgres last, which is Bun's own fallback.
 */
export function inferDialectName(config: SQL.Options): BunSqlDialectName {
  const url = 'url' in config ? config.url?.toString() : undefined;
  const file = ('filename' in config && !!config.filename) || url === ':memory:' || /\.(db|sqlite)$/.test(url ?? '');
  // Every Bun adapter name is a scheme here too, so the same two tables answer both.
  for (const name of [file ? 'sqlite' : url?.split(':')[0], config.adapter]) {
    const elsewhere = name && ELSEWHERE.get(name);
    if (elsewhere) {
      throw new UqlUsageError(
        `uql-orm/bun-sql does not drive ${elsewhere}; use the dedicated uql-orm/${elsewhere} pool`,
      );
    }
    const dialect = name && SCHEMES.get(name);
    if (dialect) {
      return dialect;
    }
  }
  return 'postgres';
}

/** A `Map` rather than an object literal, whose inherited keys would answer for a `constructor://` URL. */
const SCHEMES: ReadonlyMap<string, BunSqlDialectName> = new Map([
  ['postgres', 'postgres'],
  ['postgresql', 'postgres'],
  ['mysql', 'mysql'],
  ['mysql2', 'mysql'],
  ['mariadb', 'mariadb'],
  ['cockroachdb', 'cockroachdb'],
]);

/**
 * Engines uql drives through another pool. Named rather than left out: Bun's `SQL` falls back to
 * Postgres for any scheme it does not know, so an unlisted `mssql://` would have connected as Postgres
 * and failed on the first statement instead of on the pool. SQLite runs on `SqliteQuerierPool`, which
 * uses `bun:sqlite` under Bun.
 */
const ELSEWHERE: ReadonlyMap<string, SqlDialectName> = new Map([
  ['mssql', 'mssql'],
  ['sqlserver', 'mssql'],
  ['sqlite', 'sqlite'],
  ['sqlite3', 'sqlite'],
]);
