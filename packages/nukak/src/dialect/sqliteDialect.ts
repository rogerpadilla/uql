import { AbstractSqlDialect } from './abstractSqlDialect.js';

export class SqliteDialect extends AbstractSqlDialect {
  constructor() {
    super('`', 'BEGIN TRANSACTION');
  }
}
