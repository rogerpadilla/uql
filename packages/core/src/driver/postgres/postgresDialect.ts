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

  comparison<T>(type: { new (): T }, key: string, value: object | QueryScalarValue): string {
    switch (key) {
      case '$text':
        const search = value as QueryTextSearchOptions<T>;
        const fields = search.fields.map((field) => this.escapeId(field)).join(` || ' ' || `);
        return `to_tsvector(${fields}) @@ to_tsquery(${this.escape(search.value)})`;
      default:
        return super.comparison(type, key, value);
    }
  }

  comparisonOperation<T, K extends keyof QueryComparisonOperator<T>>(
    attr: keyof T,
    operator: K,
    val: QueryComparisonOperator<T>[K]
  ): string {
    switch (operator) {
      case '$startsWith':
        return `${this.escapeId(attr)} ILIKE ${this.escape(`${val}%`)}`;
      case '$re':
        return `${this.escapeId(attr)} ~ ${this.escape(val)}`;
      default:
        return super.comparisonOperation(attr, operator, val);
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
