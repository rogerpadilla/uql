import { AbstractSqlDialect } from 'nukak/dialect';
import { escape as escapeValue } from 'sqlstring';

export class MySqlDialect extends AbstractSqlDialect {
  override escape(value: unknown): string {
    return escapeValue(value);
  }
}
