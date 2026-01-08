import { describe, expect, it } from 'vitest';
import { formatDefaultValue, SqlExpression, t } from './expressions.js';

describe('SqlExpression', () => {
  it('should create an expression with SQL string', () => {
    const expr = new SqlExpression('CURRENT_TIMESTAMP');
    expect(expr.sql).toBe('CURRENT_TIMESTAMP');
    expect(expr.toString()).toBe('CURRENT_TIMESTAMP');
  });

  it('should detect expressions', () => {
    const expr = new SqlExpression('NOW()');
    expect(SqlExpression.isExpression(expr)).toBe(true);
    expect(SqlExpression.isExpression('string')).toBe(false);
    expect(SqlExpression.isExpression(123)).toBe(false);
  });
});

describe('t helper', () => {
  it('should create now() expression', () => {
    const expr = t.now();
    expect(expr.sql).toBe('CURRENT_TIMESTAMP');
  });

  it('should create currentDate() expression', () => {
    const expr = t.currentDate();
    expect(expr.sql).toBe('CURRENT_DATE');
  });

  it('should create currentTime() expression', () => {
    const expr = t.currentTime();
    expect(expr.sql).toBe('CURRENT_TIME');
  });

  it('should create null() expression', () => {
    const expr = t.null();
    expect(expr.sql).toBe('NULL');
  });

  it('should create true() expression', () => {
    const expr = t.true();
    expect(expr.sql).toBe('TRUE');
  });

  it('should create false() expression', () => {
    const expr = t.false();
    expect(expr.sql).toBe('FALSE');
  });

  it('should create uuid() expression for postgres', () => {
    const expr = t.uuid();
    expect(expr.sql).toBe('gen_random_uuid()');
  });

  it('should create mysqlUuid() expression', () => {
    const expr = t.mysqlUuid();
    expect(expr.sql).toBe('UUID()');
  });

  it('should create raw() expression', () => {
    const expr = t.raw('CUSTOM_FUNCTION()');
    expect(expr.sql).toBe('CUSTOM_FUNCTION()');
  });

  it('should create literal() with escaped quotes', () => {
    const expr = t.literal("O'Brien");
    expect(expr.sql).toBe("'O''Brien'");
  });

  it('should create number() expression', () => {
    const expr = t.number(42);
    expect(expr.sql).toBe('42');
  });

  it('should create emptyObject() expression', () => {
    const expr = t.emptyObject();
    expect(expr.sql).toBe("'{}'::jsonb");
  });

  it('should create emptyArray() expression', () => {
    const expr = t.emptyArray();
    expect(expr.sql).toBe("'[]'::jsonb");
  });

  it('should create onUpdateNow() expression for MySQL', () => {
    const expr = t.onUpdateNow();
    expect(expr.sql).toBe('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
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
    const expr = t.now();
    expect(formatDefaultValue(expr)).toBe('CURRENT_TIMESTAMP');
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
