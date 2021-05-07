import { QueryTextSearchOptions, QueryScalarValue } from '../../type';
import { getMeta } from '../../entity/decorator';
import { BaseSqlDialect } from '../baseSqlDialect';

export class SqliteDialect extends BaseSqlDialect {
  constructor() {
    super('BEGIN TRANSACTION', '`');
  }

  compare<T>(
    type: { new (): T },
    key: string,
    value: object | QueryScalarValue,
    opts: { prefix?: string } = {}
  ): string {
    switch (key) {
      case '$text':
        const search = value as QueryTextSearchOptions<T>;
        const meta = getMeta(type);
        return `${this.escapeId(meta.name)} MATCH ${this.escape(search.value)}`;
      default:
        return super.compare(type, key, value, opts);
    }
  }
}
