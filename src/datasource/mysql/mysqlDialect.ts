import { escape, escapeId } from 'sqlstring';
import { SqlDialect } from '../sqlDialect';
import { QueryTextSearchOptions, QueryFilterEntryValue } from '../../type';

export class MySqlDialect extends SqlDialect {
  readonly beginTransactionCommand = 'START TRANSACTION';

  filterEntry<T>(key: string, val: QueryFilterEntryValue<T>) {
    switch (key) {
      case '$text':
        const search = val as QueryTextSearchOptions<T>;
        const fields = escapeId(search.fields);
        return `MATCH(${fields}) AGAINST(${escape(search.value)})`;
      default:
        return super.filterEntry(key, val);
    }
  }
}
