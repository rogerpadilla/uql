import type { SQL } from 'bun';
import { describe, expect, test } from 'vitest';
import { getAffectedRows, getInsertId, inferDialectName, normalizeBunOpts, normalizeRows } from './bunSql.util.js';

describe('bunSql.util', () => {
  describe('inferDialectName', () => {
    test('should infer sqlite from filename', () => {
      expect(inferDialectName({ filename: 'test.db' } as SQL.Options)).toBe('sqlite');
    });

    test('should infer sqlite from :memory: url', () => {
      expect(inferDialectName({ url: ':memory:' } as SQL.Options)).toBe('sqlite');
    });

    test('should infer sqlite from sqlite:// url', () => {
      expect(inferDialectName({ url: 'sqlite://test.db' } as SQL.Options)).toBe('sqlite');
    });

    test('should infer sqlite from sqlite3:// url', () => {
      expect(inferDialectName({ url: 'sqlite3://test.db' } as SQL.Options)).toBe('sqlite');
    });

    test('should infer mysql from mysql:// url', () => {
      expect(inferDialectName({ url: 'mysql://localhost' } as SQL.Options)).toBe('mysql');
    });

    test('should infer mysql from mysql2:// url', () => {
      expect(inferDialectName({ url: 'mysql2://localhost' } as SQL.Options)).toBe('mysql');
    });

    test('should infer postgres from postgres:// url', () => {
      expect(inferDialectName({ url: 'postgres://localhost' } as SQL.Options)).toBe('postgres');
    });

    test('should infer postgres from postgresql:// url', () => {
      expect(inferDialectName({ url: 'postgresql://localhost' } as SQL.Options)).toBe('postgres');
    });

    test('should infer mariadb from mariadb:// url', () => {
      expect(inferDialectName({ url: 'mariadb://localhost' } as SQL.Options)).toBe('mariadb');
    });

    test('should return adapter if provided', () => {
      expect(inferDialectName({ adapter: 'mysql' } as SQL.Options)).toBe('mysql');
    });

    test('should default to postgres', () => {
      expect(inferDialectName({} as SQL.Options)).toBe('postgres');
    });

    test('should refuse an engine bun cannot dial rather than reading it as postgres', () => {
      expect(() => inferDialectName({ url: 'mssql://localhost' } as SQL.Options)).toThrow(
        'Bun SQL has no mssql driver; use the dedicated uql-orm/mssql pool',
      );
      expect(() => inferDialectName({ url: 'sqlserver://localhost' } as SQL.Options)).toThrow('uql-orm/mssql pool');
    });
  });

  describe('normalizeBunOpts', () => {
    test('should handle sqlite with url as filename', () => {
      const opts = normalizeBunOpts({ url: 'test.db' } as SQL.Options, 'sqlite');
      expect((opts as any).filename).toBe('test.db');
      expect((opts as any).adapter).toBe('sqlite');
    });

    test('should handle sqlite with :memory: default', () => {
      const opts = normalizeBunOpts({} as SQL.Options, 'sqlite');
      expect((opts as any).filename).toBe(':memory:');
      expect((opts as any).adapter).toBe('sqlite');
    });

    test('should map cockroachdb to postgres adapter', () => {
      const opts = normalizeBunOpts({ hostname: 'h' } as SQL.Options, 'cockroachdb');
      expect((opts as any).adapter).toBe('postgres');
    });

    test('should return opts unchanged when url is absent', () => {
      const opts = normalizeBunOpts({ adapter: 'postgres', hostname: 'h' } as SQL.Options, 'postgres');
      expect((opts as any).url).toBeUndefined();
    });

    test('should strip sslmode=no-verify from string url and set tls', () => {
      const opts = normalizeBunOpts({ url: 'postgres://localhost/?sslmode=no-verify' }, 'postgres');
      expect(String((opts as SQL.PostgresOrMySQLOptions).url)).not.toContain('sslmode=no-verify');
      expect((opts as any).tls).toMatchObject({ rejectUnauthorized: false });
    });

    test('should strip sslmode=no-verify from URL instance and merge tls', () => {
      const url = new URL('postgres://localhost/');
      url.searchParams.set('sslmode', 'no-verify');
      const opts = normalizeBunOpts({ url, tls: { ca: 'x' } } as SQL.Options, 'postgres');
      expect(String((opts as SQL.PostgresOrMySQLOptions).url)).not.toContain('sslmode=no-verify');
      expect((opts as any).tls).toEqual({ rejectUnauthorized: false, ca: 'x' });
    });

    test('should ignore invalid url when normalizing', () => {
      const opts = normalizeBunOpts({ url: '::not-a-url' } as SQL.Options, 'postgres');
      expect(opts).toBeDefined();
    });
  });

  describe('getAffectedRows', () => {
    test('prefers affectedRows over count', () => {
      expect(getAffectedRows(Object.assign([], { affectedRows: 2, count: 1 }) as any)).toBe(2);
    });

    test('uses count when the adapter leaves affectedRows null (postgres, sqlite)', () => {
      expect(getAffectedRows(Object.assign([], { count: 3, affectedRows: null }) as any)).toBe(3);
    });

    test('uses count when a mysql read reports affectedRows 0', () => {
      expect(getAffectedRows(Object.assign([{}, {}], { count: 2, affectedRows: 0 }) as any)).toBe(2);
    });

    test('counts the rows a returning insert wrote, not the rows it returned', () => {
      expect(getAffectedRows(Object.assign([{}], { count: 1, affectedRows: null }) as any)).toBe(1);
    });

    test('reports nothing when the header carries neither, leaving the rows to answer', () => {
      expect(getAffectedRows([] as any)).toBeUndefined();
      expect(getAffectedRows(Object.assign([{}], {}) as any)).toBeUndefined();
    });
  });

  describe('getInsertId', () => {
    test('coerces bigint to number', () => {
      expect(getInsertId(Object.assign([], { lastInsertRowid: 99n }) as any)).toBe(99);
    });
    test('returns numeric id as-is', () => {
      expect(getInsertId(Object.assign([], { lastInsertRowid: 7 }) as any)).toBe(7);
    });
  });

  describe('normalizeRows', () => {
    test('coerces bigint fields to number', () => {
      const rows = [{ id: 5n }];
      expect(normalizeRows(rows as any)).toEqual([{ id: 5 }]);
    });

    test('preserves row reference when no bigint exists', () => {
      const row = { id: 1, name: 'a' };
      const rows = [row];
      const normalized = normalizeRows(rows as any);
      expect(normalized[0]).toBe(row);
    });

    test('clones row when bigint exists', () => {
      const row = { id: 5n, name: 'a' };
      const rows = [row];
      const normalized = normalizeRows(rows as any);
      expect(normalized[0]).not.toBe(row);
      expect(normalized[0]).toEqual({ id: 5, name: 'a' });
    });
  });
});
