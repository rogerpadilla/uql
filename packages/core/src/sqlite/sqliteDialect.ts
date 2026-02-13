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
    super('sqlite', namingStrategy);
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
    switch (op) {
      case '$elemMatch':
        this.buildElemMatchCondition(ctx, entity, key, val as Record<string, unknown>, opts);
        break;
      case '$all': {
        // SQLite: Check JSON array contains all values using multiple json_each subqueries
        const values = val as unknown[];
        const conditions = values
          .map((v) => {
            ctx.pushValue(JSON.stringify(v));
            return `EXISTS (SELECT 1 FROM json_each(${this.escapeId(key as string)}) WHERE value = json(?))`;
          })
          .join(' AND ');
        ctx.append(`(${conditions})`);
        break;
      }
      case '$size':
        // SQLite: Check JSON array length
        // e.g., json_array_length(roles) = 3
        ctx.append('json_array_length(');
        this.getComparisonKey(ctx, entity, key, opts);
        ctx.append(') = ');
        ctx.addValue(val);
        break;
      default:
        super.compareFieldOperator(ctx, entity, key, op, val, opts);
    }
  }

  /**
   * Build $elemMatch condition for SQLite JSON arrays.
   * Uses EXISTS with json_each and supports nested operators.
   */
  private buildElemMatchCondition<E>(
    ctx: QueryContext,
    _entity: Type<E>,
    key: FieldKey<E>,
    match: Record<string, unknown>,
    opts: QueryComparisonOptions,
  ): void {
    ctx.append('EXISTS (SELECT 1 FROM json_each(');
    this.getComparisonKey(ctx, _entity, key, opts);
    ctx.append(') WHERE ');

    const conditions: string[] = [];
    for (const [field, value] of Object.entries(match)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        // Value is an operator object
        const ops = value as Record<string, unknown>;
        for (const [op, opVal] of Object.entries(ops)) {
          conditions.push(this.buildJsonFieldOperator(ctx, field, op, opVal));
        }
      } else {
        // Simple equality
        ctx.pushValue(value);
        conditions.push(`json_extract(value, '$.${field}') = ?`);
      }
    }

    ctx.append(conditions.join(' AND '));
    ctx.append(')');
  }

  /**
   * Build a comparison condition for a JSON field with an operator.
   */
  private buildJsonFieldOperator(ctx: QueryContext, field: string, op: string, value: unknown): string {
    return this.buildJsonFieldCondition(
      ctx,
      {
        fieldAccessor: (f) => `json_extract(value, '$.${f}')`,
        numericCast: (expr) => `CAST(${expr} AS REAL)`,
        likeFn: 'LIKE',
        ilikeExpr: (f, ph) => `LOWER(${f}) LIKE ${ph}`,
        regexpOp: 'REGEXP',
        addValue: (c, v) => {
          c.pushValue(v);
          return '?';
        },
      },
      field,
      op,
      value,
    );
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
