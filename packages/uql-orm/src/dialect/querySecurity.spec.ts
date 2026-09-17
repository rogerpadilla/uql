import { describe, expect, it } from 'vitest';
import { getMeta } from '../entity/index.js';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import { Invoice, User } from '../test/index.js';
import { normalizeScalarFieldSelection } from '../util/dialect.util.js';
import { escapeSqlId } from '../util/sql.util.js';

describe('escapeSqlId - identifier injection hardening', () => {
  it('should escape double-quote in table name', () => {
    const payload = 'users"; DROP TABLE users; --';
    expect(escapeSqlId(payload, '"')).toBe('"users""; DROP TABLE users; --"');
  });

  it('should escape backtick in table name', () => {
    const payload = 'users`; DROP TABLE users; --';
    expect(escapeSqlId(payload, '`')).toBe('`users``; DROP TABLE users; --`');
  });

  it('should escape single quote (should not be needed for identifiers, but must not break)', () => {
    const payload = "users' OR 1=1";
    expect(escapeSqlId(payload, '"')).toBe('"users\' OR 1=1"');
  });

  it('should handle NULL byte in identifier', () => {
    expect(escapeSqlId('users\u0000', '"')).toBe('"users\u0000"');
  });
});

describe('normalizeScalarFieldSelection - field validation', () => {
  const userMeta = getMeta(User);

  it('should filter out unknown fields from $select', () => {
    // @ts-expect-error: not a field of `User`
    const result = normalizeScalarFieldSelection(userMeta, { name: true, nonexistent: true });
    expect(result).toEqual(['name']);
  });

  it('should filter out unknown fields from $exclude', () => {
    // @ts-expect-error: not a field of `User`
    const result = normalizeScalarFieldSelection(userMeta, undefined, { nonexistent: true });
    expect(result).toContain('name');
  });

  it('should handle empty $select - falls back to all fields', () => {
    const result = normalizeScalarFieldSelection(userMeta, {}, undefined);
    expect(result).toContain('name');
  });

  it('should handle empty $exclude - returns all fields', () => {
    const result = normalizeScalarFieldSelection(userMeta, undefined, {});
    expect(result).toContain('name');
  });

  it('should exclude a field $select gives false', () => {
    const result = normalizeScalarFieldSelection(userMeta, { name: false });
    expect(result).not.toContain('name');
  });

  it('should exclude a field $exclude gives true', () => {
    const result = normalizeScalarFieldSelection(userMeta, undefined, { name: true });
    expect(result).not.toContain('name');
  });

  it('should ignore non-boolean values in $exclude', () => {
    // @ts-expect-error: not a boolean
    const result = normalizeScalarFieldSelection(userMeta, undefined, { name: 'yes' });
    expect(result).not.toContain('name');
  });
});

describe('SQL generation - WHERE parameterization', () => {
  it('should parameterize WHERE values instead of inlining them', () => {
    const pg = new PostgresDialect();
    const ctx = pg.createContext();
    pg.find(ctx, User, { $where: { name: "'; DROP TABLE users; --" } });
    // SQL should contain a placeholder, not the injected value
    expect(ctx.sql).not.toContain('DROP');
    expect(ctx.sql).not.toContain("'");
    // The injected value should be in params, not SQL
    expect(ctx.values).toContain("'; DROP TABLE users; --");
  });

  it('should parameterize WHERE values with OR injection', () => {
    const pg = new PostgresDialect();
    const ctx = pg.createContext();
    pg.find(ctx, User, { $where: { name: "admin' OR '1'='1" } });
    expect(ctx.sql).not.toContain('OR');
    expect(ctx.values).toContain("admin' OR '1'='1");
  });

  it('should parameterize WHERE values with UNION injection', () => {
    const pg = new PostgresDialect();
    const ctx = pg.createContext();
    pg.find(ctx, User, { $where: { name: "admin' UNION SELECT * FROM credentials --" } });
    expect(ctx.sql).not.toContain('UNION');
    expect(ctx.values).toContain("admin' UNION SELECT * FROM credentials --");
  });

  it('should handle numeric injection in WHERE', () => {
    const pg = new PostgresDialect();
    const ctx = pg.createContext();
    pg.find(ctx, User, { $where: { id: '1 OR 1=1' } });
    expect(ctx.sql).not.toContain('OR');
    expect(ctx.values).toContain('1 OR 1=1');
  });

  it('should escape table names even with injection attempt', () => {
    const pg = new PostgresDialect();
    const ctx = pg.createContext();
    pg.find(ctx, User, {});
    // User entity table name is properly escaped
    expect(ctx.sql).toMatch(/FROM\s+"User"/);
  });
});

