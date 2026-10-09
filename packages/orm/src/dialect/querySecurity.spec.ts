import { describe, expect, it } from 'vitest';
import { CockroachDialect } from '../cockroachdb/cockroachDialect.js';
import { Entity, Field, Filter, getMeta, Id } from '../entity/index.js';
import { MariaDialect } from '../mariadb/mariaDialect.js';
import { MsSqlDialect } from '../mssql/mssqlDialect.js';
import { MySqlDialect } from '../mysql/mysqlDialect.js';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import { SqliteDialect } from '../sqlite/sqliteDialect.js';
import { Company, Invoice, User } from '../test/index.js';
import type { QueryWhere } from '../type/index.js';
import { normalizeScalarFieldSelection } from '../util/dialect.util.js';
import { UqlUsageError } from '../util/uqlError.js';

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
  const pg = new PostgresDialect();

  it.each(["'; DROP TABLE users; --", "admin' OR '1'='1", "admin' UNION SELECT * FROM credentials --", '1 OR 1=1'])(
    'should bind %j as a value, never as SQL',
    (payload) => {
      expect(pg.compile((ctx) => pg.find(ctx, User, { $select: { id: true }, $where: { name: payload } }))).toEqual({
        sql: 'SELECT "id" FROM "User" WHERE "name" = $1',
        values: [payload],
      });
    },
  );
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

describe('SQL generation - JSON path keys', () => {
  const dialects = [
    new PostgresDialect(),
    new CockroachDialect(),
    new MySqlDialect(),
    new MariaDialect(),
    new SqliteDialect(),
    new MsSqlDialect(),
  ];
  const unsafeKeys = ["x\\'", "it's", 'a"b', 'a b', 'a,b', '{a}', 'a[0]', '$a', ''];

  describe.each(dialects.map((dialect) => [dialect.dialectName, dialect] as const))('%s', (_, dialect) => {
    it.each(unsafeKeys)('should refuse %j in a $where path', (key) => {
      const $where: Record<string, unknown> = { [`kind.${key}`]: 'v' };
      expect(() => dialect.find(dialect.createContext(), Company, { $where })).toThrow(UqlUsageError);
    });

    it.each(unsafeKeys)('should refuse %j in a $sort path', (key) => {
      const $sort: Record<string, unknown> = { [`kind.${key}`]: 'asc' };
      // @ts-expect-error a key the document type does not declare
      expect(() => dialect.find(dialect.createContext(), Company, { $sort })).toThrow(UqlUsageError);
    });

    it.each(['$set', '$push', '$pull'])('should refuse an unsafe key in %s', (op) => {
      const kind: Record<string, unknown> = { [op]: { "x\\'": 1 } };
      expect(() =>
        // @ts-expect-error a key the document type does not declare
        dialect.update(dialect.createContext(), Company, { $where: { id: 1 } }, { kind }),
      ).toThrow(UqlUsageError);
    });

    it('should refuse an unsafe key in $unset', () => {
      const kind: Record<string, unknown> = { $unset: ['a.b'] };
      expect(() =>
        // @ts-expect-error a key the document type does not declare
        dialect.update(dialect.createContext(), Company, { $where: { id: 1 } }, { kind }),
      ).toThrow(UqlUsageError);
    });

    it('should take an identifier key of any script', () => {
      const ctx = dialect.createContext();
      // @ts-expect-error a key the document type does not declare
      dialect.find(ctx, Company, { $where: { 'kind.año_2': 1 } });
      expect(ctx.sql).toContain('año_2');
    });
  });
});

@Filter('tenant', { where: (ctx) => ({ tenantId: ctx?.secureTenantId }), security: true })
@Entity()
class LooseTenantRow {
  @Id({ type: Number })
  id?: number;
  @Field({ type: Number })
  tenantId?: number | null;
}

describe('SQL generation - undefined in $where', () => {
  const pg = new PostgresDialect();
  const render = (where: QueryWhere<User>) => () => pg.find(pg.createContext(), User, { $where: where });

  it('should refuse an undefined value, which would otherwise filter by nothing', () => {
    expect(render({ name: undefined })).toThrow("$where on 'User' holds undefined at 'name'");
  });

  it('should refuse an undefined value beside a defined one', () => {
    expect(render({ name: undefined, companyId: 'c1' })).toThrow("holds undefined at 'name'");
  });

  it('should refuse an undefined value inside a group', () => {
    expect(render({ $or: [{ companyId: 'c1' }, { name: undefined }] })).toThrow("holds undefined at '$or.1.name'");
  });

  it('should refuse an undefined operand', () => {
    expect(render({ name: { $ne: undefined } })).toThrow("holds undefined at 'name.$ne'");
    expect(render({ companyId: { $in: ['c1', undefined] } })).toThrow("holds undefined at 'companyId.$in.1'");
  });

  it('should refuse a filter resolving to undefined, rather than drop it', () => {
    expect(() => pg.find(pg.createContext(), LooseTenantRow, {})).toThrow("holds undefined at '$and.0.tenantId'");
  });

  it('should take null, which matches NULL', () => {
    const ctx = pg.createContext();
    pg.find(ctx, User, { $where: { name: null } });
    expect(ctx.sql).toContain('IS NULL');
  });
});
