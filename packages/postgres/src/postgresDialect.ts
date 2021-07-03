import { getMeta } from '@uql/core/entity/decorator';
import { QuerySingleFieldOperator, QueryTextSearchOptions, Scalar, Type } from '@uql/core/type';
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

  override compare<E>(entity: Type<E>, key: string, value: Scalar | object, opts: { prefix?: string } = {}): string {
    switch (key) {
      case '$text':
        const meta = getMeta(entity);
        const search = value as QueryTextSearchOptions<E>;
        const fields = search.$fields
          .map((field) => this.escapeId(meta.fields[field]?.name ?? field))
          .join(` || ' ' || `);
        return `to_tsvector(${fields}) @@ to_tsquery(${this.escape(search.$value)})`;
      default:
        return super.compare(entity, key, value, opts);
    }
  }

  override compareOperator<E, K extends keyof QuerySingleFieldOperator<E>>(
    entity: Type<E>,
    key: string,
    operator: K,
    val: QuerySingleFieldOperator<E>[K],
    opts: { prefix?: string } = {}
  ): string {
    const value = this.getCompareKey(entity, key, opts);
    switch (operator) {
      case '$startsWith':
        return `${value} ILIKE ${this.escape(`${val}%`)}`;
      case '$endsWith':
        return `${value} ILIKE ${this.escape(`%${val}`)}`;
      case '$regex':
        return `${value} ~ ${this.escape(val)}`;
      default:
        return super.compareOperator(entity, key, operator, val, opts);
    }
  }
}
