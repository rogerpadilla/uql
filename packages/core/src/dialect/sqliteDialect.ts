import { AbstractSqlDialect } from './abstractSqlDialect';

export class SqliteDialect extends AbstractSqlDialect {
  constructor() {
    super('`', 'BEGIN TRANSACTION');
  }
}
