import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { getMeta } from '../entity/index.js';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import { Company, Item, Profile, Tag, User } from '../test/index.js';
import type { Query } from '../type/index.js';
import { normalizeScalarFieldSelection } from '../util/dialect.util.js';
import { escapeSqlId } from '../util/sql.util.js';
import { parseQuery } from './query.util.js';

describe('parseQuery — prototype pollution defense', () => {
  it('rejects __proto__ pollution via $where', () => {
    const req = {
      query: { $where: '{"__proto__": {"polluted": true}}' },
    } as Request;
    parseQuery(req);
    // Object.prototype should NOT have been polluted
    expect({} as Record<string, unknown>).not.toHaveProperty('polluted');
    // The parsed value should have __proto__ as a plain key, not a prototype
    const parsedWhere = (req.query as Query<unknown>).$where as Record<string, unknown>;
    expect(parsedWhere).toHaveProperty('__proto__');
    const protoEntry = Object.entries(parsedWhere).find(([k]) => k === '__proto__');
    expect(protoEntry).toBeTruthy();
    expect(protoEntry?.[1]).toEqual({ polluted: true });
  });

  it('rejects __proto__ pollution via $select', () => {
    const req = {
      query: { $select: '{"__proto__": {"polluted2": true}}' },
    } as Request;
    parseQuery(req);
    expect({} as Record<string, unknown>).not.toHaveProperty('polluted2');
  });

  it('rejects __proto__ pollution via $exclude', () => {
    const req = {
      query: { $exclude: '{"__proto__": {"polluted3": true}}' },
    } as Request;
    parseQuery(req);
    expect({} as Record<string, unknown>).not.toHaveProperty('polluted3');
  });

  it('rejects constructor.prototype pollution via $populate', () => {
    const req = {
      query: { $populate: '{"constructor": {"prototype": {"polluted4": true}}}' },
    } as Request;
    parseQuery(req);
    expect({} as Record<string, unknown>).not.toHaveProperty('polluted4');
  });
});

describe('parseQuery — number coercion defense', () => {
  it('coerces valid numeric strings for $skip', () => {
    const req = { query: { $skip: '42' } } as Request;
    parseQuery(req);
    expect(req.query.$skip).toBe(42);
  });

  it('coerces NaN for non-numeric $skip', () => {
    const req = { query: { $skip: 'abc' } } as Request;
    parseQuery(req);
    expect(req.query.$skip).toBeNaN();
  });

  it('coerces valid numeric strings for $limit', () => {
    const req = { query: { $limit: '100' } } as Request;
    parseQuery(req);
    expect(req.query.$limit).toBe(100);
  });

  it('coerces NaN for non-numeric $limit', () => {
    const req = { query: { $limit: 'DROP TABLE' } } as Request;
    parseQuery(req);
    expect(req.query.$limit).toBeNaN();
  });
});

describe('parseQuery — unknown keys are passthrough', () => {
  it('preserves unknown query keys', () => {
    const req = { query: { $customKey: 'value' } } as Request;
    parseQuery(req);
    expect(req.query).toHaveProperty('$customKey');
    expect((req.query as Record<string, unknown>)['$customKey']).toBe('value');
  });
});

describe('escapeSqlId — identifier injection hardening', () => {
  it('escapes double-quote in table name', () => {
    const payload = 'users"; DROP TABLE users; --';
    expect(escapeSqlId(payload, '"')).toBe('"users""; DROP TABLE users; --"');
  });

  it('escapes backtick in table name', () => {
    const payload = 'users`; DROP TABLE users; --';
    expect(escapeSqlId(payload, '`')).toBe('`users``; DROP TABLE users; --`');
  });

  it('escapes single quote (should not be needed for identifiers, but must not break)', () => {
    const payload = "users' OR 1=1";
    expect(escapeSqlId(payload, '"')).toBe('"users\' OR 1=1"');
  });

  it('handles NULL byte in identifier', () => {
    expect(escapeSqlId('users\u0000', '"')).toBe('"users\u0000"');
  });
});

