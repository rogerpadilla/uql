import type { SQL } from 'bun';
import type { PrimaryKey, RawRow, SqlDialectName } from '../type/index.js';
import { decodeWideNumber } from '../util/wideNumber.js';

export type BunSqlResult<T = RawRow> = T[] & {
  count?: number;
  affectedRows?: number;
  lastInsertRowid?: PrimaryKey;
};

/**
 * The connection a {@link BunSqlQuerier} holds. `ReservedSQL` satisfies it as it is; the SQLite
 * adapter, which has no reservation, is given the pool's own handle with an inert `release`.
 */
export type BunSqlConn = Pick<SQL, 'unsafe'> & { release(): void };

/**
 * The engines `bun:sql` can drive. Its own union rather than {@link SqlDialectName}: every other
 * engine uql supports reaches it through a dedicated pool, and keeping this one total means Bun
 * gaining an adapter is a compile error here until the dialect is named.
 */
export type BunSqlDialectName = 'postgres' | 'cockroachdb' | 'mysql' | 'mariadb' | 'sqlite';

/**
 * Rows a statement read or wrote, from whichever field this adapter fills: Postgres, CockroachDB and
 * SQLite report `count` and leave `affectedRows` null, MySQL and MariaDB the other way around - and
 * `count` is 0 on a MySQL write, so the two are read in that order rather than coalesced.
 *
 * `undefined` when the header carries neither, which leaves the returned rows to answer for it -
 * `buildUpdateResult` already falls back to their count, and it is the only one that should.
 */
export function getAffectedRows(res: BunSqlResult): number | undefined {
  return res.affectedRows || res.count || undefined;
}

/**
 * Normalizes SQL.Options into a structure that Bun's SQL engine expects for a given dialect.
 * Crucially handles 'filename' mapping for SQLite and alias resolution for Cockroach/MariaDB.
 */
export function normalizeBunOpts(config: SQL.Options, dialectName: BunSqlDialectName): SQL.Options {
  if (dialectName === 'sqlite') {
    const rawFilename =
      ('filename' in config ? config.filename : null) || ('url' in config ? config.url : null) || ':memory:';
    return {
      ...config,
      adapter: 'sqlite',
      filename: rawFilename.toString(),
    } satisfies SQL.SQLiteOptions;
  }

  const adapter = dialectName === 'cockroachdb' ? 'postgres' : dialectName;
  // BIGINT as a `bigint`, so a wide one reaches uql exact for `decodeBigInts` to decode.
  const opts: SQL.PostgresOrMySQLOptions = { bigint: true, ...config, adapter };

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
 * The engine a Bun `SQL.Options` points at: a SQLite file or `:memory:`, then the URL's scheme, then
 * the `adapter` Bun itself would read, and Postgres last - which is Bun's own fallback.
 */
export function inferDialectName(config: SQL.Options): BunSqlDialectName {
  if ('filename' in config && config.filename) {
    return 'sqlite';
  }
  const url = 'url' in config ? config.url?.toString() : undefined;
  if (url) {
    if (url === ':memory:' || url.endsWith('.db') || url.endsWith('.sqlite')) {
      return 'sqlite';
    }
    const scheme = url.split(':')[0] ?? '';
    const elsewhere = ELSEWHERE.get(scheme);
    if (elsewhere) {
      throw new TypeError(`Bun SQL has no ${elsewhere} driver; use the dedicated uql-orm/${elsewhere} pool`);
    }
    const dialect = SCHEMES.get(scheme);
    if (dialect) {
      return dialect;
    }
  }
  // Every Bun adapter name is a scheme here too, so the one table answers both questions.
  return (config.adapter && SCHEMES.get(config.adapter)) || 'postgres';
}

/** A `Map` rather than an object literal, whose inherited keys would answer for a `constructor://` URL. */
const SCHEMES: ReadonlyMap<string, BunSqlDialectName> = new Map([
  ['postgres', 'postgres'],
  ['postgresql', 'postgres'],
  ['mysql', 'mysql'],
  ['mysql2', 'mysql'],
  ['mariadb', 'mariadb'],
  ['sqlite', 'sqlite'],
  ['sqlite3', 'sqlite'],
  ['cockroachdb', 'cockroachdb'],
]);

/**
 * Engines uql drives elsewhere but Bun cannot dial. Named rather than left out: Bun's `SQL` falls
 * back to Postgres for any scheme it does not know, so an unlisted `mssql://` would have connected
 * as Postgres and failed on the first statement instead of on the pool.
 */
const ELSEWHERE: ReadonlyMap<string, SqlDialectName> = new Map([
  ['mssql', 'mssql'],
  ['sqlserver', 'mssql'],
]);

/** The id a MySQL-family insert reports, by the same wide-integer rule as every other BIGINT. */
export function getInsertId(res: BunSqlResult): PrimaryKey | undefined {
  return typeof res.lastInsertRowid === 'bigint' ? decodeWideNumber(res.lastInsertRowid) : res.lastInsertRowid;
}
