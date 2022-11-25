import { getMeta } from 'nukak/entity/index.js';
import type { QueryFilterMap, QueryTextSearchOptions, Type, QueryComparisonOptions } from 'nukak/type/index.js';
import { AbstractSqlDialect } from 'nukak/dialect/abstractSqlDialect.js';

export class SqliteDialect extends AbstractSqlDialect {
  constructor() {
    super('`', 'BEGIN TRANSACTION');
  }

  override compare<E, K extends keyof QueryFilterMap<E>>(entity: Type<E>, key: K, val: QueryFilterMap<E>[K], opts?: QueryComparisonOptions): string {
    if (key === '$text') {
      const meta = getMeta(entity);
      const search = val as QueryTextSearchOptions<E>;
      const fields = search.$fields.map((field) => this.escapeId(meta.fields[field]?.name ?? field));
      return `${this.escapeId(meta.name)} MATCH {${fields.join(' ')}} : ${this.escape(search.$value)}`;
    }
    return super.compare(entity, key, val, opts);
  }
}
