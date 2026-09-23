import { CrdbQuerierPool } from '../cockroachdb/index.js';
import { MariadbQuerierPool } from '../maria/index.js';
import { MsSqlQuerierPool } from '../mssql/index.js';
import { MySql2QuerierPool } from '../mysql/index.js';
import { PgliteQuerierPool } from '../pglite/pgliteQuerierPool.js';
import { PgQuerierPool } from '../postgres/index.js';
import { NodeSqliteQuerierPool } from '../sqlite/nodeSqliteQuerierPool.js';
import type { SqlDialectName, SqlQuerierPool } from '../type/index.js';
import {
  cockroachConnection,
  mariadbConnection,
  mssqlConnection,
  mysqlConnection,
  postgresConnection,
} from './connections.js';

/** A suite entry: what to call the engine, and how to open a pool on it. */
export type SqlPool = readonly [SqlDialectName | 'pglite', () => SqlQuerierPool];

/**
 * Every SQL engine, as a pool each. One list rather than one per suite: a suite that spells its own
 * leaves an engine out by omission, which nothing notices - the `FROM inserted` a stamp needs on SQL
 * Server was broken for exactly that long. A suite that must skip one does it by name, in sight.
 */
export const SQL_POOLS: readonly SqlPool[] = [
  ['pglite', () => new PgliteQuerierPool('memory://')],
  ['postgres', () => new PgQuerierPool(postgresConnection())],
  ['cockroachdb', () => new CrdbQuerierPool(cockroachConnection())],
  ['mysql', () => new MySql2QuerierPool(mysqlConnection())],
  ['mariadb', () => new MariadbQuerierPool(mariadbConnection())],
  ['sqlite', () => new NodeSqliteQuerierPool(':memory:')],
  ['mssql', () => new MsSqlQuerierPool(mssqlConnection())],
];

/** {@link SQL_POOLS} without the engines named, each of which a suite has to justify leaving out. */
export function sqlPoolsExcept(...names: readonly (SqlDialectName | 'pglite')[]): readonly SqlPool[] {
  return SQL_POOLS.filter(([name]) => !names.includes(name));
}

/** Drops `tables` one after another: two DDL statements fired at once deadlocked CockroachDB and SQL Server. */
export async function dropTables(pool: SqlQuerierPool, ...tables: readonly string[]): Promise<void> {
  for (const table of tables) {
    await pool.run(`DROP TABLE IF EXISTS ${pool.dialect.escapeId(table)}`);
  }
}
