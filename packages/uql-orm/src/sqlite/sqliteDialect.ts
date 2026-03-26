import sqlstring from 'sqlstring-sqlite';
import { AbstractSqlDialect } from '../dialect/index.js';
import { buildElemMatchConditions } from '../dialect/jsonArrayElemMatchUtils.js';
import { getMeta } from '../entity/index.js';
import type {
  FieldKey,
  JsonUpdateOp,
  NamingStrategy,
  QueryComparisonOptions,
  QueryConflictPaths,
  QueryContext,
  QuerySizeComparisonOps,
  QueryTextSearchOptions,
  QueryWhereFieldOperatorMap,
  Type,
  VectorDistance,
} from '../type/index.js';
import { hasKeys } from '../util/index.js';

export class SqliteDialect extends AbstractSqlDialect {
  protected override readonly vectorDistanceFns: Partial<Record<VectorDistance, string>> = {
    cosine: 'vec_distance_cosine',
    l2: 'vec_distance_L2',
    hamming: 'vec_distance_hamming',
  };

  constructor(namingStrategy?: NamingStrategy) {
    super('sqlite', namingStrategy);
  }

  protected override ilikeExpr(f: string, ph: string): string {
    return `${f} LIKE ${ph}`;
  }

  protected override get neOp(): string {
    return 'IS NOT';
  }

  override normalizeValue(value: unknown): unknown {
    if (value instanceof Date) return value.getTime();
    return super.normalizeValue(value);
  }

  override compare<E>(
    ctx: QueryContext,
    entity: Type<E>,
    key: string,
    val: unknown,
    opts?: QueryComparisonOptions,
  ): void {
    if (key === '$text') {
      const meta = getMeta(entity);
      const search = val as QueryTextSearchOptions<E>;
      const fields = search.$fields!.map((fKey) => {
        const field = meta.fields[fKey];
        const columnName = this.resolveColumnName(fKey, field!);
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
            return `EXISTS (SELECT 1 FROM json_each(${this.escapeId(key)}) WHERE value = json(?))`;
          })
          .join(' AND ');
        ctx.append(`(${conditions})`);
        break;
      }
      case '$size':
        // SQLite: Check JSON array length
        // e.g., json_array_length(roles) = 3, or json_array_length(roles) >= 2
        this.buildSizeComparison(
          ctx,
          () => {
            ctx.append('json_array_length(');
            this.getComparisonKey(ctx, entity, key, opts);
            ctx.append(')');
          },
          val as number | QuerySizeComparisonOps,
        );
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

    const conditions = buildElemMatchConditions(
      match,
      (field, op, opVal) =>
        this.buildJsonFieldCondition(ctx, (f) => `json_extract(value, '$.${this.escapeJsonKey(f)}')`, field, op, opVal),
      (field, value) => {
        // Keep SQLite's placeholder behavior consistent with prior implementation.
        ctx.pushValue(value);
        return `json_extract(value, '$.${this.escapeJsonKey(field)}') = ?`;
      },
    );

    ctx.append(conditions.join(' AND '));
    ctx.append(')');
  }

  protected override getJsonPathScalarExpr(escapedColumn: string, jsonPath: string): string {
    return `json_extract(${escapedColumn}, '$.${this.escapeJsonKey(jsonPath)}')`;
  }

  protected override numericCast(expr: string): string {
    return `CAST(${expr} AS REAL)`;
  }

  override upsert<E>(ctx: QueryContext, entity: Type<E>, conflictPaths: QueryConflictPaths<E>, payload: E | E[]): void {
    this.onConflictUpsert(ctx, entity, conflictPaths, payload, this.insert.bind(this));
  }

  protected override formatJsonUpdate<E>(ctx: QueryContext, escapedCol: string, value: JsonUpdateOp<E>): void {
    let expr = escapedCol;
    if (hasKeys(value.$merge)) {
      const merge = value.$merge as Record<string, unknown>;
      expr = `json_set(COALESCE(${escapedCol}, '{}')`;
      for (const [key, v] of Object.entries(merge)) {
        expr += `, '$.${this.escapeJsonKey(key)}', json(?)`;
        ctx.pushValue(JSON.stringify(v));
      }
      expr += ')';
    }
    if (hasKeys(value.$push)) {
      const push = value.$push as Record<string, unknown>;
      expr = `json_insert(${expr}`;
      for (const [key, v] of Object.entries(push)) {
        expr += `, '$.${this.escapeJsonKey(key)}[#]', json(?)`;
        ctx.pushValue(JSON.stringify(v));
      }
      expr += ')';
    }
    if (value.$unset?.length) {
      const paths = value.$unset.map((k) => `'$.${this.escapeJsonKey(k)}'`).join(', ');
      expr = `json_remove(${expr}, ${paths})`;
    }
    ctx.append(`${escapedCol} = ${expr}`);
  }

  override escape(value: unknown): string {
    return sqlstring.escape(value);
  }
}
