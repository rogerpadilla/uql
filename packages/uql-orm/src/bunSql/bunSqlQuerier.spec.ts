import { describe, expect, it, vi } from 'vitest';
import { MySqlDialect } from '../mysql/index.js';
import { PostgresDialect } from '../postgres/index.js';
import { SqliteDialect } from '../sqlite/index.js';
import { BunSqlQuerier } from './bunSqlQuerier.js';

function makeSql(result: object) {
  return { unsafe: vi.fn().mockResolvedValue(result) } as any;
}

describe('BunSqlQuerier', () => {
  describe('internalRun', () => {
    it('should use "last" insertIdStrategy for sqlite', async () => {
      // lastInsertRowid=42, changes=1 → firstId = 42 - (1-1) = 42
      const querier = new BunSqlQuerier(makeSql({ count: 1, lastInsertRowid: 42 }), new SqliteDialect());
      const res = await querier.internalRun('INSERT...');
      expect(res.firstId).toBe(42);
      expect(res.changes).toBe(1);
    });

    it('should use "last" insertIdStrategy for postgres', async () => {
      const querier = new BunSqlQuerier(makeSql({ count: 1, lastInsertRowid: 7 }), new PostgresDialect());
      const res = await querier.internalRun('INSERT...');
      expect(res.firstId).toBe(7);
    });

    it('should use "first" insertIdStrategy for mysql', async () => {
      // 'first': firstId = Number(lastInsertRowid) directly (no offset)
      const querier = new BunSqlQuerier(makeSql({ affectedRows: 3, lastInsertRowid: 10 }), new MySqlDialect());
      const res = await querier.internalRun('INSERT...');
      expect(res.firstId).toBe(10);
      expect(res.changes).toBe(3);
    });

    it('should fallback affectedRows when count is absent', async () => {
      const querier = new BunSqlQuerier(makeSql({ affectedRows: 5 }), new SqliteDialect());
      const res = await querier.internalRun('UPDATE...');
      expect(res.changes).toBe(5);
    });

    it('should return 0 changes when result is empty', async () => {
      const querier = new BunSqlQuerier(makeSql({}), new SqliteDialect());
      const res = await querier.internalRun('DELETE...');
      expect(res.changes).toBe(0);
    });
  });

  describe('internalRelease', () => {
    it('should throw when a transaction is pending', async () => {
      const querier = new BunSqlQuerier(makeSql({}), new SqliteDialect());
      Object.defineProperty(querier, 'hasOpenTransaction', { get: () => true });
      await expect(querier.internalRelease()).rejects.toThrow('pending transaction');
    });

    it('should resolve cleanly without a pending transaction', async () => {
      const querier = new BunSqlQuerier(makeSql({}), new SqliteDialect());
      await expect(querier.internalRelease()).resolves.toBeUndefined();
    });
  });
});
