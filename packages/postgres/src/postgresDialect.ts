import { getMeta } from '@uql/core/entity/decorator';
import { QueryComparisonOperator, QueryTextSearchOptions, Scalar, Type } from '@uql/core/type';
import { BaseSqlDialect } from '@uql/core/sql';

export class PostgresDialect extends BaseSqlDialect {
  constructor() {
    super('BEGIN', '"');
  }

  insert<E>(entity: Type<E>, body: E | E[]): string {
    const sql = super.insert(entity, body);
    const meta = getMeta(entity);
    return `${sql} RETURNING ${meta.id.name} insertId`;
  }

  compare<E>(entity: Type<E>, key: string, value: Scalar | object, opts: { prefix?: string } = {}): string {
    switch (key) {
      case '$text':
        const meta = getMeta(entity);
        const search = value as QueryTextSearchOptions<E>;
        const fields = search.fields
          .map((field) => meta.properties[field as string]?.name ?? this.escapeId(field))
          .join(` || ' ' || `);
        return `to_tsvector(${fields}) @@ to_tsquery(${this.escape(search.value)})`;
      default:
        return super.compare(entity, key, value, opts);
    }
  }

  compareProperty<E, K extends keyof QueryComparisonOperator<E>>(
    entity: Type<E>,
    prop: string,
    operator: K,
    val: QueryComparisonOperator<E>[K],
    opts: { prefix?: string } = {}
  ): string {
    const meta = getMeta(entity);
    const prefix = opts.prefix ? `${opts.prefix}.` : '';
    const name = meta.properties[prop]?.name ?? this.escapeId(prop);
    const colPath = prefix + name;
    switch (operator) {
      case '$startsWith':
        return `${colPath} ILIKE ${this.escape(`${val}%`)}`;
      case '$re':
        return `${colPath} ~ ${this.escape(val)}`;
      default:
        return super.compareProperty(entity, prop, operator, val, opts);
    }
  }
}
