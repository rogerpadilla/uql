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
  return !!(conn && typeof conn === 'object' && 'release' in conn && typeof conn.release === 'function');
}

export function isPoolableDialect(dialect: SqlDialect): boolean {
  return dialect !== 'sqlite';
}

/**
 * Robustly infers the UQL SqlDialect from a Bun SQL.Options object.
 */
export function inferDialect(config: SQL.Options): SqlDialect {
  if ('filename' in config) return 'sqlite';
  const adapter = config.adapter;
  if (adapter) {
    return adapter;
  }
  if ('url' in config && config.url) {
    const scheme = config.url.toString().split(':')[0];
    if (scheme === 'sqlite' || scheme === 'sqlite3') return 'sqlite';
    if (scheme === 'postgresql') return 'postgres';
    return scheme as SqlDialect;
  }
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
