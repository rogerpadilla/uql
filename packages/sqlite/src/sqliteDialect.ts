import { AbstractSqlDialect } from 'nukak/dialect';
import { getMeta } from 'nukak/entity';
import type {
  FieldKey,
  QueryComparisonOptions,
  QueryConflictPaths,
  QueryTextSearchOptions,
  QueryWhereFieldOperatorMap,
  QueryWhereMap,
  Type,
} from 'nukak/type';
import sqlstring from 'sqlstring-sqlite';

export class SqliteDialect extends AbstractSqlDialect {
  constructor() {
    super('`', 'BEGIN TRANSACTION');
  }

  override addValue(values: unknown[], value: unknown, include = true): string {
    if (value instanceof Date) {
      value = value.getTime();
    } else if (typeof value === 'boolean') {
      value = value ? 1 : 0;
    }
    return super.addValue(values, value, include);
  }

  override compare<E, K extends keyof QueryWhereMap<E>>(
    entity: Type<E>,
    key: K,
    val: QueryWhereMap<E>[K],
    opts?: QueryComparisonOptions,
    values?: unknown[],
  ): string {
    if (key === '$text') {
      const meta = getMeta(entity);
      const search = val as QueryTextSearchOptions<E>;
      const fields = search.$fields.map((field) => this.escapeId(meta.fields[field]?.name ?? field));
      return `${this.escapeId(meta.name)} MATCH {${fields.join(' ')}} : ${this.addValue(values, search.$value)}`;
    }
    return super.compare(entity, key, val, opts, values);
  }

  override compareFieldOperator<E, K extends keyof QueryWhereFieldOperatorMap<E>>(
    entity: Type<E>,
    key: FieldKey<E>,
    op: K,
    val: QueryWhereFieldOperatorMap<E>[K],
    opts: QueryComparisonOptions = {},
    values?: unknown[],
  ): string {
    const comparisonKey = this.getComparisonKey(entity, key, opts, values);
    switch (op) {
      case '$in':
        if (Array.isArray(val) && val.length > 0) {
          return `${String(comparisonKey)} IN (${val.map((v) => this.addValue(values, v)).join(', ')})`;
        }
        return `${String(comparisonKey)} IN (NULL)`;
      case '$nin':
        if (Array.isArray(val) && val.length > 0) {
          return `${String(comparisonKey)} NOT IN (${val.map((v) => this.addValue(values, v)).join(', ')})`;
        }
        return `${String(comparisonKey)} NOT IN (NULL)`;
      default:
        return super.compareFieldOperator(entity, key, op, val, opts, values);
    }
  }

  override upsert<E>(entity: Type<E>, conflictPaths: QueryConflictPaths<E>, payload: E, values?: unknown[]): string {
    const insert = super.insert(entity, payload, undefined, values);
    const meta = getMeta(entity);
    const update = this.getUpsertUpdateAssignments(meta, conflictPaths, payload, (name) => `EXCLUDED.${name}`, values);
    const keysStr = this.getUpsertConflictPathsStr(meta, conflictPaths);
    const onConflict = update ? `DO UPDATE SET ${update}` : 'DO NOTHING';
    return `${insert} ON CONFLICT (${keysStr}) ${onConflict}`;
  }

  override escape(value: unknown): string {
    return sqlstring.escape(value);
  }
}
