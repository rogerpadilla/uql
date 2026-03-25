import { describe, expect, it, vi } from 'vitest';
import type { AbstractSqlDialect } from '../dialect/index.js';
import { MySqlDialect } from '../mysql/index.js';
import { PostgresDialect } from '../postgres/index.js';
import { SqliteDialect } from '../sqlite/index.js';
import { BunSqlQuerier } from './bunSqlQuerier.js';

function makeSql(result: object) {
  const res = Object.assign(Array.isArray(result) ? result : [], result);
  const conn = {
    unsafe: vi.fn().mockResolvedValue(res),
    release: vi.fn(),
  };
  return {
    reserve: vi.fn().mockResolvedValue(conn),
    close: vi.fn(),
    conn,
  };
}

function createQuerier(sql: any, dialect: AbstractSqlDialect) {
  return new BunSqlQuerier(sql, dialect, () => sql.reserve());
}

describe('BunSqlQuerier', () => {
  describe('run', () => {
    it('should use "last" insertIdStrategy for sqlite', async () => {
      // lastInsertRowid=42, changes=1 → firstId = 42 - (1-1) = 42
      const querier = createQuerier(makeSql({ count: 1, lastInsertRowid: 42 }), new SqliteDialect());
      const res = await querier.run('INSERT...');
      expect(res.firstId).toBe(42);
      expect(res.changes).toBe(1);
    });

    it('should use "last" insertIdStrategy for postgres', async () => {
      const querier = createQuerier(makeSql({ count: 1, lastInsertRowid: 7 }), new PostgresDialect());
      const res = await querier.run('INSERT...');
      expect(res.firstId).toBe(7);
    });

    it('should use "first" insertIdStrategy for mysql', async () => {
      // 'first': firstId = Number(lastInsertRowid) directly (no offset)
      const querier = createQuerier(makeSql({ affectedRows: 3, lastInsertRowid: 10 }), new MySqlDialect());
      const res = await querier.run('INSERT...');
      expect(res.firstId).toBe(10);
      expect(res.changes).toBe(3);
    });

    it('should support bigint IDs', async () => {
      const querier = createQuerier(makeSql({ count: 1, lastInsertRowid: 9007199254740991n }), new SqliteDialect());
      const res = await querier.run('INSERT...');
      expect(res.firstId).toBe(9007199254740991);
    });

    it('should fallback affectedRows when count is absent', async () => {
      const querier = createQuerier(makeSql({ affectedRows: 5 }), new SqliteDialect());
      const res = await querier.run('UPDATE...');
      expect(res.changes).toBe(5);
    });

    it('should return 0 changes when result is empty', async () => {
      const querier = createQuerier(makeSql({}), new SqliteDialect());
      const res = await querier.run('DELETE...');
      expect(res.changes).toBe(0);
    });
  });

  describe('all', () => {
    it('should return all rows', async () => {
      const rows = [{ id: 1, name: 'foo' }];
      const querier = createQuerier(makeSql(rows), new SqliteDialect());
      const res = await querier.all('SELECT...');
      expect(res).toEqual(rows);
    });

    it('should handle bigint in rows', async () => {
      const rows = [{ id: 9007199254740991n }];
      const querier = createQuerier(makeSql(rows), new SqliteDialect());
      const res = await querier.all('SELECT...');
      expect(res).toEqual([{ id: 9007199254740991 }]);
    });
  });

  describe('release', () => {
    it('should release the connection', async () => {
      const sql = makeSql({});
      const querier = createQuerier(sql, new SqliteDialect());
      await querier.run('INSERT...'); // connect
      const conn = (querier as any).conn;
      expect(conn).toBeDefined();

      await querier.release();
      expect(conn.release).toHaveBeenCalled();
      expect((querier as any).conn).toBeUndefined();
    });

    it('should throw if releasing with a transaction', async () => {
      const querier = createQuerier(makeSql({}), new SqliteDialect());
      Object.defineProperty(querier, 'hasOpenTransaction', { get: () => true });
      await expect(querier.release()).rejects.toThrow('pending transaction');
    });
  });
});
