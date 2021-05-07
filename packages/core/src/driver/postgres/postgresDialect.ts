import { getMeta } from '../../entity/decorator';
import { QueryComparisonOperator, QueryTextSearchOptions, QueryScalarValue } from '../../type';
import { BaseSqlDialect } from '../baseSqlDialect';

export class PostgresDialect extends BaseSqlDialect {
  constructor() {
    super('BEGIN', '"');
  }

  insert<T>(type: { new (): T }, body: T | T[]): string {
    const sql = super.insert(type, body);
    const meta = getMeta(type);
    return `${sql} RETURNING ${meta.id.name} insertId`;
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
        const fields = search.fields.map((field) => this.escapeId(field)).join(` || ' ' || `);
        return `to_tsvector(${fields}) @@ to_tsquery(${this.escape(search.value)})`;
      default:
        return super.compare(type, key, value, opts);
    }
  }

  compareProperty<T, K extends keyof QueryComparisonOperator<T>>(
    type: { new (): T },
    prop: string,
    operator: K,
    val: QueryComparisonOperator<T>[K],
    opts: { prefix?: string } = {}
  ): string {
    const meta = getMeta(type);
    const prefix = opts.prefix ? `${this.escapeId(opts.prefix, true)}.` : '';
    const name = meta.properties[prop]?.name || prop;
    const col = prefix + this.escapeId(name);
    switch (operator) {
      case '$startsWith':
        return `${col} ILIKE ${this.escape(`${val}%`)}`;
      case '$re':
        return `${col} ~ ${this.escape(val)}`;
      default:
        return super.compareProperty(type, prop, operator, val, opts);
    }
  }
}
