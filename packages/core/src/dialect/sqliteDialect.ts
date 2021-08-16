import { getMeta } from '../entity';
import { QueryComparisonOptions, QueryFilterMap, QueryTextSearchOptions, Type } from '../type';
import { AbstractSqlDialect } from './abstractSqlDialect';

export class SqliteDialect extends AbstractSqlDialect {
  constructor() {
    super('BEGIN TRANSACTION', '`');
  }

  override compare<E, K extends keyof QueryFilterMap<E>>(entity: Type<E>, key: K, val: QueryFilterMap<E>[K], opts?: QueryComparisonOptions): string {
    if (key === '$text') {
      const meta = getMeta(entity);
      const search = val as QueryTextSearchOptions<E>;
      return `${this.escapeId(meta.name)} MATCH ${this.escape(search.$value)}`;
    }
    return super.compare(entity, key, val, opts);
  }
}
