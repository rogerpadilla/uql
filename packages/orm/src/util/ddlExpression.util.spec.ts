import { describe, expect, it } from 'vitest';
import { indexNameParts, normalizeIndexColumn, renderIndexColumn } from './ddlExpression.util.js';
import { raw, refs } from './raw.js';

class Note {
  email?: string;
}

describe('normalizeIndexColumn', () => {
  it('should keep a column, named or read off the refs, as its key', () => {
    expect(normalizeIndexColumn('email')).toEqual({ column: 'email' });
    expect(normalizeIndexColumn(refs(Note).email)).toEqual({ column: 'email' });
  });

  it('should keep any other raw as the expression it is', () => {
    const sql = raw`lower(email)`;
    expect(normalizeIndexColumn(sql)).toEqual({ column: sql });
  });

  it("should resolve an options entry's column the same way, keeping its options", () => {
    const sql = raw`lower(email)`;
    expect(normalizeIndexColumn({ column: refs(Note).email, order: 'desc' })).toEqual({
      column: 'email',
      order: 'desc',
    });
    expect(normalizeIndexColumn({ column: sql, length: 64 })).toEqual({ column: sql, length: 64 });
  });
});

describe('renderIndexColumn', () => {
  it('should render an expression entry to text, keeping its options', () => {
    expect(renderIndexColumn({ column: raw`lower(email)`, order: 'desc' }, () => 'lower(email)')).toEqual({
      column: 'lower(email)',
      order: 'desc',
      expression: true,
    });
  });

  it('should keep a column entry as it is', () => {
    expect(renderIndexColumn({ column: 'email' }, () => 'unused')).toEqual({ column: 'email' });
  });
});

describe('indexNameParts', () => {
  it('should name an expression by its position, having no column to name it by', () => {
    expect(indexNameParts([{ column: 'tenantId' }, { column: raw`lower(email)` }])).toEqual(['tenantId', 'expr1']);
  });
});
