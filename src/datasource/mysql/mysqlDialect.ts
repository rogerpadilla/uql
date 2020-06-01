import { escape, escapeId } from 'sqlstring';
import { SqlDialect } from '../sqlDialect';
import { QueryTextSearchOptions, QueryPrimitive } from '../../type';

export class MySqlDialect extends SqlDialect {
  readonly beginTransactionCommand = 'START TRANSACTION';

  comparison<T>(key: string, value: object | QueryPrimitive): string {
    switch (key) {
      case '$text':
        const search = value as QueryTextSearchOptions<T>;
        const fields = escapeId(search.fields);
        return `MATCH(${fields}) AGAINST(${escape(search.value)})`;
      default:
        return super.comparison(key, value);
    }
  }
}
