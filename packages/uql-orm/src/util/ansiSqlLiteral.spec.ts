import { describe, expect, it } from 'vitest';
import { escapeAnsiSqlLiteral } from './ansiSqlLiteral.js';

describe('escapeAnsiSqlLiteral', () => {
  it('doubles single quotes (Postgres/SQLite string literal rules)', () => {
    expect(escapeAnsiSqlLiteral("it's")).toBe("'it''s'");
    expect(escapeAnsiSqlLiteral("a'b'c")).toBe("'a''b''c'");
  });

  it('nullish and booleans', () => {
    expect(escapeAnsiSqlLiteral(null)).toBe('NULL');
    expect(escapeAnsiSqlLiteral(undefined)).toBe('NULL');
    expect(escapeAnsiSqlLiteral(true)).toBe('true');
    expect(escapeAnsiSqlLiteral(false)).toBe('false');
  });

  it('numbers and bigint', () => {
    expect(escapeAnsiSqlLiteral(0)).toBe('0');
    expect(escapeAnsiSqlLiteral(-3.5)).toBe('-3.5');
    expect(escapeAnsiSqlLiteral(Number.NaN)).toBe('NULL');
    expect(escapeAnsiSqlLiteral(Number.POSITIVE_INFINITY)).toBe('NULL');
    expect(escapeAnsiSqlLiteral(42n)).toBe('42');
  });

  it('dates (local timestamp literal)', () => {
    const d = new Date(2024, 0, 15, 12, 30, 45, 123);
    expect(escapeAnsiSqlLiteral(d)).toBe("'2024-01-15 12:30:45.123'");
  });

  it('invalid date becomes NULL', () => {
    expect(escapeAnsiSqlLiteral(new Date('invalid'))).toBe('NULL');
  });

  it('arrays as comma-separated literals', () => {
    expect(escapeAnsiSqlLiteral([1, "o'reilly"])).toBe("1, 'o''reilly'");
    expect(
      escapeAnsiSqlLiteral([
        [1, 2],
        [3, 4],
      ]),
    ).toBe('(1, 2), (3, 4)');
  });

  it('byte buffers as X-quoted hex', () => {
    expect(escapeAnsiSqlLiteral(Buffer.from([0x48, 0x69]))).toBe("X'4869'");
    expect(escapeAnsiSqlLiteral(new Uint8Array([0xff, 0]))).toBe("X'ff00'");
  });

  it('toSqlString raw hatch (caller must trust return value)', () => {
    expect(escapeAnsiSqlLiteral({ toSqlString: () => 'CURRENT_TIMESTAMP' })).toBe('CURRENT_TIMESTAMP');
  });

  it('rejects plain objects, functions, and symbols', () => {
    expect(() => escapeAnsiSqlLiteral({ a: 1 })).toThrow(/plain objects/);
    expect(() => escapeAnsiSqlLiteral(() => {})).toThrow(/function/);
    expect(() => escapeAnsiSqlLiteral(Symbol('x'))).toThrow(/symbol/);
  });
});

describe('escapeAnsiSqlLiteral — SQL injection hardening (string literals)', () => {
  const payloads = [
    `admin'--`,
    `' OR '1'='1`,
    `'; DROP TABLE users; --`,
    `1' UNION SELECT * FROM secrets--`,
    String.raw`\' OR 1=1--`,
    `name'; DELETE FROM t WHERE '1'='1`,
    `'\nOR\n1=1`,
    `％＇ＯＲ％＇１％＝％１`, // fullwidth — still a string; must stay inside quotes
    `\x00'\x00OR\x001=1`,
    `multi''quote'break`,
  ];

  it.each(payloads)('payload is fully wrapped as one literal: %s', (payload) => {
    const out = escapeAnsiSqlLiteral(payload);
    expect(out.startsWith("'")).toBe(true);
    expect(out.endsWith("'")).toBe(true);
    // No odd number of unescaped single-quote runs that would close the literal early:
    const inner = out.slice(1, -1);
    const parts = inner.split("''");
    for (const p of parts) {
      expect(p).not.toContain("'");
    }
  });

  it('concatenation with static SQL cannot inject OR 1=1 as syntax', () => {
    const user = `x' OR '1'='1`;
    const fragment = `WHERE name = ${escapeAnsiSqlLiteral(user)}`;
    expect(fragment).toBe(`WHERE name = 'x'' OR ''1''=''1'`);
    expect(fragment).not.toMatch(/=\s*'x'\s+OR/i);
  });
});
