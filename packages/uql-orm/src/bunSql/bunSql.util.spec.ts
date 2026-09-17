import { describe, expect, test } from 'vitest';
import type { RawRow } from '../type/index.js';
import { type BunSqlHeader, getAffectedRows, getInsertId, inferDialectName, normalizeBunOpts } from './bunSql.util.js';

/** A `bun:sql` result: the rows, carrying the header fields its adapter filled. */
function result(header: BunSqlHeader, rows: RawRow[] = []) {
  return Object.assign(rows, header);
}

describe('bunSql.util', () => {
  describe('inferDialectName', () => {
    test('should infer mysql from mysql:// url', () => {
      expect(inferDialectName({ url: 'mysql://localhost' })).toBe('mysql');
    });

    test('should infer mysql from mysql2:// url', () => {
      expect(inferDialectName({ url: 'mysql2://localhost' })).toBe('mysql');
    });

    test('should infer postgres from postgres:// url', () => {
      expect(inferDialectName({ url: 'postgres://localhost' })).toBe('postgres');
    });

    test('should infer postgres from postgresql:// url', () => {
      expect(inferDialectName({ url: 'postgresql://localhost' })).toBe('postgres');
    });

    test('should infer mariadb from mariadb:// url', () => {
      expect(inferDialectName({ url: 'mariadb://localhost' })).toBe('mariadb');
    });

    test('should return adapter if provided', () => {
      expect(inferDialectName({ adapter: 'mysql' })).toBe('mysql');
    });

    test('should default to postgres', () => {
      expect(inferDialectName({})).toBe('postgres');
    });

    test('should not take an inherited object key for a scheme', () => {
      expect(inferDialectName({ url: 'constructor://localhost' })).toBe('postgres');
    });

    test('should refuse an engine it does not drive rather than reading it as postgres', () => {
      expect(() => inferDialectName({ url: 'mssql://localhost' })).toThrow(
        'uql-orm/bunSql does not drive mssql; use the dedicated uql-orm/mssql pool',
      );
      expect(() => inferDialectName({ url: 'sqlserver://localhost' })).toThrow('uql-orm/mssql pool');
    });

    /** `Sqlite3QuerierPool` runs on `bun:sqlite` under Bun, and streams, prepares and loads extensions. */
    test('should refuse SQLite, pointing at its own pool', () => {
      const refusal = 'uql-orm/bunSql does not drive sqlite; use the dedicated uql-orm/sqlite pool';
      expect(() => inferDialectName({ filename: 'app.db' })).toThrow(refusal);
      expect(() => inferDialectName({ url: ':memory:' })).toThrow(refusal);
      expect(() => inferDialectName({ url: 'sqlite://app.db' })).toThrow(refusal);
      expect(() => inferDialectName({ url: 'sqlite3://app.db' })).toThrow(refusal);
      expect(() => inferDialectName({ url: 'data/app.sqlite' })).toThrow(refusal);
    });
  });

  describe('normalizeBunOpts', () => {
    test('should map cockroachdb to the postgres adapter', () => {
      expect(normalizeBunOpts({ hostname: 'h' }, 'cockroachdb').adapter).toBe('postgres');
    });

    test('should leave the url absent when none was given', () => {
      expect(normalizeBunOpts({ adapter: 'postgres', hostname: 'h' }, 'postgres').url).toBeUndefined();
    });

    test('should strip sslmode=no-verify from a string url and set tls', () => {
      const opts = normalizeBunOpts({ url: 'postgres://localhost/?sslmode=no-verify' }, 'postgres');
      expect(String(opts.url)).not.toContain('sslmode=no-verify');
      expect(opts.tls).toMatchObject({ rejectUnauthorized: false });
    });

    test('should strip sslmode=no-verify from a URL instance and merge tls', () => {
      const url = new URL('postgres://localhost/');
      url.searchParams.set('sslmode', 'no-verify');
      const opts = normalizeBunOpts({ url, tls: { ca: 'x' } }, 'postgres');
      expect(String(opts.url)).not.toContain('sslmode=no-verify');
      expect(opts.tls).toEqual({ rejectUnauthorized: false, ca: 'x' });
    });

    test('should keep an invalid url as it was given', () => {
      expect(normalizeBunOpts({ url: '::not-a-url' }, 'postgres').url).toBe('::not-a-url');
    });

    test('should read a BIGINT as a bigint whatever the config asks, for the querier to decode exactly', () => {
      expect(normalizeBunOpts({ hostname: 'h', bigint: false }, 'postgres').bigint).toBe(true);
    });
  });

  describe('getAffectedRows', () => {
    test('should prefer affectedRows over count', () => {
      expect(getAffectedRows(result({ affectedRows: 2, count: 1 }))).toBe(2);
    });

    test('should use count when the adapter leaves affectedRows null (postgres, cockroachdb)', () => {
      expect(getAffectedRows(result({ count: 3, affectedRows: null }))).toBe(3);
    });

    test('should use count when a mysql read reports affectedRows 0', () => {
      expect(getAffectedRows(result({ count: 2, affectedRows: 0 }, [{}, {}]))).toBe(2);
    });

    test('should count the rows a returning insert wrote, not the rows it returned', () => {
      expect(getAffectedRows(result({ count: 1, affectedRows: null }, [{}]))).toBe(1);
    });

    test('should report nothing when the header carries neither, leaving the rows to answer', () => {
      expect(getAffectedRows(result({}))).toBeUndefined();
      expect(getAffectedRows(result({}, [{}]))).toBeUndefined();
    });
  });

  describe('getInsertId', () => {
    test('should coerce bigint to number', () => {
      expect(getInsertId(result({ lastInsertRowid: 99n }))).toBe(99);
    });

    test('should answer the exact text for an id past 2^53', () => {
      expect(getInsertId(result({ lastInsertRowid: 9007199254740993n }))).toBe('9007199254740993');
    });

    test('should return numeric id as-is', () => {
      expect(getInsertId(result({ lastInsertRowid: 7 }))).toBe(7);
    });
  });
});
