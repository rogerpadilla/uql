import { SqlDialect } from '../sqlDialect';
import { QueryTextSearchOptions, QueryPrimitive } from '../../type';
import { getEntityMeta } from '../../entity';

export class SqliteDialect extends SqlDialect {
  readonly beginTransactionCommand = 'BEGIN TRANSACTION';

  comparison<T>(type: { new (): T }, key: string, value: object | QueryPrimitive): string {
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
