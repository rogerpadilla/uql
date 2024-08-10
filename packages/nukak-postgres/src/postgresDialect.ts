import {
  QueryComparisonOptions,
  QueryWhereMap,
  QueryOptions,
  QueryWhereFieldOperatorMap,
  QueryTextSearchOptions,
  Type,
  FieldKey,
  Scalar,
} from 'nukak/type';
import { AbstractSqlDialect } from 'nukak/dialect';
import { getMeta } from 'nukak/entity';
import { quoteLiteral } from 'node-pg-format';

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

  override compare<E, K extends keyof QueryWhereMap<E>>(
    entity: Type<E>,
    key: K,
    val: QueryWhereMap<E>[K],
    opts: QueryComparisonOptions = {},
  ): string {
    if (key === '$text') {
      const meta = getMeta(entity);
      const search = val as QueryTextSearchOptions<E>;
      const fields = search.$fields
        .map((field) => this.escapeId(meta.fields[field]?.name ?? field))
        .join(` || ' ' || `);
      return `to_tsvector(${fields}) @@ to_tsquery(${this.escape(search.$value)})`;
    }
    return super.compare(entity, key, val, opts);
  }

  override compareFieldOperator<E, K extends keyof QueryWhereFieldOperatorMap<E>>(
    entity: Type<E>,
    key: FieldKey<E>,
    op: K,
    val: QueryWhereFieldOperatorMap<E>[K],
    opts: QueryOptions = {},
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

  override escape(value: any): Scalar {
    return quoteLiteral(value);
  }
}
