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
import sqlstring from 'sqlstring-sqlite';

export class PostgresDialect extends AbstractSqlDialect {
  constructor() {
    super('"', 'BEGIN TRANSACTION');
  }

  override addValue(values: unknown[], value: unknown, include = true): string {
    if (values) {
      if (include) {
        values.push(value);
      }
      return `$${values.length}`;
    }
    return this.escape(value);
  }

  override insert<E>(entity: Type<E>, payload: E | E[], opts?: QueryOptions, values?: unknown[]): string {
    const sql = super.insert(entity, payload, opts, values);
    const returning = this.returningId(entity);
    return `${sql} ${returning}`;
  }

  override upsert<E>(entity: Type<E>, conflictPaths: QueryConflictPaths<E>, payload: E, values?: unknown[]): string {
    const insert = super.insert(entity, payload, undefined, values);
    const meta = getMeta(entity);
    const update = this.getUpsertUpdateAssignments(meta, conflictPaths, payload, (name) => `EXCLUDED.${name}`, values);
    const keysStr = this.getUpsertConflictPathsStr(meta, conflictPaths);
    const returning = this.returningId(entity);
    const onConflict = update ? `DO UPDATE SET ${update}` : 'DO NOTHING';
    return `${insert} ON CONFLICT (${keysStr}) ${onConflict} ${returning}`;
  }

  override compare<E, K extends keyof QueryWhereMap<E>>(
    entity: Type<E>,
    key: K,
    val: QueryWhereMap<E>[K],
    opts: QueryComparisonOptions = {},
    values?: unknown[],
  ): string {
    if (key === '$text') {
      const meta = getMeta(entity);
      const search = val as QueryTextSearchOptions<E>;
      const fields = search.$fields
        .map((field) => this.escapeId(meta.fields[field]?.name ?? field))
        .join(` || ' ' || `);
      return `to_tsvector(${fields}) @@ to_tsquery(${this.addValue(values, search.$value)})`;
    }
    return super.compare(entity, key, val, opts, values);
  }

  override compareFieldOperator<E, K extends keyof QueryWhereFieldOperatorMap<E>>(
    entity: Type<E>,
    key: FieldKey<E>,
    op: K,
    val: QueryWhereFieldOperatorMap<E>[K],
    opts: QueryOptions = {},
    values?: unknown[],
  ): string {
    const comparisonKey = this.getComparisonKey(entity, key, opts, values);
    switch (op) {
      case '$istartsWith':
        return `${String(comparisonKey)} ILIKE ${this.addValue(values, `${val}%`)}`;
      case '$iendsWith':
        return `${String(comparisonKey)} ILIKE ${this.addValue(values, `%${val}`)}`;
      case '$iincludes':
        return `${String(comparisonKey)} ILIKE ${this.addValue(values, `%${val}%`)}`;
      case '$ilike':
        return `${String(comparisonKey)} ILIKE ${this.addValue(values, val)}`;
      case '$in':
        return `${String(comparisonKey)} = ANY(${this.addValue(values, val)})`;
      case '$nin':
        return `${String(comparisonKey)} <> ALL(${this.addValue(values, val)})`;
      case '$regex':
        return `${String(comparisonKey)} ~ ${this.addValue(values, val)}`;
      default:
        return super.compareFieldOperator(entity, key, op, val, opts, values);
    }
  }

  override formatPersistableValue(value: any, type: string, values?: unknown[]): string {
    if (type === 'json' || type === 'jsonb') {
      return this.addValue(values, JSON.stringify(value)) + `::${type}`;
    }
    if (type === 'vector') {
      const vector = (value as number[]).map((num) => +num).join(',');
      return `'[${vector}]'::vector`;
    }
    return super.formatPersistableValue(value, type, values);
  }

  override escape(value: unknown): string {
    return sqlstring.escape(value);
  }
}
