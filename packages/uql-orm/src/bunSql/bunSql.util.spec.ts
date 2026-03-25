import type { SQL } from 'bun';
import { describe, expect, test } from 'vitest';
import { inferDialect, normalizeBunOpts } from './bunSql.util.js';

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
  });
});
