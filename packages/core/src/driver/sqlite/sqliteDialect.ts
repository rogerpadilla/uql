import { QueryTextSearchOptions, QueryScalarValue } from '../../type';
import { getEntityMeta } from '../../entity/decorator';
import { BaseSqlDialect } from '../baseSqlDialect';

export class SqliteDialect extends BaseSqlDialect {
  readonly beginTransactionCommand = 'BEGIN TRANSACTION';

  comparison<T>(type: { new (): T }, key: string, value: object | QueryScalarValue): string {
    switch (key) {
      case '$text':
        const search = value as QueryTextSearchOptions<T>;
        const meta = getEntityMeta(type);
        return `${this.escapeId(meta.name)} MATCH ${this.escape(search.value)}`;
      default:
        return super.comparison(type, key, value);
    }
  }
}
