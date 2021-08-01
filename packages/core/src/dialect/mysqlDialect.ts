import { getMeta } from '@uql/core/entity';
import { QueryComparisonOptions, QueryFilterMap, QueryTextSearchOptions, Type } from '@uql/core/type';
import { BaseSqlDialect } from './baseSqlDialect';

export class MySqlDialect extends BaseSqlDialect {
  constructor() {
    super('START TRANSACTION', '`');
  }

  override compare<E, K extends keyof QueryFilterMap<E>>(entity: Type<E>, key: K, val: QueryFilterMap<E>[K], opts?: QueryComparisonOptions): string {
    if (key === '$text') {
      const meta = getMeta(entity);
      const search = val as QueryTextSearchOptions<E>;
      const fields = search.$fields.map((field) => this.escapeId(meta.fields[field]?.name ?? field));
      return `MATCH(${fields.join(', ')}) AGAINST(${this.escape(search.$value)})`;
    }

    return super.compare(entity, key, val, opts);
  }
}
