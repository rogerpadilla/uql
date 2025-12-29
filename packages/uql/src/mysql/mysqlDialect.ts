import { AbstractSqlDialect } from 'nukak/dialect';
import SqlString from 'sqlstring';

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
