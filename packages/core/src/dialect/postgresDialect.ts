import { getMeta } from '@uql/core/entity';
import {
  QueryComparisonOptions,
  QueryFilterMap,
  QueryOptions,
  QueryFilterFieldOperatorMap,
  QueryTextSearchOptions,
  Type,
  FieldKey,
} from '@uql/core/type';
import { AbstractSqlDialect } from './abstractSqlDialect';

export class PostgresDialect extends AbstractSqlDialect {
  constructor() {
    super('"', 'BEGIN TRANSACTION');
  }

  override insert<E>(entity: Type<E>, payload: E | E[]): string {
    const sql = super.insert(entity, payload);
    const meta = getMeta(entity);
    const idName = meta.fields[meta.id].name;
    return `${sql} RETURNING ${this.escapeId(idName)} ${this.escapeId('id')}`;
  }

  override compare<E, K extends keyof QueryFilterMap<E>>(entity: Type<E>, key: K, val: QueryFilterMap<E>[K], opts?: QueryComparisonOptions): string {
    if (key === '$text') {
      const meta = getMeta(entity);
      const search = val as QueryTextSearchOptions<E>;
      const fields = search.$fields.map((field) => this.escapeId(meta.fields[field]?.name ?? field)).join(` || ' ' || `);
      return `to_tsvector(${fields}) @@ to_tsquery(${this.escape(search.$value)})`;
    }
    return super.compare(entity, key, val, opts);
  }

  override compareFieldOperator<E, K extends keyof QueryFilterFieldOperatorMap<E>>(
    entity: Type<E>,
    key: FieldKey<E>,
    op: K,
    val: QueryFilterFieldOperatorMap<E>[K],
    opts?: QueryOptions
  ): string {
    const comparisonKey = this.getComparisonKey(entity, key, opts);
    switch (op) {
      case '$istartsWith':
        return `${comparisonKey} ILIKE ${this.escape(`${val}%`)}`;
      case '$iendsWith':
        return `${comparisonKey} ILIKE ${this.escape(`%${val}`)}`;
      case '$iincludes':
        return `${comparisonKey} ILIKE ${this.escape(`%${val}%`)}`;
      case '$ilike':
        return `${comparisonKey} ILIKE ${this.escape(val)}`;
      case '$regex':
        return `${comparisonKey} ~ ${this.escape(val)}`;
      default:
        return super.compareFieldOperator(entity, key, op, val, opts);
    }
  }
}
