import { BaseSqlDialect } from '../baseSqlDialect';

export class MySqlDialect extends BaseSqlDialect {
  constructor() {
    super('START TRANSACTION', '`');
  }
}
