import type { ReservedSQL, SQL } from 'bun';
import type { PrimaryKey, RawRow, SqlDialect } from '../type/index.js';

export type BunSqlResult<T = RawRow> = T[] & {
  count?: number;
  affectedRows?: number;
  lastInsertRowid?: PrimaryKey;
};

export function getAffectedRows(res: BunSqlResult): number {
  return res.affectedRows ?? res.count ?? 0;
}

export function isReservedConnection(conn: unknown): conn is ReservedSQL {
  return !!(conn && typeof (conn as ReservedSQL).release === 'function');
}

export function isPoolableDialect(dialect: SqlDialect): boolean {
  return dialect !== 'sqlite';
}

/**
 * Robustly infers the UQL SqlDialect from a Bun SQL.Options object.
 */
export function inferDialect(config: SQL.Options): SqlDialect {
  if ((config as SQL.SQLiteOptions).filename) return 'sqlite';
  const opts = config as SQL.PostgresOrMySQLOptions;
  if (opts.url) {
    const urlStr = opts.url.toString();
    if (urlStr === ':memory:') return 'sqlite';
    const scheme = urlStr.split(':')[0];
    if (scheme === 'sqlite3') return 'sqlite';
    if (scheme === 'mysql2') return 'mysql';
    if (scheme === 'postgresql') return 'postgres';
    return scheme as SqlDialect;
  }
  if (opts.adapter) return opts.adapter as SqlDialect;
  return 'postgres';
}

/**
 * Normalizes SQL.Options into a structure that Bun's SQL engine expects for a given dialect.
 * Crucially handles 'filename' mapping for SQLite and alias resolution for Cockroach/MariaDB.
 */
export function normalizeBunOpts(config: SQL.Options, dialect: SqlDialect): SQL.Options {
  if (dialect === 'sqlite') {
    const rawFilename =
      ('filename' in config ? config.filename : null) || ('url' in config ? config.url : null) || ':memory:';
    return {
      ...config,
      adapter: 'sqlite',
      filename: rawFilename.toString(),
    } satisfies SQL.SQLiteOptions;
  }

  const bunAdapter = dialect === 'cockroachdb' ? 'postgres' : dialect;
  const opts: SQL.PostgresOrMySQLOptions = { bigint: true, ...config, adapter: bunAdapter };

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
 * Normalizes Bun result rows into plain JavaScript objects and coerces BigInts to numbers.
 * This ensures compatibility with UQL's expected return types and reliable JSON serialization.
 */
export function normalizeRows<T>(res: BunSqlResult<T>): T[] {
  const rows: T[] = [];
  for (const row of res) {
    const cleanRow = { ...row };
    for (const key in cleanRow) {
      if (typeof cleanRow[key] === 'bigint') {
        cleanRow[key] = Number(cleanRow[key]) as T[typeof key];
      }
    }
    rows.push(cleanRow);
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
