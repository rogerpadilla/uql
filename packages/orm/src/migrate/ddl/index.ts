import type { AbstractSqlDialect } from '../../dialect/abstractSqlDialect.js';
import type { SqlDialectName } from '../../type/index.js';
import { IndexDdl } from './indexDdl.js';
import { MsSqlIndexDdl } from './mssqlIndexDdl.js';
import { MsSqlTableDdl } from './mssqlTableDdl.js';
import { MariaIndexDdl, MySqlIndexDdl } from './mysqlIndexDdl.js';
import { MySqlTableDdl } from './mysqlTableDdl.js';
import { CockroachIndexDdl, PgIndexDdl } from './pgIndexDdl.js';
import { CockroachTableDdl, PgTableDdl } from './pgTableDdl.js';
import { SqliteIndexDdl } from './sqliteIndexDdl.js';
import { TableDdl } from './tableDdl.js';

export { IndexDdl } from './indexDdl.js';
export { MsSqlIndexDdl } from './mssqlIndexDdl.js';
export { MsSqlTableDdl } from './mssqlTableDdl.js';
export { MariaIndexDdl, MySqlIndexDdl, MysqlLikeIndexDdl } from './mysqlIndexDdl.js';
export { MySqlTableDdl } from './mysqlTableDdl.js';
export { CockroachIndexDdl, PgIndexDdl } from './pgIndexDdl.js';
export { CockroachTableDdl, PgTableDdl } from './pgTableDdl.js';
export { SqliteIndexDdl } from './sqliteIndexDdl.js';
export { TableDdl } from './tableDdl.js';

/**
 * Each engine's index DDL, by the `dialectName` a subclass inherits: by name, so this entry carries no
 * dialect, and exhaustive, so a new engine has to name its own.
 */
const INDEX_DDL: Readonly<Record<SqlDialectName, new (dialect: AbstractSqlDialect) => IndexDdl>> = {
  postgres: PgIndexDdl,
  cockroachdb: CockroachIndexDdl,
  mysql: MySqlIndexDdl,
  mariadb: MariaIndexDdl,
  mssql: MsSqlIndexDdl,
  sqlite: SqliteIndexDdl,
};

export function indexDdlFor(dialect: AbstractSqlDialect): IndexDdl {
  return new INDEX_DDL[dialect.dialectName](dialect);
}

/** Each engine's table DDL, keyed by `dialectName` and exhaustive, for the same reasons as {@link INDEX_DDL}. */
const TABLE_DDL: Readonly<Record<SqlDialectName, new (dialect: AbstractSqlDialect) => TableDdl>> = {
  postgres: PgTableDdl,
  cockroachdb: CockroachTableDdl,
  mysql: MySqlTableDdl,
  mariadb: MySqlTableDdl,
  mssql: MsSqlTableDdl,
  sqlite: TableDdl,
};

export function tableDdlFor(dialect: AbstractSqlDialect): TableDdl {
  return new TABLE_DDL[dialect.dialectName](dialect);
}
