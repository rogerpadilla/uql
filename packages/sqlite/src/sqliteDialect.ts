import { BaseSqlDialect } from '@uql/core/sql';

export class SqliteDialect extends BaseSqlDialect {
  constructor() {
    super('BEGIN TRANSACTION', '`');
  }
}
