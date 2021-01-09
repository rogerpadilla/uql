import { getEntityMeta } from '../../entity/decorator';
import { QueryComparisonOperator, QueryTextSearchOptions, QueryScalarValue } from '../../type';
import { BaseSqlDialect } from '../baseSqlDialect';

export class PostgresDialect extends BaseSqlDialect {
  readonly beginTransactionCommand = 'BEGIN';

  insert<T>(type: { new (): T }, body: T | T[]): string {
    const sql = super.insert(type, body);
    const meta = getEntityMeta(type);
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
    const meta = getEntityMeta(type);
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

  escapeId<T>(val: string | string[] | keyof T, forbidQualified?: boolean): string {
    if (Array.isArray(val)) {
      return val.map((it) => this.escapeId(it, forbidQualified)).join(', ');
    }
    const str = val as string;
    if (!forbidQualified && str.includes('.')) {
      return str
        .split('.')
        .map((it) => this.escapeId(it, true))
        .join('.');
    }
    return escapeId(str);
  }
}

export function escapeId(str: string) {
  // sourced from escapeIdentifier here https://github.com/brianc/node-postgres/blob/master/packages/pg/lib/client.js
  return '"' + str.replace(/"/g, '""') + '"';
}
