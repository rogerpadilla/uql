import { AbstractSqlDialect } from 'nukak/dialect';
import SqlString from 'sqlstring';

export class MySqlDialect extends AbstractSqlDialect {
  override escape(value: unknown): string {
    return SqlString.escape(value);
  }
}