describe('normalizeScalarFieldSelection — field validation', () => {
  const userMeta = getMeta(User);

  it('filters out unknown fields from $select', () => {
    const result = normalizeScalarFieldSelection(userMeta, { name: true, nonexistent: true } as any);
    expect(result).toEqual(['name']);
  });

  it('filters out unknown fields from $exclude', () => {
    const result = normalizeScalarFieldSelection(userMeta, undefined, { nonexistent: true } as any);
    // Should return all scalar fields since nonexistent was filtered out
    expect(result).toContain('name');
  });

  it('handles empty $select — falls back to all fields', () => {
    const result = normalizeScalarFieldSelection(userMeta, {}, undefined);
    expect(result).toContain('name');
  });

  it('handles empty $exclude — returns all fields', () => {
    const result = normalizeScalarFieldSelection(userMeta, undefined, {});
    expect(result).toContain('name');
  });

  it('negative value in $select excludes the field', () => {
    const result = normalizeScalarFieldSelection(userMeta, { name: false });
    expect(result).not.toContain('name');
  });

  it('true in $exclude excludes the field', () => {
    const result = normalizeScalarFieldSelection(userMeta, undefined, { name: true });
    expect(result).not.toContain('name');
  });

  it('ignores non-boolean values in $exclude', () => {
    const result = normalizeScalarFieldSelection(userMeta, undefined, { name: 'yes' } as any);
    expect(result).not.toContain('name');
  });
});

describe('SQL generation — WHERE parameterization', () => {
  it('parameterizes WHERE values instead of inlining them', () => {
    const pg = new PostgresDialect();
    const ctx = pg.createContext();
    pg.find(ctx, User, { $where: { name: "'; DROP TABLE users; --" } });
    // SQL should contain a placeholder, not the injected value
    expect(ctx.sql).not.toContain('DROP');
    expect(ctx.sql).not.toContain("'");
    // The injected value should be in params, not SQL
    expect(ctx.values).toContain("'; DROP TABLE users; --");
  });

  it('parameterizes WHERE values with OR injection', () => {
    const pg = new PostgresDialect();
    const ctx = pg.createContext();
    pg.find(ctx, User, { $where: { name: "admin' OR '1'='1" } });
    expect(ctx.sql).not.toContain('OR');
    expect(ctx.values).toContain("admin' OR '1'='1");
  });

  it('parameterizes WHERE values with UNION injection', () => {
    const pg = new PostgresDialect();
    const ctx = pg.createContext();
    pg.find(ctx, User, { $where: { name: "admin' UNION SELECT * FROM credentials --" } });
    expect(ctx.sql).not.toContain('UNION');
    expect(ctx.values).toContain("admin' UNION SELECT * FROM credentials --");
  });

  it('handles numeric injection in WHERE', () => {
    const pg = new PostgresDialect();
    const ctx = pg.createContext();
    pg.find(ctx, User, { $where: { id: '1 OR 1=1' } } as Query<User>);
    expect(ctx.sql).not.toContain('OR');
    expect(ctx.values).toContain('1 OR 1=1');
  });

  it('escapes table names even with injection attempt', () => {
    const pg = new PostgresDialect();
    const ctx = pg.createContext();
    pg.find(ctx, User, {});
    // User entity table name is properly escaped
    expect(ctx.sql).toMatch(/FROM\s+"User"/);
  });
});

describe('SQL generation — $select field name validation', () => {
  it('rejects unknown field keys from $select at runtime', () => {
    const pg = new PostgresDialect();
    const ctx = pg.createContext();
    // Use type assertion to bypass compile-time checking (simulates user input)
    pg.find(ctx, User, { $select: { name: true, fakeField: true } } as Query<User>);
    // Only 'name' should appear in SQL, not 'fakeField'
    expect(ctx.sql).toContain('"name"');
    expect(ctx.sql).not.toContain('fakeField');
  });

  it('escapes field names in $select', () => {
    const pg = new PostgresDialect();
    const ctx = pg.createContext();
    pg.find(ctx, User, { $select: { name: true } });
    expect(ctx.sql).toContain('"name"');
    expect(ctx.sql).not.toContain(';');
  });
});

describe('SQL generation — $exclude field name validation', () => {
  it('ignores unknown field keys in $exclude at runtime', () => {
    const pg = new PostgresDialect();
    const ctx = pg.createContext();
    pg.find(ctx, User, { $exclude: { nonexistent: true } } as Query<User>);
    // Should not error and should include all expected columns
    expect(ctx.sql).toContain('"name"');
  });

  it('properly excludes known fields', () => {
    const pg = new PostgresDialect();
    const ctx = pg.createContext();
    pg.find(ctx, User, { $exclude: { name: true } });
    // name should be excluded, other fields present
    expect(ctx.sql).not.toContain('"name"');
    expect(ctx.sql).toContain('"email"');
  });
});

