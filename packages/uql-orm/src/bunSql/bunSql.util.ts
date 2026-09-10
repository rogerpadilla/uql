import type { SQL } from 'bun';
import type { PrimaryKey, RawRow, SqlDialectName } from '../type/index.js';

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

  return opts as SQL.Options;
}

/**
 * Robustly infers the UQL SqlDialect from a Bun SQL.Options object.
 */
export function inferDialectName(config: SQL.Options): BunSqlDialectName {
  if ((config as SQL.SQLiteOptions).filename) return 'sqlite';
  const opts = config as SQL.PostgresOrMySQLOptions;
  if (opts.url) {
    const urlStr = opts.url.toString();
    if (urlStr === ':memory:' || urlStr.endsWith('.db') || urlStr.endsWith('.sqlite')) {
      return 'sqlite';
    }
    const scheme = urlStr.split(':')[0] ?? '';
    const elsewhere = ElsewhereMap[scheme as keyof typeof ElsewhereMap];
    if (elsewhere) {
      throw new TypeError(`Bun SQL has no ${elsewhere} driver; use the dedicated uql-orm/${elsewhere} pool`);
    }
    const dialect = DialectMap[scheme as keyof typeof DialectMap];
    if (dialect) return dialect;
  }
  // Every Bun adapter name is a key here, so the same map answers both questions.
  return (opts.adapter && DialectMap[opts.adapter]) || 'postgres';
}

const DialectMap = {
  postgres: 'postgres',
  postgresql: 'postgres',
  mysql: 'mysql',
  mysql2: 'mysql',
  mariadb: 'mariadb',
  sqlite: 'sqlite',
  sqlite3: 'sqlite',
  cockroachdb: 'cockroachdb',
} as const satisfies Record<string, BunSqlDialectName>;

/**
 * Engines uql drives elsewhere but Bun cannot dial. Named rather than left out: Bun's `SQL` falls
 * back to Postgres for any scheme it does not know, so an unlisted `mssql://` would have connected
 * as Postgres and failed on the first statement instead of on the pool.
 */
const ElsewhereMap = {
  mssql: 'mssql',
  sqlserver: 'mssql',
} as const satisfies Record<string, SqlDialectName>;

/**
 * Coerces the BigInts Bun returns (`bigint: true`, set by {@link normalizeBunOpts}) back to numbers.
 *
 * The `bun:sql` counterpart of `postgres/pgNumericTypes.ts`, and at the driver for the same reason:
 * `type: Number` maps to BIGINT, and everything crosses this decode exactly once - entity reads,
 * `RETURNING id`, counts, raw SQL - while hydration only ever sees entity reads. Exact to 2^53, which
 * covers any auto-increment id.
 */
export function normalizeRows<T>(res: BunSqlResult<T>): T[] {
  const rows: T[] = [];
  for (const row of res) {
    let cleanRow: RawRow | undefined;
    const sourceRow = row as RawRow;
    for (const key in sourceRow) {
      const value = sourceRow[key];
      if (typeof value === 'bigint') {
        // Clone only when needed so non-bigint rows can pass through untouched.
        cleanRow ??= { ...sourceRow };
        cleanRow[key] = Number(value);
      }
    }
    rows.push((cleanRow ?? sourceRow) as T);
  }
  return rows;
}

/**
 * Robustly extracts the last inserted ID from a Bun SQL result.
 * Handles BigInt-to-number coercion for cross-dialect consistency.
 */
export function getInsertId(res: BunSqlResult): PrimaryKey | undefined {
  return typeof res.lastInsertRowid === 'bigint' ? Number(res.lastInsertRowid) : res.lastInsertRowid;
}