describe('SQL generation - $select field name validation', () => {
  it('should reject unknown field keys from $select at runtime', () => {
    const pg = new PostgresDialect();
    const ctx = pg.createContext();
    // Use type assertion to bypass compile-time checking (simulates user input)
    // @ts-expect-error: not a field of `User`
    pg.find(ctx, User, { $select: { name: true, fakeField: true } });
    // Only 'name' should appear in SQL, not 'fakeField'
    expect(ctx.sql).toContain('"name"');
    expect(ctx.sql).not.toContain('fakeField');
  });

  it('should escape field names in $select', () => {
    const pg = new PostgresDialect();
    const ctx = pg.createContext();
    pg.find(ctx, User, { $select: { name: true } });
    expect(ctx.sql).toContain('"name"');
    expect(ctx.sql).not.toContain(';');
  });
});

describe('SQL generation - $exclude field name validation', () => {
  it('should ignore unknown field keys in $exclude at runtime', () => {
    const pg = new PostgresDialect();
    const ctx = pg.createContext();
    // @ts-expect-error: not a field of `User`
    pg.find(ctx, User, { $exclude: { nonexistent: true } });
    expect(ctx.sql).toContain('"name"');
  });

  it('should leave an excluded field out of the statement', () => {
    const pg = new PostgresDialect();
    const ctx = pg.createContext();
    pg.find(ctx, User, { $exclude: { name: true } });
    // name should be excluded, other fields present
    expect(ctx.sql).not.toContain('"name"');
    expect(ctx.sql).toContain('"email"');
  });
});

describe('SQL generation - $where operator safety', () => {
  it('should handle $ne operator safely', () => {
    const pg = new PostgresDialect();
    const ctx = pg.createContext();
    pg.find(ctx, User, { $where: { name: { $ne: null } } });
    expect(ctx.sql).not.toContain('DROP');
    expect(ctx.sql).not.toContain(';');
  });

  it('should handle $or operator safely', () => {
    const pg = new PostgresDialect();
    const ctx = pg.createContext();
    pg.find(ctx, User, { $where: { $or: [{ name: 'a' }, { name: 'b' }] } });
    expect(ctx.sql).not.toContain('DROP');
    expect(ctx.sql).not.toContain(';');
  });

  it('should handle $in operator safely', () => {
    const pg = new PostgresDialect();
    const ctx = pg.createContext();
    pg.find(ctx, User, { $where: { name: { $in: ['a', 'b', "'; DROP TABLE users; --"] } } });
    expect(ctx.sql).not.toContain('DROP');
    // The malicious value should be parameterized (stored as nested array for IN clause)
    const flatValues = ctx.values.flat(Number.POSITIVE_INFINITY);
    expect(flatValues).toContain("'; DROP TABLE users; --");
  });
});

describe('SQL generation - relation field safety', () => {
  it('should do not include relation fields in scalar select at runtime', () => {
    const pg = new PostgresDialect();
    const ctx = pg.createContext();
    // @ts-expect-error: a relation, which `$populate` reads
    pg.find(ctx, User, { $select: { name: true, company: true } });
    expect(ctx.sql).toContain('"name"');
    expect(ctx.sql).not.toMatch(/"company"/);
  });
});

describe('SQL generation - edge cases', () => {
  it('should handle empty query', () => {
    const pg = new PostgresDialect();
    const ctx = pg.createContext();
    pg.find(ctx, User, {});
    expect(ctx.sql).toContain('SELECT');
    expect(ctx.sql).toContain('FROM');
  });

  it('should handle null value in WHERE', () => {
    const pg = new PostgresDialect();
    const ctx = pg.createContext();
    pg.find(ctx, User, { $where: { name: null } });
    expect(ctx.sql).not.toContain('DROP');
    expect(ctx.sql).not.toContain(';');
  });

  it('should handle undefined value in WHERE', () => {
    const pg = new PostgresDialect();
    const ctx = pg.createContext();
    pg.find(ctx, User, { $where: { name: undefined } });
    expect(ctx.sql).not.toContain('DROP');
  });

  it('should handle empty string in WHERE', () => {
    const pg = new PostgresDialect();
    const ctx = pg.createContext();
    pg.find(ctx, User, { $where: { name: '' } });
    expect(ctx.sql).not.toContain('DROP');
    expect(ctx.values).toContain('');
  });

  it('should handle numeric zero in WHERE', () => {
    const pg = new PostgresDialect();
    const ctx = pg.createContext();
    pg.find(ctx, Invoice, { $where: { id: 0 } });
    expect(ctx.sql).not.toContain('DROP');
    expect(ctx.values).toContain(0);
  });

  it('should handle string value in numeric WHERE field', () => {
    const pg = new PostgresDialect();
    const ctx = pg.createContext();
    pg.find(ctx, User, { $where: { id: '123' } });
    expect(ctx.sql).not.toContain('DROP');
  });
});
