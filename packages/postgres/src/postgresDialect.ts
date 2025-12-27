import { AbstractSqlDialect } from 'nukak/dialect';
import { getMeta } from 'nukak/entity';
import type {
  FieldKey,
  QueryComparisonOptions,
  QueryConflictPaths,
  QueryOptions,
  QueryTextSearchOptions,
  QueryWhereFieldOperatorMap,
  QueryWhereMap,
  Type,
} from 'nukak/type';
import { filterFieldKeys, getKeys } from 'nukak/util';
import sqlstring from 'sqlstring-sqlite';

export class PostgresDialect extends AbstractSqlDialect {
  constructor() {
    super('"', 'BEGIN TRANSACTION');
  }

  override insert<E>(entity: Type<E>, payload: E | E[]): string {
    const sql = super.insert(entity, payload);
    const returning = this.returningId(entity);
    return `${sql} ${returning}`;
  }

  override upsert<E>(entity: Type<E>, conflictPaths: QueryConflictPaths<E>, payload: E): string {
    const meta = getMeta(entity);
    const insert = super.insert(entity, payload);
    const fields = filterFieldKeys(meta, payload, 'onInsert');
    const update = fields
      .filter((col) => !conflictPaths[col])
      .map((col) => `${this.escapeId(col)} = EXCLUDED.${this.escapeId(col)}`)
      .join(', ');
    const keysStr = getKeys(conflictPaths)
      .map((key) => this.escapeId(key))
      .join(', ');
    const returning = this.returningId(entity);
    return `${insert} ON CONFLICT (${keysStr}) DO UPDATE SET ${update} ${returning}`;
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
        return `${String(comparisonKey)} ILIKE ${this.escape(`${val}%`)}`;
      case '$iendsWith':
        return `${String(comparisonKey)} ILIKE ${this.escape(`%${val}`)}`;
      case '$iincludes':
        return `${String(comparisonKey)} ILIKE ${this.escape(`%${val}%`)}`;
      case '$ilike':
        return `${String(comparisonKey)} ILIKE ${this.escape(val)}`;
      case '$regex':
        return `${String(comparisonKey)} ~ ${this.escape(val)}`;
      default:
        return super.compareFieldOperator(entity, key, op, val, opts);
    }
  }

  override escape(value: unknown): string {
    return sqlstring.escape(value);
  }
}
