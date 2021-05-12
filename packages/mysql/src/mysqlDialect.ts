import { BaseSqlDialect } from '@uql/core/sql';

export class MySqlDialect extends BaseSqlDialect {
  constructor() {
    super('START TRANSACTION', '`');
  }
}
