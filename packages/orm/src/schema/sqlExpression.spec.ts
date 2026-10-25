import { describe, expect, it } from 'vitest';
import { SqlExpression, sqlExpressionText } from './sqlExpression.js';

describe('SqlExpression', () => {
  it('should tell an expression from a plain object with the same fields, which JSON cannot tell apart', () => {
    expect(SqlExpression.isExpression(SqlExpression.named('uuid'))).toBe(true);
    expect(SqlExpression.isExpression({ kind: 'uuid' })).toBe(false);
    expect(SqlExpression.isExpression(JSON.parse('{"kind":"sql","sql":"now()"}'))).toBe(false);
    expect(SqlExpression.isExpression(null)).toBe(false);
    expect(SqlExpression.isExpression('uuid')).toBe(false);
  });

  it('should show a raw expression as its SQL, and a named one as its kind', () => {
    expect(sqlExpressionText(SqlExpression.raw('(now())'))).toBe('(now())');
    expect(sqlExpressionText(SqlExpression.named('currentDate'))).toBe('currentDate');
  });
});
