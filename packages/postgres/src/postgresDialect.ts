import { getMeta } from '@uql/core/entity/decorator';
import {
  QueryComparisonOptions,
  QueryFieldValue,
  QueryFilterComparison,
  QueryOptions,
  QueryFilterSingleFieldOperator,
  QueryTextSearchOptions,
  Type,
} from '@uql/core/type';
import { BaseSqlDialect } from '@uql/core/sql';

export class PostgresDialect extends BaseSqlDialect {
  constructor() {
    super('BEGIN', '"');
  }

  override insert<E>(entity: Type<E>, payload: E | E[]): string {
    const sql = super.insert(entity, payload);
    const meta = getMeta(entity);
    const idName = meta.fields[meta.id].name;
    return `${sql} RETURNING ${this.escapeId(idName)} ${this.escapeId('id')}`;
  }

  override compare<E, K extends keyof QueryFilterComparison<E>>(
    entity: Type<E>,
    key: K,
    val: QueryFieldValue<E[K]>,
    opts?: QueryComparisonOptions
  ): string {
    if (key === '$text') {
      const meta = getMeta(entity);
      const search = val as QueryTextSearchOptions<E>;
      const fields = search.$fields.map((field) => this.escapeId(meta.fields[field]?.name ?? field)).join(` || ' ' || `);
      return `to_tsvector(${fields}) @@ to_tsquery(${this.escape(search.$value)})`;
    }

    return super.compare(entity, key, val, opts);
  }

  override compareSingleOperator<E, K extends keyof QueryFilterComparison<E>>(
    entity: Type<E>,
    key: K,
    op: keyof QueryFilterSingleFieldOperator<E>,
    val: QueryFieldValue<E[K]>,
    opts?: QueryOptions
  ): string {
    const comparisonKey = this.getComparisonKey(entity, key, opts);
    switch (op) {
      case '$ilike':
        return `${comparisonKey} ILIKE ${this.escape(`${val}`)}`;
      case '$istartsWith':
        return `${comparisonKey} ILIKE ${this.escape(`${val}%`)}`;
      case '$iendsWith':
        return `${comparisonKey} ILIKE ${this.escape(`%${val}`)}`;
      case '$regex':
        return `${comparisonKey} ~ ${this.escape(val)}`;
      default:
        return super.compareSingleOperator(entity, key, op, val, opts);
    }
  }
}
