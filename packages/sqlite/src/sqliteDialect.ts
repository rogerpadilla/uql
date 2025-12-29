import { AbstractSqlDialect } from 'nukak/dialect';
import { getMeta } from 'nukak/entity';
import type {
  FieldKey,
  QueryComparisonOptions,
  QueryConflictPaths,
  QueryContext,
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
      const fields = search.$fields.map((field) => this.escapeId(meta.fields[field]?.name ?? field));
      ctx.append(`${this.escapeId(meta.name)} MATCH {${fields.join(' ')}} : `);
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
