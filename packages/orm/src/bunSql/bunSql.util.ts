import type { SQL } from 'bun';
import type { PrimaryKey, RawRow, SqlDialectName } from '../type/index.js';
import { UqlUsageError } from '../util/uqlError.js';
import { decodeWideNumber } from '../util/wideNumber.js';

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
 * The rows a statement touched: `count` on Postgres, `affectedRows` on MySQL (whose `count` is 0 on a
 * write), in that order; `undefined` to leave it to the returned rows.
 */
export function getAffectedRows(res: BunSqlResult): number | undefined {
  return res.affectedRows || res.count || undefined;
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
        `uql-orm/bunSql does not drive ${elsewhere}; use the dedicated uql-orm/${elsewhere} pool`,
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
 * and failed on the first statement instead of on the pool. SQLite runs on `Sqlite3QuerierPool`, which
 * uses `bun:sqlite` under Bun.
 */
const ELSEWHERE: ReadonlyMap<string, SqlDialectName> = new Map([
  ['mssql', 'mssql'],
  ['sqlserver', 'mssql'],
  ['sqlite', 'sqlite'],
  ['sqlite3', 'sqlite'],
]);

/** The id a MySQL-family insert reports, by the same wide-integer rule as every other BIGINT. */
export function getInsertId(res: BunSqlResult): PrimaryKey | undefined {
  return typeof res.lastInsertRowid === 'bigint' ? decodeWideNumber(res.lastInsertRowid) : res.lastInsertRowid;
}
