import SqlString from 'sqlstring';
import { AbstractSqlDialect } from '../dialect/index.js';

export class MySqlDialect extends AbstractSqlDialect {
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
