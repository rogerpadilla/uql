import sqlstring from 'sqlstring-sqlite';
import { getMeta } from 'nukak/entity';
import { QueryFilterMap, QueryTextSearchOptions, Type, QueryComparisonOptions, QueryRaw, Scalar } from 'nukak/type';
import { AbstractSqlDialect } from 'nukak/dialect';
import { getRawValue } from 'nukak/util';

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

  override escape(value: any): Scalar {
    if (value instanceof QueryRaw) {
      return getRawValue({ value, dialect: this });
    }
    return sqlstring.escape(value);
  }
}
