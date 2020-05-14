import { escape, escapeId } from 'sqlstring';
import { SqlDialect } from '../sqlDialect';
import { QueryTextSearch, QueryComparisonValue } from '../../type';

export class MySqlDialect extends SqlDialect {
  readonly beginTransactionCommand = 'START TRANSACTION';

  comparison<T>(key: string, val: QueryComparisonValue<T>) {
    switch (key) {
      case '$text':
        const search = val as QueryTextSearch<T>;
        const fields = escapeId(search.fields);
        return `MATCH(${fields}) AGAINST(${escape(search.value)})`;
      default:
        return super.comparison(key, val);
    }
  }
}
