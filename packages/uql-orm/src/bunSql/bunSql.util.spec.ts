import type { SQL } from 'bun';
import { describe, expect, test } from 'vitest';
import {
  getAffectedRows,
  getInsertId,
  inferDialect,
  isPoolableDialect,
  isReservedConnection,
  normalizeBunOpts,
  normalizeRows,
} from './bunSql.util.js';

describe('bunSql.util', () => {
  describe('inferDialect', () => {
    test('should infer sqlite from filename', () => {
      expect(inferDialect({ filename: 'test.db' } as SQL.Options)).toBe('sqlite');
    });

    test('should infer sqlite from :memory: url', () => {
      expect(inferDialect({ url: ':memory:' } as SQL.Options)).toBe('sqlite');
    });

    test('should infer sqlite from sqlite:// url', () => {
      expect(inferDialect({ url: 'sqlite://test.db' } as SQL.Options)).toBe('sqlite');
    });

    test('should infer sqlite from sqlite3:// url', () => {
      expect(inferDialect({ url: 'sqlite3://test.db' } as SQL.Options)).toBe('sqlite');
    });

    test('should infer mysql from mysql:// url', () => {
      expect(inferDialect({ url: 'mysql://localhost' } as SQL.Options)).toBe('mysql');
    });

    test('should infer mysql from mysql2:// url', () => {
      expect(inferDialect({ url: 'mysql2://localhost' } as SQL.Options)).toBe('mysql');
    });

    test('should infer postgres from postgres:// url', () => {
      expect(inferDialect({ url: 'postgres://localhost' } as SQL.Options)).toBe('postgres');
    });

    test('should infer postgres from postgresql:// url', () => {
      expect(inferDialect({ url: 'postgresql://localhost' } as SQL.Options)).toBe('postgres');
    });

    test('should infer mariadb from mariadb:// url', () => {
      expect(inferDialect({ url: 'mariadb://localhost' } as SQL.Options)).toBe('mariadb');
    });

    test('should return adapter if provided', () => {
      expect(inferDialect({ adapter: 'mysql' } as SQL.Options)).toBe('mysql');
    });

    test('should default to postgres', () => {
      expect(inferDialect({} as SQL.Options)).toBe('postgres');
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
    test('uses count when affectedRows absent', () => {
      expect(getAffectedRows(Object.assign([], { count: 3 }) as any)).toBe(3);
    });
    test('defaults to 0', () => {
      expect(getAffectedRows([] as any)).toBe(0);
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

  describe('isReservedConnection', () => {
    test('true when release is a function', () => {
      expect(isReservedConnection({ release: () => {} })).toBe(true);
    });
    test('false otherwise', () => {
      expect(isReservedConnection(null)).toBe(false);
      expect(isReservedConnection({})).toBe(false);
    });
  });

  describe('isPoolableDialect', () => {
    test('sqlite is not poolable', () => {
      expect(isPoolableDialect('sqlite')).toBe(false);
    });
    test('postgres is poolable', () => {
      expect(isPoolableDialect('postgres')).toBe(true);
    });
  });

  describe('normalizeRows', () => {
    test('coerces bigint fields to number', () => {
      const rows = [{ id: 5n }];
      expect(normalizeRows(rows as any)).toEqual([{ id: 5 }]);
    });
  });
});
