import { UPSERT_NEW_ROW_ALIAS } from '../dialect/aliases.js';
import { MysqlLikeSqlDialect } from '../dialect/mysqlLikeSqlDialect.js';

export class MySqlDialect extends MysqlLikeSqlDialect {
  override readonly dialectName = 'mysql';

  /**
   * `VALUES(col)` inside `ON DUPLICATE KEY UPDATE` has been deprecated since MySQL 8.0.20 and is
   * "subject to removal in a future version"; aliasing the inserted row (8.0.19+) is its replacement.
   */
  protected override readonly upsertNewRowAlias = UPSERT_NEW_ROW_ALIAS;
}
