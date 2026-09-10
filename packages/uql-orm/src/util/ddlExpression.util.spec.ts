import { describe, expect, it } from 'vitest';
import { normalizeIndexColumn } from './ddlExpression.util.js';
import { raw } from './raw.js';

describe('normalizeIndexColumn', () => {
  it('reads an options entry whose column is an expression as that expression, keeping its options', () => {
    expect(normalizeIndexColumn({ column: raw`lower(email)`, order: 'desc' })).toEqual({
      order: 'desc',
      column: 'lower(email)',
      expression: true,
    });
  });
});
