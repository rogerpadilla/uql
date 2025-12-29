import sqlstring from 'sqlstring-sqlite';
import { AbstractSqlDialect } from '../dialect/index.js';
import { getMeta } from '../entity/index.js';
import type {
  FieldKey,
  NamingStrategy,
  QueryComparisonOptions,
  QueryConflictPaths,
  QueryContext,
  QueryTextSearchOptions,
  QueryWhereFieldOperatorMap,
  QueryWhereMap,
  Type,
} from '../type/index.js';

export class SqliteDialect extends AbstractSqlDialect {
  constructor(namingStrategy?: NamingStrategy) {
    super(namingStrategy, '`', 'BEGIN TRANSACTION');
  }

  override addValue(values: unknown[], value: unknown): string {
    if (value instanceof Date) {
      value = value.getTime();
    } else if (typeof value === 'boolean') {
      value = value ? 1 : 0;
    }
    return super.addValue(values, value);
  }

  override compare<E, K extends keyof QueryWhereMap<E>>(
    ctx: QueryContext,
    entity: Type<E>,
    key: K,
    val: QueryWhereMap<E>[K],
    opts?: QueryComparisonOptions,
  ): void {
    if (key === '$text') {
      const meta = getMeta(entity);
      const search = val as QueryTextSearchOptions<E>;
      const fields = search.$fields.map((fKey) => {
        const field = meta.fields[fKey];
        const columnName = this.resolveColumnName(fKey as string, field);
        return this.escapeId(columnName);
      });
      const tableName = this.resolveTableName(entity, meta);
      ctx.append(`${this.escapeId(tableName)} MATCH {${fields.join(' ')}} : `);
      ctx.addValue(search.$value);
      return;
    }
    super.compare(ctx, entity, key, val, opts);
  }

  override compareFieldOperator<E, K extends keyof QueryWhereFieldOperatorMap<E>>(
    ctx: QueryContext,
    entity: Type<E>,
    key: FieldKey<E>,
    op: K,
    val: QueryWhereFieldOperatorMap<E>[K],
    opts: QueryComparisonOptions = {},
  ): void {
    super.compareFieldOperator(ctx, entity, key, op, val, opts);
  }

  override upsert<E>(ctx: QueryContext, entity: Type<E>, conflictPaths: QueryConflictPaths<E>, payload: E): void {
    const meta = getMeta(entity);
    const update = this.getUpsertUpdateAssignments(ctx, meta, conflictPaths, payload, (name) => `EXCLUDED.${name}`);
    const keysStr = this.getUpsertConflictPathsStr(meta, conflictPaths);
    const onConflict = update ? `DO UPDATE SET ${update}` : 'DO NOTHING';
    this.insert(ctx, entity, payload);
    ctx.append(` ON CONFLICT (${keysStr}) ${onConflict}`);
  }

  override escape(value: unknown): string {
    return sqlstring.escape(value);
  }
}
