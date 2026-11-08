import { describe, expect, it } from 'vitest';
import { CockroachDialect } from '../cockroachdb/cockroachDialect.js';
import type { AbstractSqlDialect } from '../dialect/abstractSqlDialect.js';
import { MariaDialect } from '../mariadb/mariaDialect.js';
import { MsSqlDialect } from '../mssql/mssqlDialect.js';
import { MySqlDialect } from '../mysql/mysqlDialect.js';
import { PgliteDialect } from '../pglite/pgliteDialect.js';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import { SqliteDialect } from '../sqlite/sqliteDialect.js';
import type { QuerySql } from '../type/index.js';
import { lockSql } from './migrationLock.js';

/** A statement as `dialect` sends it: its SQL and the values it binds. */
function rendered(dialect: AbstractSqlDialect, sql: QuerySql) {
  const { sql: text, values } = dialect.compile(sql);
  return { sql: text.replace(/\s+/g, ' '), values };
}

const MYSQL_LOCK = "LEFT(CONCAT(DATABASE(), '.', ?), 64)";

describe('lockSql', () => {
  it.each([
    [
      'Postgres',
      new PostgresDialect(),
      { sql: 'SELECT 1 WHERE pg_try_advisory_lock($1)', values: [2066202239] },
      { sql: 'SELECT pg_advisory_unlock($1)', values: [2066202239] },
    ],
    [
      'MySQL',
      new MySqlDialect(),
      { sql: `SELECT 1 FROM DUAL WHERE GET_LOCK(${MYSQL_LOCK}, 0) = 1`, values: ['uql_migrations'] },
      { sql: `DO RELEASE_LOCK(${MYSQL_LOCK})`, values: ['uql_migrations'] },
    ],
    [
      'MariaDB',
      new MariaDialect(),
      { sql: `SELECT 1 FROM DUAL WHERE GET_LOCK(${MYSQL_LOCK}, 0) = 1`, values: ['uql_migrations'] },
      { sql: `DO RELEASE_LOCK(${MYSQL_LOCK})`, values: ['uql_migrations'] },
    ],
    [
      'SQL Server',
      new MsSqlDialect(),
      {
        sql:
          "DECLARE @_uql_lock INT; EXEC @_uql_lock = sp_getapplock @Resource = @p1, @LockMode = 'Exclusive', " +
          "@LockOwner = 'Transaction', @LockTimeout = 0; SELECT 1 WHERE @_uql_lock >= 0",
        values: ['uql_migrations'],
      },
      {
        sql: "EXEC sp_releaseapplock @Resource = @p1, @LockOwner = 'Transaction'",
        values: ['uql_migrations'],
      },
    ],
    [
      'CockroachDB',
      new CockroachDialect(),
      {
        sql:
          'INSERT INTO "uql_migrations" ("name") SELECT $1 WHERE NOT EXISTS ' +
          '(SELECT 1 FROM "uql_migrations" WHERE "name" = $2) RETURNING 1',
        values: ['uql/lock', 'uql/lock'],
      },
      { sql: 'DELETE FROM "uql_migrations" WHERE "name" = $1', values: ['uql/lock'] },
    ],
    [
      'SQLite',
      new SqliteDialect({}),
      {
        sql:
          'INSERT INTO `uql_migrations` (`name`) SELECT ? WHERE NOT EXISTS ' +
          '(SELECT 1 FROM `uql_migrations` WHERE `name` = ?) RETURNING 1',
        values: ['uql/lock', 'uql/lock'],
      },
      { sql: 'DELETE FROM `uql_migrations` WHERE `name` = ?', values: ['uql/lock'] },
    ],
    [
      'PGlite',
      new PgliteDialect(),
      {
        sql:
          'INSERT INTO "uql_migrations" ("name") SELECT $1 WHERE NOT EXISTS ' +
          '(SELECT 1 FROM "uql_migrations" WHERE "name" = $2) RETURNING 1',
        values: ['uql/lock', 'uql/lock'],
      },
      { sql: 'DELETE FROM "uql_migrations" WHERE "name" = $1', values: ['uql/lock'] },
    ],
  ])('should spell the lock on %s, its name bound', (_engine, dialect, acquire, release) => {
    const sql = lockSql(dialect, 'uql_migrations');
    expect(rendered(dialect, sql.acquire)).toEqual(acquire);
    expect(rendered(dialect, sql.release)).toEqual(release);
  });
});
