import { MysqlLikeSqlDialect } from '../dialect/index.js';
import type { NamingStrategy } from '../type/index.js';

export class MySqlDialect extends MysqlLikeSqlDialect {
  constructor(namingStrategy?: NamingStrategy) {
    super('mysql', namingStrategy);
  }
}
