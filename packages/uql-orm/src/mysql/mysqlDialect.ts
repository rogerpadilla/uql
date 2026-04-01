import { MysqlLikeSqlDialect } from '../dialect/mysqlLikeSqlDialect.js';

export class MySqlDialect extends MysqlLikeSqlDialect {
  override readonly dialectName = 'mysql';

  override readonly serialPrimaryKey = 'BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY';
}
