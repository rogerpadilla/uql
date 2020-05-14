import { escape, escapeId } from 'sqlstring';
import { SqlDialect } from '../sqlDialect';
import { QueryComparisonOperator, QueryTextSearch, QueryComparisonValue } from '../../type';

export class PostgresDialect extends SqlDialect {
  comparison<T>(key: string, val: QueryComparisonValue<T>) {
    switch (key) {
      case '$text':
        const search = val as QueryTextSearch<T>;
        const fields = search.fields.map((field) => escapeId(field)).join(` || ' ' || `);
        return `to_tsvector(${fields}) @@ to_tsquery(${escape(search.value)})`;
      default:
        return super.comparison(key, val);
    }
  }

  comparisonOperation<T, K extends keyof QueryComparisonOperator<T>>(
    attr: string,
    comparisonOperator: K,
    comparisonVal: QueryComparisonOperator<T>[K]
  ) {
    switch (comparisonOperator) {
      case '$startsWith':
        return `${escapeId(attr)} ILIKE ${escape(comparisonVal + '%')}`;
      default:
        return super.comparisonOperation(attr, comparisonOperator, comparisonVal);
    }
  }
}
