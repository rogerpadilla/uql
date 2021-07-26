import { BaseSqlDialect } from './baseSqlDialect';

export class SqliteDialect extends BaseSqlDialect {
  constructor() {
    super('BEGIN TRANSACTION', '`');
  }
}
