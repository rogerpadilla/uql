import SqlString from 'sqlstring';
import { AbstractSqlDialect } from '../dialect/index.js';
import type {
  FieldKey,
  NamingStrategy,
  QueryContext,
  QueryOptions,
  QueryWhereFieldOperatorMap,
  Type,
} from '../type/index.js';

export class MySqlDialect extends AbstractSqlDialect {
  constructor(namingStrategy?: NamingStrategy) {
    super('mysql', namingStrategy);
  }
  override addValue(values: unknown[], value: unknown): string {
    if (value instanceof Date) {
      values.push(value);
      return '?';
    }
    return super.addValue(values, value);
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
      case '$elemMatch':
        this.buildElemMatchCondition(ctx, entity, key, val as Record<string, unknown>, opts);
        break;
      case '$all':
        // MySQL: JSON array contains all specified values
        // e.g., JSON_CONTAINS(tags, '["typescript", "orm"]')
        ctx.append('JSON_CONTAINS(');
        this.getComparisonKey(ctx, entity, key, opts);
        ctx.append(', ');
        ctx.addValue(JSON.stringify(val));
        ctx.append(')');
        break;
      case '$size':
        // MySQL: Check JSON array length
        // e.g., JSON_LENGTH(roles) = 3
        ctx.append('JSON_LENGTH(');
        this.getComparisonKey(ctx, entity, key, opts);
        ctx.append(') = ');
        ctx.addValue(val);
        break;
      default:
        super.compareFieldOperator(ctx, entity, key, op, val, opts);
    }
  }

  /**
   * Build $elemMatch condition for MySQL JSON arrays.
   * - Simple objects (no operators): Use fast JSON_CONTAINS
   * - Objects with operators: Use EXISTS with JSON_TABLE
   */
  private buildElemMatchCondition<E>(
    ctx: QueryContext,
    entity: Type<E>,
    key: FieldKey<E>,
    match: Record<string, unknown>,
    opts: QueryOptions,
  ): void {
    // Check if any field value contains operators
    const hasOperators = Object.values(match).some(
      (v) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).some((k) => k.startsWith('$')),
    );

    if (!hasOperators) {
      // Simple case: use fast JSON_CONTAINS
      ctx.append('JSON_CONTAINS(');
      this.getComparisonKey(ctx, entity, key, opts);
      ctx.append(', ');
      ctx.addValue(JSON.stringify([match]));
      ctx.append(')');
      return;
    }

    // Complex case: use EXISTS with JSON_TABLE
    // e.g., EXISTS (SELECT 1 FROM JSON_TABLE(addresses, '$[*]' COLUMNS (city VARCHAR(255) PATH '$.city')) AS jt WHERE jt.city LIKE ?)
    const fields = Object.keys(match);
    const columns = fields.map((f) => `${f} TEXT PATH '$.${f}'`).join(', ');

    ctx.append('EXISTS (SELECT 1 FROM JSON_TABLE(');
    this.getComparisonKey(ctx, entity, key, opts);
    ctx.append(`, '$[*]' COLUMNS (${columns})) AS jt WHERE `);

    const conditions: string[] = [];
    for (const [field, value] of Object.entries(match)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const ops = value as Record<string, unknown>;
        for (const [op, opVal] of Object.entries(ops)) {
          conditions.push(this.buildJsonFieldOperator(ctx, field, op, opVal));
        }
      } else {
        conditions.push(`jt.${field} = ${this.addValue(ctx.values, value)}`);
      }
    }

    ctx.append(conditions.join(' AND '));
    ctx.append(')');
  }

  /**
   * Build a comparison condition for a JSON_TABLE field with an operator.
   */
  private buildJsonFieldOperator(ctx: QueryContext, field: string, op: string, value: unknown): string {
    return this.buildJsonFieldCondition(
      ctx,
      {
        fieldAccessor: (f) => `jt.${f}`,
        numericCast: (expr) => `CAST(${expr} AS DECIMAL)`,
        likeFn: 'LIKE',
        // MySQL LIKE is case-insensitive by default with utf8 collation
        ilikeExpr: (f, ph) => `${f} LIKE ${ph}`,
        regexpOp: 'REGEXP',
        addValue: (c, v) => this.addValue(c.values, v),
      },
      field,
      op,
      value,
    );
  }

  override escape(value: unknown): string {
    return SqlString.escape(value);
  }
}
