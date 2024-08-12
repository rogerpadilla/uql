import sqlstring from 'sqlstring';
import { AbstractSqlDialect } from 'nukak/dialect';
import { QueryRaw, Scalar } from 'nukak/type';
import { getRawValue } from 'nukak/util';

export class MySqlDialect extends AbstractSqlDialect {
  override escape(value: any): Scalar {
    if (value instanceof QueryRaw) {
      return getRawValue({ value, dialect: this });
    }
    return sqlstring.escape(value);
  }
}
