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
 * Every SQL engine but those in `except`, as a pool each; one list, since a suite spelling its own drops an
 * engine unnoticed (SQL Server's stamps broke for exactly that long). SQL Server runs on `mssqlDatabase`,
 * one per file changing the schema, since two such files on one database deadlock (`docker/init-mssql.sql`).
 */
export function sqlPools(mssqlDatabase: string, ...except: readonly (SqlDialectName | 'pglite')[]): readonly SqlPool[] {
  const pools: readonly SqlPool[] = [
    ['pglite', () => new PgliteQuerierPool('memory://')],
    ['postgres', () => new PgQuerierPool(postgresConnection())],
    ['cockroachdb', () => new CrdbQuerierPool(cockroachConnection())],
    ['mysql', () => new MySql2QuerierPool(mysqlConnection())],
    ['mariadb', () => new MariadbQuerierPool(mariadbConnection())],
    ['sqlite', () => new NodeSqliteQuerierPool(':memory:')],
    ['mssql', () => new MsSqlQuerierPool(mssqlConnection(mssqlDatabase))],
  ];
  return pools.filter(([name]) => !except.includes(name));
}

/** Drops `tables` one after another: two DDL statements fired at once deadlocked CockroachDB and SQL Server. */
export async function dropTables(pool: SqlQuerierPool, ...tables: readonly string[]): Promise<void> {
  for (const table of tables) {
    await pool.run(`DROP TABLE IF EXISTS ${pool.dialect.escapeId(table)}`);
  }
}
