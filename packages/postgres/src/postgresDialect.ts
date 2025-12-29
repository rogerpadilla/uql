import { AbstractSqlDialect } from 'nukak/dialect';
import { getMeta } from 'nukak/entity';
import {
  type FieldKey,
  type FieldOptions,
  type QueryComparisonOptions,
  type QueryConflictPaths,
  type QueryContext,
  type QueryOptions,
  QueryRaw,
  type QueryTextSearchOptions,
  type QueryWhereFieldOperatorMap,
  type QueryWhereMap,
  type Type,
} from 'nukak/type';
import sqlstring from 'sqlstring-sqlite';

export class PostgresDialect extends AbstractSqlDialect {
  constructor() {
    super('"', 'BEGIN TRANSACTION');
  }

  override addValue(values: unknown[], value: unknown): string {
    values.push(value);
    return `$${values.length}`;
  }

  override insert<E>(ctx: QueryContext, entity: Type<E>, payload: E | E[], opts?: QueryOptions): void {
    super.insert(ctx, entity, payload, opts);
    ctx.append(' ' + this.returningId(entity));
  }

  override upsert<E>(ctx: QueryContext, entity: Type<E>, conflictPaths: QueryConflictPaths<E>, payload: E): void {
    const meta = getMeta(entity);
    const update = this.getUpsertUpdateAssignments(ctx, meta, conflictPaths, payload, (name) => `EXCLUDED.${name}`);
    const keysStr = this.getUpsertConflictPathsStr(meta, conflictPaths);
    const onConflict = update ? `DO UPDATE SET ${update}` : 'DO NOTHING';
    super.insert(ctx, entity, payload);
    ctx.append(` ON CONFLICT (${keysStr}) ${onConflict} ${this.returningId(entity)}`);
  }

  override compare<E, K extends keyof QueryWhereMap<E>>(
    ctx: QueryContext,
    entity: Type<E>,
    key: K,
    val: QueryWhereMap<E>[K],
    opts: QueryComparisonOptions = {},
  ): void {
    if (key === '$text') {
      const meta = getMeta(entity);
      const search = val as QueryTextSearchOptions<E>;
      const fields = search.$fields
        .map((field) => this.escapeId(meta.fields[field]?.name ?? field))
        .join(` || ' ' || `);
      ctx.append(`to_tsvector(${fields}) @@ to_tsquery(`);
      ctx.addValue(search.$value);
      ctx.append(')');
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
    opts: QueryOptions = {},
  ): void {
    switch (op) {
      case '$istartsWith':
        this.getComparisonKey(ctx, entity, key, opts);
        ctx.append(' ILIKE ');
        ctx.addValue(`${val}%`);
        break;
      case '$iendsWith':
        this.getComparisonKey(ctx, entity, key, opts);
        ctx.append(' ILIKE ');
        ctx.addValue(`%${val}`);
        break;
      case '$iincludes':
        this.getComparisonKey(ctx, entity, key, opts);
        ctx.append(' ILIKE ');
        ctx.addValue(`%${val}%`);
        break;
      case '$ilike':
        this.getComparisonKey(ctx, entity, key, opts);
        ctx.append(' ILIKE ');
        ctx.addValue(val);
        break;
      case '$in':
        this.getComparisonKey(ctx, entity, key, opts);
        ctx.append(' = ANY(');
        ctx.addValue(val);
        ctx.append(')');
        break;
      case '$nin':
        this.getComparisonKey(ctx, entity, key, opts);
        ctx.append(' <> ALL(');
        ctx.addValue(val);
        ctx.append(')');
        break;
      case '$regex':
        this.getComparisonKey(ctx, entity, key, opts);
        ctx.append(' ~ ');
        ctx.addValue(val);
        break;
      default:
        super.compareFieldOperator(ctx, entity, key, op, val, opts);
    }
  }

  protected override formatPersistableValue<E>(ctx: QueryContext, field: FieldOptions, value: unknown): void {
    if (value instanceof QueryRaw) {
      super.formatPersistableValue(ctx, field, value);
      return;
    }
    if (field.type === 'json' || field.type === 'jsonb') {
      ctx.addValue(value ? JSON.stringify(value) : null);
      ctx.append(`::${field.type}`);
      return;
    }
    if (field.type === 'vector' && Array.isArray(value)) {
      ctx.addValue(`[${value.join(',')}]`);
      ctx.append('::vector');
      return;
    }
    super.formatPersistableValue(ctx, field, value);
  }

  override escape(value: unknown): string {
    return sqlstring.escape(value);
  }
}
