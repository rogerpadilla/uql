import { describe, expect, it } from 'vitest';
import { generatedExpression } from './sqliteIntrospector.js';

/**
 * SQLite reports no generated column's expression, so it is read out of the `CREATE TABLE` it kept
 * verbatim - whichever of the forms it accepts the author wrote.
 */
describe('generatedExpression', () => {
  const ddl =
    'CREATE TABLE "t" (\n' +
    '  "id" INTEGER PRIMARY KEY,\n' +
    '  qty INTEGER NOT NULL,\n' +
    '  price DECIMAL(10, 2),\n' +
    '  "total" DECIMAL(10, 2) GENERATED ALWAYS AS ((qty * price) - 1) STORED,\n' +
    "  [label] TEXT AS ('a, b') STORED,\n" +
    '  CHECK (qty > 0)\n' +
    ')';

  it('should read the expression of a column declared GENERATED ALWAYS', () => {
    expect(generatedExpression(ddl, 'total')).toBe('(qty * price) - 1');
  });

  it('should read the short form, and keep a string holding a comma whole', () => {
    expect(generatedExpression(ddl, 'label')).toBe("'a, b'");
  });

  it('should skip a column whose type carries a comma', () => {
    expect(generatedExpression(ddl, 'price')).toBe(undefined);
  });

  it('should report nothing for a plain column', () => {
    expect(generatedExpression(ddl, 'qty')).toBe(undefined);
  });

  it('should report nothing for a column the statement does not declare', () => {
    expect(generatedExpression(ddl, 'missing')).toBe(undefined);
  });
});
