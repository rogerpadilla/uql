import type { AbstractSqlDialect } from '../../dialect/abstractSqlDialect.js';
import type { SqlDialectName } from '../../type/index.js';
import { IndexDdl } from './indexDdl.js';
import { MsSqlIndexDdl } from './mssqlIndexDdl.js';
import { MsSqlTableDdl } from './mssqlTableDdl.js';
import { MariaIndexDdl, MySqlIndexDdl } from './mysqlIndexDdl.js';
import { CockroachIndexDdl, PgIndexDdl } from './pgIndexDdl.js';
import { TableDdl } from './tableDdl.js';

export { IndexDdl } from './indexDdl.js';
export { MsSqlIndexDdl } from './mssqlIndexDdl.js';
export { MsSqlTableDdl } from './mssqlTableDdl.js';
export { MariaIndexDdl, MySqlIndexDdl, MysqlLikeIndexDdl } from './mysqlIndexDdl.js';
export { CockroachIndexDdl, PgIndexDdl } from './pgIndexDdl.js';
export { TableDdl } from './tableDdl.js';

/**
 * Each engine's index DDL, by the `dialectName` a subclass inherits: by name, so this entry carries no
 * dialect, and exhaustive, so a new engine has to name its own. SQLite's is the portable form.
 */
const INDEX_DDL: Readonly<Record<SqlDialectName, new (dialect: AbstractSqlDialect) => IndexDdl>> = {
  postgres: PgIndexDdl,
  cockroachdb: CockroachIndexDdl,
  mysql: MySqlIndexDdl,
  mariadb: MariaIndexDdl,
  mssql: MsSqlIndexDdl,
  sqlite: IndexDdl,
};

export function indexDdlFor(dialect: AbstractSqlDialect): IndexDdl {
  return new INDEX_DDL[dialect.dialectName](dialect);
}

/**
 * The table DDL a dialect gets: SQL Server's, or the portable form every other engine takes. By
 * `dialectName`, which a subclass inherits too, so this entry need not carry the dialect itself.
 */
export function tableDdlFor(dialect: AbstractSqlDialect): TableDdl {
  return dialect.dialectName === 'mssql' ? new MsSqlTableDdl(dialect) : new TableDdl(dialect);
}