describe('SQL generation — $where operator safety', () => {
  it('handles $ne operator safely', () => {
    const pg = new PostgresDialect();
    const ctx = pg.createContext();
    pg.find(ctx, User, { $where: { name: { $ne: null } } });
    expect(ctx.sql).not.toContain('DROP');
    expect(ctx.sql).not.toContain(';');
  });

  it('handles $or operator safely', () => {
    const pg = new PostgresDialect();
    const ctx = pg.createContext();
    pg.find(ctx, User, { $where: { $or: [{ name: 'a' }, { name: 'b' }] } });
    expect(ctx.sql).not.toContain('DROP');
    expect(ctx.sql).not.toContain(';');
  });

  it('handles $in operator safely', () => {
    const pg = new PostgresDialect();
    const ctx = pg.createContext();
    pg.find(ctx, User, { $where: { name: { $in: ['a', 'b', "'; DROP TABLE users; --"] } } });
    expect(ctx.sql).not.toContain('DROP');
    // The malicious value should be parameterized (stored as nested array for IN clause)
    const flatValues = ctx.values.flat(Number.POSITIVE_INFINITY);
    expect(flatValues).toContain("'; DROP TABLE users; --");
  });
});

describe('SQL generation — relation field safety', () => {
  it('does not include relation fields in scalar select at runtime', () => {
    const pg = new PostgresDialect();
    const ctx = pg.createContext();
    pg.find(ctx, User, { $select: { name: true, company: true } } as Query<User>);
    // 'company' is a relation, should not appear as a scalar column
    expect(ctx.sql).toContain('"name"');
    expect(ctx.sql).not.toMatch(/"company"/);
  });
});

describe('SQL generation — edge cases', () => {
  it('handles empty query', () => {
    const pg = new PostgresDialect();
    const ctx = pg.createContext();
    pg.find(ctx, User, {});
    expect(ctx.sql).toContain('SELECT');
    expect(ctx.sql).toContain('FROM');
  });

  it('handles null value in WHERE', () => {
    const pg = new PostgresDialect();
    const ctx = pg.createContext();
    pg.find(ctx, User, { $where: { name: null } } as unknown as Query<User>);
    expect(ctx.sql).not.toContain('DROP');
    expect(ctx.sql).not.toContain(';');
  });

  it('handles undefined value in WHERE', () => {
    const pg = new PostgresDialect();
    const ctx = pg.createContext();
    pg.find(ctx, User, { $where: { name: undefined } });
    expect(ctx.sql).not.toContain('DROP');
  });

  it('handles empty string in WHERE', () => {
    const pg = new PostgresDialect();
    const ctx = pg.createContext();
    pg.find(ctx, User, { $where: { name: '' } });
    expect(ctx.sql).not.toContain('DROP');
    expect(ctx.values).toContain('');
  });

  it('handles numeric zero in WHERE', () => {
    const pg = new PostgresDialect();
    const ctx = pg.createContext();
    pg.find(ctx, User, { $where: { id: 0 } });
    expect(ctx.sql).not.toContain('DROP');
    expect(ctx.values).toContain(0);
  });

  it('handles string value in numeric WHERE field', () => {
    const pg = new PostgresDialect();
    const ctx = pg.createContext();
    pg.find(ctx, User, { $where: { id: '123' } } as Query<User>);
    expect(ctx.sql).not.toContain('DROP');
  });
});

describe('field key validation across entities', () => {
  it('Company fields are validated', () => {
    const meta = getMeta(Company);
    const result = normalizeScalarFieldSelection(meta, { name: true, fakeField: true } as any);
    expect(result).toEqual(['name']);
  });

  it('Profile fields are validated', () => {
    const meta = getMeta(Profile);
    const result = normalizeScalarFieldSelection(meta, { picture: true, nonexistent: true } as any);
    expect(result).toEqual(['picture']);
  });

  it('Item fields are validated', () => {
    const meta = getMeta(Item);
    const result = normalizeScalarFieldSelection(meta, { name: true, fakeField: true } as any);
    expect(result).toContain('name');
  });

  it('Tag fields are validated', () => {
    const meta = getMeta(Tag);
    const result = normalizeScalarFieldSelection(meta, { name: true, fakeField: true } as any);
    expect(result).toEqual(['name']);
  });
});
