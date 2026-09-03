import { CockroachDialect } from '../../cockroachdb/cockroachDialect.js';
import type { AbstractSqlDialect } from '../../dialect/abstractSqlDialect.js';
import { MysqlLikeSqlDialect } from '../../dialect/mysqlLikeSqlDialect.js';
import { PgLikeSqlDialect } from '../../dialect/pgLikeSqlDialect.js';
import { MariaDialect } from '../../maria/mariaDialect.js';
import { MySqlDialect } from '../../mysql/mysqlDialect.js';
import { IndexDdl } from './indexDdl.js';
import { MariaIndexDdl, MySqlIndexDdl, MysqlLikeIndexDdl } from './mysqlIndexDdl.js';
import { CockroachIndexDdl, PgIndexDdl } from './pgIndexDdl.js';

export { IndexDdl } from './indexDdl.js';
export { MariaIndexDdl, MySqlIndexDdl, MysqlLikeIndexDdl } from './mysqlIndexDdl.js';
export { CockroachIndexDdl, PgIndexDdl } from './pgIndexDdl.js';

/**
 * The index DDL a dialect gets, most specific first. `instanceof` rather than `dialectName` so a
 * dialect subclassed by a user keeps its family's DDL, which is what overriding gave it while this
 * lived on the dialect itself. Anything else gets the portable form, which is SQLite's.
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
