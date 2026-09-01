import { describe, expect, it } from 'vitest';
import { expr, formatDefaultValue, SqlExpression } from './expressions.js';

describe('SqlExpression', () => {
  it('should create an expression with SQL string', () => {
    const timestamp = new SqlExpression('CURRENT_TIMESTAMP');
    expect(timestamp.sql).toBe('CURRENT_TIMESTAMP');
    expect(timestamp.toString()).toBe('CURRENT_TIMESTAMP');
  });

  it('should detect expressions', () => {
    expect(SqlExpression.isExpression(new SqlExpression('NOW()'))).toBe(true);
    expect(SqlExpression.isExpression('string')).toBe(false);
    expect(SqlExpression.isExpression(123)).toBe(false);
  });
});

describe('expr helper', () => {
  it('should create now() expression', () => {
    expect(expr.now().sql).toBe('CURRENT_TIMESTAMP');
  });

  it('should create currentDate() expression', () => {
    expect(expr.currentDate().sql).toBe('CURRENT_DATE');
  });

  it('should create currentTime() expression', () => {
    expect(expr.currentTime().sql).toBe('CURRENT_TIME');
  });

  it('should create uuid() expression for postgres', () => {
    expect(expr.uuid().sql).toBe('gen_random_uuid()');
  });

  it('should create mysqlUuid() expression', () => {
    expect(expr.mysqlUuid().sql).toBe('UUID()');
  });

  it('should create raw() expression', () => {
    expect(expr.raw('CUSTOM_FUNCTION()').sql).toBe('CUSTOM_FUNCTION()');
  });

  it('should create emptyObject() expression', () => {
    expect(expr.emptyObject().sql).toBe("'{}'::jsonb");
  });

  it('should create emptyArray() expression', () => {
    expect(expr.emptyArray().sql).toBe("'[]'::jsonb");
  });

  it('should create onUpdateNow() expression for MySQL', () => {
    expect(expr.onUpdateNow().sql).toBe('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
  });

  /** The namespace holds only what `defaultValue` cannot express as a literal. `raw()` is exempt, being the escape hatch. */
  it('should build nothing formatDefaultValue already produces from a plain value', () => {
    const { raw: _raw, ...nullary } = expr;
    const built = Object.values(nullary).map((build) => build().sql);

    expect(built.filter((sql) => ['NULL', 'TRUE', 'FALSE'].includes(sql))).toEqual([]);
    expect(built.filter((sql) => /^'[^']*'$/.test(sql))).toEqual([]);
    expect(built.filter((sql) => /^-?\d+(\.\d+)?$/.test(sql))).toEqual([]);
  });
});

describe('formatDefaultValue', () => {
  it('should format undefined as NULL', () => {
    expect(formatDefaultValue(undefined)).toBe('NULL');
  });

  it('should format null as NULL', () => {
    expect(formatDefaultValue(null)).toBe('NULL');
  });

  it('should format SqlExpression', () => {
    expect(formatDefaultValue(expr.now())).toBe('CURRENT_TIMESTAMP');
  });

  it('should format string with escaped quotes', () => {
    expect(formatDefaultValue('hello')).toBe("'hello'");
    expect(formatDefaultValue("it's")).toBe("'it''s'");
  });

  it('should format number', () => {
    expect(formatDefaultValue(42)).toBe('42');
    expect(formatDefaultValue(3.14)).toBe('3.14');
  });

  it('should format boolean', () => {
    expect(formatDefaultValue(true)).toBe('TRUE');
    expect(formatDefaultValue(false)).toBe('FALSE');
  });

  it('should format Date', () => {
    const date = new Date('2024-01-15T10:30:00Z');
    expect(formatDefaultValue(date)).toBe("'2024-01-15T10:30:00.000Z'");
  });

  it('should format object as JSON', () => {
    expect(formatDefaultValue({ key: 'value' })).toBe('\'{"key":"value"}\'');
  });

  it('should format array as JSON', () => {
    expect(formatDefaultValue([1, 2, 3])).toBe("'[1,2,3]'");
  });
});
