import { AbstractSqlDialect } from './abstractSqlDialect';

export class MySqlDialect extends AbstractSqlDialect {
  constructor() {
    super('START TRANSACTION', '`');
  }
}
