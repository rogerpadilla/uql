import { CockroachDialect } from '../../cockroachdb/cockroachDialect.js';
import type { AbstractSqlDialect } from '../../dialect/abstractSqlDialect.js';
import { MysqlLikeSqlDialect } from '../../dialect/mysqlLikeSqlDialect.js';
import { PgLikeSqlDialect } from '../../dialect/pgLikeSqlDialect.js';
import { MariaDialect } from '../../maria/mariaDialect.js';
import { MySqlDialect } from '../../mysql/mysqlDialect.js';
import { IndexDdl } from './indexDdl.js';
import { MsSqlTableDdl } from './mssqlTableDdl.js';
import { MariaIndexDdl, MySqlIndexDdl, MysqlLikeIndexDdl } from './mysqlIndexDdl.js';
import { CockroachIndexDdl, PgIndexDdl } from './pgIndexDdl.js';
import { TableDdl } from './tableDdl.js';

export { IndexDdl } from './indexDdl.js';
export { MsSqlTableDdl } from './mssqlTableDdl.js';
export { MariaIndexDdl, MySqlIndexDdl, MysqlLikeIndexDdl } from './mysqlIndexDdl.js';
export { CockroachIndexDdl, PgIndexDdl } from './pgIndexDdl.js';
export { TableDdl } from './tableDdl.js';

/**
 * The index DDL a dialect gets, most specific first. `instanceof` rather than the `dialectName`
 * {@link tableDdlFor} reads, because each family's index DDL is typed to its dialect and the narrowing
 * is what hands it one. Anything else gets the portable form, which is SQLite's.
 */
export function indexDdlFor(dialect: AbstractSqlDialect): IndexDdl {
  if (dialect instanceof CockroachDialect) {
    return new CockroachIndexDdl(dialect);
  }
  if (dialect instanceof PgLikeSqlDialect) {
    return new PgIndexDdl(dialect);
  }
  if (dialect instanceof MySqlDialect) {
    return new MySqlIndexDdl(dialect);
  }
  if (dialect instanceof MariaDialect) {
    return new MariaIndexDdl(dialect);
  }
  if (dialect instanceof MysqlLikeSqlDialect) {
    return new MysqlLikeIndexDdl(dialect);
  }
  return new IndexDdl(dialect);
}

/**
 * The table DDL a dialect gets: SQL Server's, or the portable form every other engine takes. By
 * `dialectName`, which a subclass inherits too, so this entry need not carry the dialect itself.
 */
export function tableDdlFor(dialect: AbstractSqlDialect): TableDdl {
  return dialect.dialectName === 'mssql' ? new MsSqlTableDdl(dialect) : new TableDdl(dialect);
}
