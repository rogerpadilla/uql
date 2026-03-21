import type { ReservedSQL, SQL } from 'bun';
import type { PrimaryKey, RawRow, SqlDialect } from '../type/index.js';

/**
 * Represents the specialized array result from Bun's native SQL driver,
 * which includes metadata as extra properties on the array itself.
 */
export type BunSqlResult<T = RawRow> = T[] & {
  count?: number;
  affectedRows?: number;
  lastInsertRowid?: PrimaryKey;
};

/**
 * Extracts the number of affected rows from a Bun SQL result.
 * Bun uses 'count' for Postgres SELECT, but 'affectedRows' for MySQL/SQLite.
 */
export function getAffectedRows(res: BunSqlResult): number {
  return res.affectedRows ?? res.count ?? 0;
}

/**
 * Checks if a given object is a Bun SQL client instance.
 * Native Bun SQL clients are functions with 'unsafe' and 'reserve' properties.
 * This check also supports objects (mocks) that satisfy the interface.
 */
export function isBunSqlClient(config: unknown): config is SQL {
  return !!(
    config &&
    (typeof config === 'function' || typeof config === 'object') &&
    'unsafe' in config &&
    'reserve' in config
  );
}

/**
 * Checks if a database connection handle or client is a 'reserved' one (which requires manual release)
 * or a root singleton/unpooled client. This is common in native drivers like Bun SQL
 * where SQLite connections are persistent handles while Postgres/MySQL use pools.
 */
export function isReservedConnection(conn: unknown): conn is ReservedSQL {
  return !!(conn && typeof conn === 'object' && 'release' in conn && typeof conn.release === 'function');
}

/**
 * Checks if a Bun SQL dialect supports connection reservation (pooling).
 * Currently, native Bun SQLite drivers are unpooled and throw if .reserve() is called.
 */
export function isPoolableDialect(dialect: SqlDialect): boolean {
  return dialect !== 'sqlite';
}
