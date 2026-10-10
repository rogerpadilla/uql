import { describe, expect, it } from 'vitest';
import { CockroachDialect } from '../cockroachdb/cockroachDialect.js';
import type { AbstractSqlDialect } from '../dialect/abstractSqlDialect.js';
import { MariaDialect } from '../mariadb/mariaDialect.js';
import { MsSqlDialect } from '../mssql/mssqlDialect.js';
import { MySqlDialect } from '../mysql/mysqlDialect.js';
import { PgliteDialect } from '../pglite/pgliteDialect.js';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import { SqliteDialect } from '../sqlite/sqliteDialect.js';
import { assertDefined } from '../test/index.js';
import type { QuerySql } from '../type/index.js';
import { namedLockSql } from './migrationLock.js';

/** A statement as `dialect` sends it: its SQL and the values it binds. */
function rendered(dialect: AbstractSqlDialect, sql: QuerySql) {
  const { sql: text, values } = dialect.compile(sql);
  return { sql: text.replace(/\s+/g, ' '), values };
}

const MYSQL_LOCK = "LEFT(CONCAT(DATABASE(), '.', ?), 64)";

describe('namedLockSql', () => {
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
  ])('should spell the named lock on %s, its name bound', (_engine, dialect, acquire, release) => {
    const sql = namedLockSql(dialect, 'uql_migrations');
    assertDefined(sql);
    expect(rendered(dialect, sql.acquire)).toEqual(acquire);
    expect(rendered(dialect, sql.release)).toEqual(release);
  });

  /** PGlite runs Postgres, but every querier shares its one session, so a lock held there makes none wait. */
  it.each([
    ['CockroachDB', new CockroachDialect()],
    ['SQLite', new SqliteDialect({})],
    ['PGlite', new PgliteDialect()],
  ])('should have no named lock on %s', (_engine, dialect) => {
    expect(namedLockSql(dialect, 'uql_migrations')).toBeUndefined();
  });
});
