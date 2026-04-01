import SqlString from 'sqlstring';
import type { QueryContext, QuerySizeComparisonOps } from '../type/index.js';
import { AbstractSqlDialect } from './abstractSqlDialect.js';
import { buildElemMatchConditions } from './jsonArrayElemMatchUtils.js';

/**
 * Shared JSON-array / JSON-object operator implementation between MySQL and MariaDB.
 *
 * Both dialects support the MySQL-compatible JSON functions/operators used by:
 * - `$size` (JSON_LENGTH)
 * - `$all` (JSON_CONTAINS)
 * - `$elemMatch` (JSON_TABLE, or fast JSON_CONTAINS for the simple case)
 */
export abstract class MysqlLikeSqlDialect extends AbstractSqlDialect {
  override escape(value: unknown): string {
    return SqlString.escape(value);
  }

  protected override numericCast(expr: string): string {
    return `CAST(${expr} AS DECIMAL)`;
  }

  protected override ilikeExpr(f: string, ph: string): string {
    return `${f} LIKE ${ph}`;
  }

  protected override neExpr(field: string, ph: string): string {
    // MySQL/MariaDB null-safe inequality: true when values differ or one side is NULL.
    return `NOT (${field} <=> ${ph})`;
  }

  protected override jsonAll(ctx: QueryContext, jsonField: string, value: unknown): string {
    return `JSON_CONTAINS(${jsonField}, ${this.addValue(ctx.values, JSON.stringify(value))})`;
  }

  protected override jsonSize(ctx: QueryContext, jsonField: string, value: number | QuerySizeComparisonOps): string {
    const tmpCtx = this.createContext();
    this.buildSizeComparison(tmpCtx, () => tmpCtx.append(`JSON_LENGTH(${jsonField})`), value);
    ctx.pushValue(...tmpCtx.values);
    return tmpCtx.sql;
  }

  protected override jsonElemMatch(ctx: QueryContext, jsonField: string, match: Record<string, unknown>): string {
    const isPrimitiveElement = Object.keys(match).some((k) => k.startsWith('$'));

    if (isPrimitiveElement) {
      const ops = Object.entries(match);
      const conditions = ops.map(([op, opVal]) =>
        this.buildJsonFieldCondition(ctx, () => 'jt.elem_text', '', op, opVal),
      );
      return `EXISTS (SELECT 1 FROM JSON_TABLE(${jsonField}, '$[*]' COLUMNS (elem_text TEXT PATH '$')) AS jt WHERE ${conditions.join(
        ' AND ',
      )})`;
    }

    const hasOperators = Object.values(match).some(
      (v) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).some((k) => k.startsWith('$')),
    );

    if (!hasOperators) {
      return `JSON_CONTAINS(${jsonField}, ${this.addValue(ctx.values, JSON.stringify([match]))})`;
    }

    const fields = Object.keys(match);
    const columns = fields.map((f) => `${this.escapeId(f, true)} TEXT PATH '$.${this.escapeJsonKey(f)}'`).join(', ');

    const conditions = buildElemMatchConditions(
      match,
      (field, op, opVal) => this.buildJsonFieldCondition(ctx, (f) => `jt.${this.escapeId(f, true)}`, field, op, opVal),
      (field, val) => `jt.${this.escapeId(field, true)} = ${this.addValue(ctx.values, val)}`,
    );

    return `EXISTS (SELECT 1 FROM JSON_TABLE(${jsonField}, '$[*]' COLUMNS (${columns})) AS jt WHERE ${conditions.join(
      ' AND ',
    )})`;
  }
}
