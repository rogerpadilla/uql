import { getMeta } from '@uql/core/entity/decorator';
import { BaseSqlDialect } from '@uql/core/sql';
import { QueryTextSearchOptions, Scalar, Type } from '@uql/core/type';

export class MySqlDialect extends BaseSqlDialect {
  constructor() {
    super('START TRANSACTION', '`');
  }

  compare<E>(entity: Type<E>, key: string, value: Scalar | object, opts: { prefix?: string } = {}): string {
    switch (key) {
      case '$text':
        const meta = getMeta(entity);
        const search = value as QueryTextSearchOptions<E>;
        const fields = search.$fields.map((field) => meta.properties[field as string]?.name ?? this.escapeId(field));
        return `MATCH(${fields.join(', ')}) AGAINST(${this.escape(search.$value)})`;
      default:
        return super.compare(entity, key, value, opts);
    }
  }
}
