import { describe, expect, it } from 'vitest';
import { indexNameParts, normalizeIndexColumn, renderIndexColumn } from './ddlExpression.util.js';
import { raw } from './raw.js';

describe('normalizeIndexColumn', () => {
  it('resolves an expression entry to the SQL its callback returns', () => {
    const sql = raw`lower(email)`;
    expect(normalizeIndexColumn(() => sql)).toEqual({ column: sql });
  });

  it("resolves an options entry's expression, keeping its options", () => {
    const sql = raw`lower(email)`;
    expect(normalizeIndexColumn({ column: () => sql, order: 'desc' })).toEqual({ column: sql, order: 'desc' });
  });
});

describe('renderIndexColumn', () => {
  it('renders an expression entry to text, keeping its options', () => {
    expect(renderIndexColumn({ column: raw`lower(email)`, order: 'desc' }, () => 'lower(email)')).toEqual({
      column: 'lower(email)',
      order: 'desc',
      expression: true,
    });
  });

  it('keeps a column entry as it is', () => {
    expect(renderIndexColumn({ column: 'email' }, () => 'unused')).toEqual({ column: 'email' });
  });
});

describe('indexNameParts', () => {
  it('names an expression by its position, having no column to name it by', () => {
    expect(indexNameParts([{ column: 'tenantId' }, { column: raw`lower(email)` }])).toEqual(['tenantId', 'expr1']);
  });
});
