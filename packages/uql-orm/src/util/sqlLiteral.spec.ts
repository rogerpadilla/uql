import { describe, expect, it } from 'vitest';
import { escapeAnsiSqlLiteral, escapeMysqlSqlLiteral } from './sqlLiteral.js';

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
    expect(escapeAnsiSqlLiteral(Buffer.alloc(0))).toBe("X''");
  });

  // Dropping either offset arg from `Buffer.from(bytes.buffer, byteOffset, byteLength)` would encode
  // the whole backing ArrayBuffer instead of this view.
  it('encodes only the bytes a subarray view covers', () => {
    expect(escapeAnsiSqlLiteral(new Uint8Array([1, 2, 3, 4, 5]).subarray(1, 4))).toBe("X'020304'");
    expect(escapeAnsiSqlLiteral(Buffer.from([9, 8, 7, 6]).subarray(2))).toBe("X'0706'");
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

// Verified byte-for-byte against the `sqlstring` package this replaced.
describe('escapeMysqlSqlLiteral', () => {
  it('backslash-escapes single quotes (MySQL/MariaDB string literal rules)', () => {
    expect(escapeMysqlSqlLiteral("it's")).toBe(String.raw`'it\'s'`);
    expect(escapeMysqlSqlLiteral('say "hi"')).toBe(String.raw`'say \"hi\"'`);
    expect(escapeMysqlSqlLiteral(String.raw`a\b`)).toBe(String.raw`'a\\b'`);
  });

  it('escapes the MySQL control characters', () => {
    expect(escapeMysqlSqlLiteral('\0')).toBe(String.raw`'\0'`);
    expect(escapeMysqlSqlLiteral('\b')).toBe(String.raw`'\b'`);
    expect(escapeMysqlSqlLiteral('\t')).toBe(String.raw`'\t'`);
    expect(escapeMysqlSqlLiteral('\n')).toBe(String.raw`'\n'`);
    expect(escapeMysqlSqlLiteral('\r')).toBe(String.raw`'\r'`);
    expect(escapeMysqlSqlLiteral('\x1a')).toBe(String.raw`'\Z'`);
  });

  it('dates, arrays and byte buffers match the ANSI shapes', () => {
    expect(escapeMysqlSqlLiteral(new Date(2024, 0, 15, 12, 30, 45, 123))).toBe("'2024-01-15 12:30:45.123'");
    expect(escapeMysqlSqlLiteral(new Date('invalid'))).toBe('NULL');
    expect(escapeMysqlSqlLiteral([1, "o'reilly"])).toBe(String.raw`1, 'o\'reilly'`);
    expect(
      escapeMysqlSqlLiteral([
        [1, 2],
        [3, 4],
      ]),
    ).toBe('(1, 2), (3, 4)');
    expect(escapeMysqlSqlLiteral(Buffer.from([0x48, 0x69]))).toBe("X'4869'");
  });

  it('toSqlString raw hatch (caller must trust return value)', () => {
    expect(escapeMysqlSqlLiteral({ toSqlString: () => 'CURRENT_TIMESTAMP' })).toBe('CURRENT_TIMESTAMP');
  });

  // `sqlstring` emitted invalid or unsafe SQL for these; MySQL now matches Postgres/SQLite.
  it('is stricter than sqlstring on values it rendered unsafely', () => {
    expect(escapeMysqlSqlLiteral(Number.NaN)).toBe('NULL');
    expect(escapeMysqlSqlLiteral(Number.POSITIVE_INFINITY)).toBe('NULL');
    expect(escapeMysqlSqlLiteral(42n)).toBe('42');
    expect(escapeMysqlSqlLiteral(new Uint8Array([0xff, 0]))).toBe("X'ff00'");
    expect(() => escapeMysqlSqlLiteral({ a: 1 })).toThrow(/plain objects/);
    expect(() => escapeMysqlSqlLiteral(() => {})).toThrow(/function/);
    expect(() => escapeMysqlSqlLiteral(Symbol('x'))).toThrow(/symbol/);
  });
});

describe('escapeMysqlSqlLiteral - SQL injection hardening (string literals)', () => {
  const payloads: [string, string][] = [
    [`admin'--`, String.raw`'admin\'--'`],
    [`' OR '1'='1`, String.raw`'\' OR \'1\'=\'1'`],
    [`'; DROP TABLE users; --`, String.raw`'\'; DROP TABLE users; --'`],
    [String.raw`\' OR 1=1--`, String.raw`'\\\' OR 1=1--'`],
    [`％＇ＯＲ％＇１％＝％１`, `'％＇ＯＲ％＇１％＝％１'`],
  ];

  it.each(payloads)('payload %s escapes to a single literal', (payload, expected) => {
    expect(escapeMysqlSqlLiteral(payload)).toBe(expected);
  });

  it('concatenation with static SQL cannot inject OR 1=1 as syntax', () => {
    const fragment = `WHERE name = ${escapeMysqlSqlLiteral(`x' OR '1'='1`)}`;
    expect(fragment).toBe(String.raw`WHERE name = 'x\' OR \'1\'=\'1'`);
  });

  // The historical `addslashes` bypass shape. We escape per code point, so the quote still escapes.
  it('a multi-byte character before a quote does not consume the escape', () => {
    expect(escapeMysqlSqlLiteral(`¿'`)).toBe(String.raw`'¿\''`);
    expect(escapeMysqlSqlLiteral(`縺'`)).toBe(String.raw`'縺\''`);
  });

  it('astral and lone-surrogate strings stay inside the literal', () => {
    expect(escapeMysqlSqlLiteral('a\u{1F600}b')).toBe("'a\u{1F600}b'");
    expect(escapeMysqlSqlLiteral('a\uD800b')).toBe("'a\uD800b'");
    expect(escapeMysqlSqlLiteral('')).toBe("''");
  });
});

// A deliberate divergence: `sqlstring` and `sql-escaper` render object-likes as a `` `key` = value ``
// fragment, which is valid-but-wrong SQL where a literal was expected. We reject, on both dialects.
describe.each([
  ['escapeAnsiSqlLiteral', escapeAnsiSqlLiteral],
  ['escapeMysqlSqlLiteral', escapeMysqlSqlLiteral],
])('%s - object-likes are rejected, never rendered as assignments', (_name, escapeLiteral) => {
  it.each([
    ['Set', new Set([1, 2])],
    ['Map', new Map([['a', 1]])],
    ['class instance', new (class Foo {})()],
    ['null-prototype object', Object.create(null)],
  ])('rejects %s', (_label, value) => {
    expect(() => escapeLiteral(value)).toThrow(/plain objects/);
  });

  // `sqlstring` escaped array elements with `stringifyObjects: true`, yielding `'[object Object]'`.
  it('rejects an object nested inside an array', () => {
    expect(() => escapeLiteral([1, { a: 1 }])).toThrow(/plain objects/);
  });
});

it('escapes strings nested inside arrays, per dialect', () => {
  expect(escapeAnsiSqlLiteral([["a'b"]])).toBe(`('a''b')`);
  expect(escapeMysqlSqlLiteral([["a'b"]])).toBe(String.raw`('a\'b')`);
});

describe('escapeAnsiSqlLiteral - SQL injection hardening (string literals)', () => {
  const payloads = [
    `admin'--`,
    `' OR '1'='1`,
    `'; DROP TABLE users; --`,
    `1' UNION SELECT * FROM secrets--`,
    String.raw`\' OR 1=1--`,
    `name'; DELETE FROM t WHERE '1'='1`,
    `'\nOR\n1=1`,
    `％＇ＯＲ％＇１％＝％１`, // fullwidth - still a string; must stay inside quotes
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
  });
});
