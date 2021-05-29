import { getMeta } from '@uql/core/entity/decorator';
import { QueryTextSearchOptions, Scalar, Type } from '@uql/core/type';
import { BaseSqlDialect } from '@uql/core/sql';

export class SqliteDialect extends BaseSqlDialect {
  constructor() {
    super('BEGIN TRANSACTION', '`');
  }

  compare<E>(entity: Type<E>, key: string, value: Scalar | object, opts: { prefix?: string } = {}): string {
    switch (key) {
      case '$text':
        const search = value as QueryTextSearchOptions<E>;
        const meta = getMeta(entity);
        return `${meta.name} MATCH ${this.escape(search.value)}`;
      default:
        return super.compare(entity, key, value, opts);
    }
  }
}
