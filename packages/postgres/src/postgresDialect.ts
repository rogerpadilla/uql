import { getMeta } from '@uql/core/entity/decorator';
import {
  FieldKey,
  QueryFieldValue,
  QueryOptions,
  QuerySingleFieldOperator,
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

  override compare<E, K extends FieldKey<E>>(
    entity: Type<E>,
    key: K,
    val: QueryFieldValue<E[K]>,
    hasMultiKeys: boolean,
    opts?: QueryOptions
  ): string {
    if (key === '$text') {
      const meta = getMeta(entity);
      const search = val as QueryTextSearchOptions<E>;
      const fields = search.$fields
        .map((field) => this.escapeId(meta.fields[field]?.name ?? field))
        .join(` || ' ' || `);
      return `to_tsvector(${fields}) @@ to_tsquery(${this.escape(search.$value)})`;
    }

    return super.compare(entity, key, val, hasMultiKeys, opts);
  }

  override compareOperator<E, K extends FieldKey<E>>(
    entity: Type<E>,
    key: K,
    op: keyof QuerySingleFieldOperator<E>,
    val: QueryFieldValue<E[K]>,
    opts?: QueryOptions
  ): string {
    const expression = this.getCompareExpression(entity, key, opts);
    switch (op) {
      case '$startsWith':
        return `${expression} ILIKE ${this.escape(`${val}%`)}`;
      case '$endsWith':
        return `${expression} ILIKE ${this.escape(`%${val}`)}`;
      case '$regex':
        return `${expression} ~ ${this.escape(val)}`;
      default:
        return super.compareOperator(entity, key, op, val, opts);
    }
  }
}
