import { describe, expect, it } from 'vitest';
import { expr, SqlExpression } from './expressions.js';

describe('expr', () => {
  it('should build a symbolic token naming the kind', () => {
    expect(expr.now().kind).toBe('now');
    expect(expr.currentDate().kind).toBe('currentDate');
    expect(expr.currentTime().kind).toBe('currentTime');
    expect(expr.uuid().kind).toBe('uuid');
    expect(expr.uuidv7().kind).toBe('uuidv7');
    expect(expr.onUpdateNow().kind).toBe('onUpdateNow');
  });

  /** A symbolic token carries no SQL of its own; the dialect supplies it. */
  it('should leave sql unset on every kind but raw', () => {
    const { raw: _raw, ...symbolic } = expr;
    expect(Object.values(symbolic).filter((build) => build().sql !== undefined)).toEqual([]);
  });

  it('should carry its text verbatim for raw', () => {
    const expression = expr.raw('CUSTOM_FUNCTION()');
    expect(expression.kind).toBe('raw');
    expect(expression.sql).toBe('CUSTOM_FUNCTION()');
  });

  it('should detect expressions', () => {
    expect(SqlExpression.isExpression(expr.now())).toBe(true);
    expect(SqlExpression.isExpression('CURRENT_TIMESTAMP')).toBe(false);
    expect(SqlExpression.isExpression(123)).toBe(false);
  });
});
