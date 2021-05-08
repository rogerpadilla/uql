import { QueryTextSearchOptions, Scalar } from '../../type';
import { getMeta } from '../../entity/decorator';
import { BaseSqlDialect } from '../baseSqlDialect';

export class SqliteDialect extends BaseSqlDialect {
  constructor() {
    super('BEGIN TRANSACTION', '`');
  }

  compare<E>(entity: { new (): E }, key: string, value: Scalar | object, opts: { prefix?: string } = {}): string {
    switch (key) {
      case '$text':
        const search = value as QueryTextSearchOptions<E>;
        const meta = getMeta(entity);
        return `${this.escapeId(meta.name)} MATCH ${this.escape(search.value)}`;
      default:
        return super.compare(entity, key, value, opts);
    }
  }
}
