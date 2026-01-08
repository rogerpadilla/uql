import SqlString from 'sqlstring';
import { AbstractSqlDialect } from '../dialect/index.js';
import type { NamingStrategy } from '../type/namingStrategy.js';

export class MySqlDialect extends AbstractSqlDialect {
  constructor(namingStrategy?: NamingStrategy) {
    super('mysql', namingStrategy);
  }
  override addValue(values: unknown[], value: unknown): string {
    if (value instanceof Date) {
      values.push(value);
      return '?';
    }
    return super.addValue(values, value);
  }

  override escape(value: unknown): string {
    return SqlString.escape(value);
  }
}
