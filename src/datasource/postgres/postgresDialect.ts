import { escape, escapeId } from 'sqlstring';
import { SqlDialect } from '../sqlDialect';
import { QueryComparisonOperator, QueryTextSearchOptions, QueryFilterEntryValue } from '../../type';
import { getEntityMeta } from '../../entity';

export class PostgresDialect extends SqlDialect {
  insert<T>(type: { new (): T }, body: T | T[]) {
    const sql = super.insert(type, body);
    const meta = getEntityMeta(type);
    return sql + ` RETURNING ${meta.id} AS insertId`;
  }

  filterEntry<T>(key: string, val: QueryFilterEntryValue<T>) {
    switch (key) {
      case '$text':
        const search = val as QueryTextSearchOptions<T>;
        const fields = search.fields.map((field) => escapeId(field)).join(` || ' ' || `);
        return `to_tsvector(${fields}) @@ to_tsquery(${escape(search.value)})`;
      default:
        return super.filterEntry(key, val);
    }
  }

  compare<T, K extends keyof QueryComparisonOperator<T>>(attr: keyof T, operator: K, val: QueryComparisonOperator<T>[K]) {
    switch (operator) {
      case '$startsWith':
        return `${escapeId(attr)} ILIKE ${escape(val + '%')}`;
      case '$re':
        return `${escapeId(attr)} ~ ${escape(val)}`;
      default:
        return super.compare(attr, operator, val);
    }
  }
}
