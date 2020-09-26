import { QueryTextSearchOptions, QueryPrimitive } from 'uql/type';
import { SqlDialect } from '../sqlDialect';

export class MySqlDialect extends SqlDialect {
  readonly beginTransactionCommand = 'START TRANSACTION';

  comparison<T>(type: { new (): T }, key: string, value: object | QueryPrimitive): string {
    switch (key) {
      case '$text':
        const search = value as QueryTextSearchOptions<T>;
        const fields = this.escapeId(search.fields);
        return `MATCH(${fields}) AGAINST(${this.escape(search.value)})`;
      default:
        return super.comparison(type, key, value);
    }
  }
}
