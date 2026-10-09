import { afterAll, beforeAll } from 'vitest';
import { CockroachDialect, CrdbQuerierPool } from '../cockroachdb/index.js';
import type { AbstractSqlDialect } from '../dialect/index.js';
import { MariadbQuerierPool, MariaDialect } from '../mariadb/index.js';
import { Migrator } from '../migrate/migrator.js';
import { SqlSchemaGenerator } from '../migrate/schemaGenerator.js';
import { MsSqlDialect, MsSqlQuerierPool } from '../mssql/index.js';
import { MySql2QuerierPool, MySqlDialect } from '../mysql/index.js';
import { PgliteDialect } from '../pglite/pgliteDialect.js';
import { PgliteQuerierPool } from '../pglite/pgliteQuerierPool.js';
import { PgQuerierPool, PostgresDialect } from '../postgres/index.js';
import { NodeSqliteQuerierPool } from '../sqlite/nodeSqliteQuerierPool.js';
import { SqliteDialect } from '../sqlite/sqliteDialect.js';
import type { SqlDialectName, SqlQuerierPool, Type } from '../type/index.js';
import { raw } from '../util/raw.js';
import {
  cockroachConnection,
  mariadbConnection,
  mssqlConnection,
  mysqlConnection,
  postgresConnection,
} from './connections.js';
import { provisioningTimeout } from './spec.util.js';

/**
 * A suite entry: what to call the engine, how to open a pool on it, and its dialect, which states what the
 * engine can do without opening anything (a MariaDB pool connects as it is made).
 */
export type SqlPool = readonly [SqlDialectName | 'pglite', () => SqlQuerierPool, AbstractSqlDialect];

/**
 * Every SQL engine but those in `except`, as a pool each; one list, since a suite spelling its own drops an
 * engine unnoticed. Each server runs it on `database`, the file's own (AGENTS.md), so the schema it changes
 * is one no other file reads.
 */
export function sqlPools(database: string, ...except: readonly (SqlDialectName | 'pglite')[]): readonly SqlPool[] {
  const pools: readonly SqlPool[] = [
    ['pglite', () => new PgliteQuerierPool('memory://'), new PgliteDialect()],
    ['postgres', () => new PgQuerierPool(postgresConnection(database)), new PostgresDialect()],
    ['cockroachdb', () => new CrdbQuerierPool(cockroachConnection(database)), new CockroachDialect()],
    ['mysql', () => new MySql2QuerierPool(mysqlConnection(database)), new MySqlDialect()],
    ['mariadb', () => new MariadbQuerierPool(mariadbConnection(database)), new MariaDialect()],
    ['sqlite', () => new NodeSqliteQuerierPool(':memory:'), new SqliteDialect()],
    ['mssql', () => new MsSqlQuerierPool(mssqlConnection(database)), new MsSqlDialect()],
  ];
  return pools.filter(([name]) => !except.includes(name));
}

/** Drops `tables` one after another: two DDL statements fired at once deadlocked CockroachDB and SQL Server. */
export async function dropTables(pool: SqlQuerierPool, ...tables: readonly string[]): Promise<void> {
  for (const table of tables) {
    await pool.run(raw.text(`DROP TABLE IF EXISTS ${pool.dialect.escapeId(table)}`));
  }
}

/**
 * A pool with `entities` synced for the suite, dropped before it and after with their trigger functions and
 * the record of any migration a test ran. List the tables a trigger writes first: they drop in reverse, and
 * CockroachDB keeps a table a trigger's function uses.
 */
export function syncedPool(connect: () => SqlQuerierPool, entities: Type<object>[]): () => SqlQuerierPool {
  let pool: SqlQuerierPool;
  const dropAll = async () => {
    for (const statement of new SqlSchemaGenerator(pool.dialect).generateDropSchema(entities, { ifExists: true })) {
      await pool.run(raw.text(statement));
    }
    await dropTables(pool, 'uql_migrations');
  };
  beforeAll(async () => {
    pool = connect();
    await dropAll();
    await new Migrator(pool, { entities }).sync();
  }, provisioningTimeout);
  afterAll(async () => {
    await dropAll();
    await pool.end();
  }, provisioningTimeout);
  return () => pool;
}
