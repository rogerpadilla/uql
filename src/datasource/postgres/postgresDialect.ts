import { escape, escapeId } from 'sqlstring';
import { SqlDialect } from '../sqlDialect';
import { QueryComparisonOperator, QueryTextSearchOptions, QueryComparisonValue } from '../../type';

export class PostgresDialect extends SqlDialect {
  comparison<T>(key: string, val: QueryComparisonValue<T>) {
    switch (key) {
      case '$text':
        const search = val as QueryTextSearchOptions<T>;
        const fields = search.fields.map((field) => escapeId(field)).join(` || ' ' || `);
        return `to_tsvector(${fields}) @@ to_tsquery(${escape(search.value)})`;
      default:
        return super.comparison(key, val);
    }
  }

  comparisonOperation<T, K extends keyof QueryComparisonOperator<T>>(
    attr: keyof T,
    operator: K,
    val: QueryComparisonOperator<T>[K]
  ) {
    switch (operator) {
      case '$startsWith':
        return `${escapeId(attr)} ILIKE ${escape(val + '%')}`;
      default:
        return super.comparisonOperation(attr, operator, val);
    }
  }
}
