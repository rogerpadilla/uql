import { getMeta } from '@uql/core/entity/decorator';
import { BaseSqlDialect } from '@uql/core/sql';
import { FieldKey, QueryFieldValue, QueryOptions, QueryTextSearchOptions, Type } from '@uql/core/type';

export class MySqlDialect extends BaseSqlDialect {
  constructor() {
    super('START TRANSACTION', '`');
  }

  override compare<E, K extends FieldKey<E>>(
    entity: Type<E>,
    key: K,
    value: QueryFieldValue<E[K]>,
    opts?: QueryOptions
  ): string {
    switch (key) {
      case '$text':
        const meta = getMeta(entity);
        const search = value as QueryTextSearchOptions<E>;
        const fields = search.$fields.map((field) => this.escapeId(meta.fields[field]?.name ?? field));
        return `MATCH(${fields.join(', ')}) AGAINST(${this.escape(search.$value)})`;
      default:
        return super.compare(entity, key, value, opts);
    }
  }
}
