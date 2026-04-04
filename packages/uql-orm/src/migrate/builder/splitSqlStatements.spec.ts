import { describe, expect, it } from 'vitest';
import { splitSqlStatementsOnSemicolons } from './splitSqlStatements.js';

describe('splitSqlStatementsOnSemicolons', () => {
  it('trims and drops empty segments', () => {
    expect(splitSqlStatementsOnSemicolons('  SELECT 1; SELECT 2  ;')).toEqual(['SELECT 1', 'SELECT 2']);
  });

  it('returns single statement without trailing semicolon', () => {
    expect(splitSqlStatementsOnSemicolons('ALTER TABLE t ADD c INT')).toEqual(['ALTER TABLE t ADD c INT']);
  });
});
