import { describe, expect, it, vi } from 'vitest';
import type { AbstractSqlDialect } from '../dialect/index.js';
import { MySqlDialect } from '../mysql/index.js';
import { PostgresDialect } from '../postgres/index.js';
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

function createQuerier(sql: ReturnType<typeof makeSql>, dialect: AbstractSqlDialect) {
  return new BunSqlQuerier(() => sql.reserve(), dialect);
}

describe('BunSqlQuerier', () => {
  describe('run', () => {
    it('should ignore header ids for postgres ("returning" source: rows are the truth)', async () => {
      const querier = createQuerier(makeSql({ count: 1, lastInsertRowid: 7 }), new PostgresDialect());
      const res = await querier.run('INSERT...');
      expect(res.firstId).toBeUndefined();
      expect(res.ids).toEqual([]);
      expect(res.changes).toBe(1);
    });

    it('should use RETURNING rows for postgres ids', async () => {
      const querier = createQuerier(makeSql([{ id: 42 }]), new PostgresDialect());
      const res = await querier.run('INSERT... RETURNING "id"');
      expect(res.firstId).toBe(42);
      expect(res.ids).toEqual([42]);
      expect(res.changes).toBe(1);
    });

    it('should use the "firstId" source for mysql', async () => {
      // 'firstId': firstId = Number(lastInsertRowid) directly (no offset)
      const querier = createQuerier(makeSql({ affectedRows: 3, lastInsertRowid: 10 }), new MySqlDialect());
      const res = await querier.run('INSERT...');
      expect(res.firstId).toBe(10);
      expect(res.changes).toBe(3);
    });

    it('should decode bigint ids in RETURNING rows', async () => {
      const querier = createQuerier(makeSql([{ id: 9007199254740991n }]), new PostgresDialect());
      const res = await querier.run('INSERT... RETURNING "id"');
      expect(res.firstId).toBe(9007199254740991);
    });

    it('should fall back to affectedRows when count is absent', async () => {
      const querier = createQuerier(makeSql({ affectedRows: 5 }), new MySqlDialect());
      const res = await querier.run('UPDATE...');
      expect(res.changes).toBe(5);
    });

    it('should return 0 changes when result is empty', async () => {
      const querier = createQuerier(makeSql({}), new PostgresDialect());
      const res = await querier.run('DELETE...');
      expect(res.changes).toBe(0);
    });
  });

  describe('all', () => {
    it('should return all rows', async () => {
      const rows = [{ id: 1, name: 'foo' }];
      const querier = createQuerier(makeSql(rows), new PostgresDialect());
      const res = await querier.all('SELECT...');
      expect(res).toEqual(rows);
    });

    it('should handle bigint in rows', async () => {
      const rows = [{ id: 9007199254740991n }];
      const querier = createQuerier(makeSql(rows), new PostgresDialect());
      const res = await querier.all('SELECT...');
      expect(res).toEqual([{ id: 9007199254740991 }]);
    });
  });

  describe('release', () => {
    it('should release the connection it reserved', async () => {
      const sql = makeSql({});
      const querier = createQuerier(sql, new PostgresDialect());
      await querier.run('INSERT...');

      await querier.release();

      expect(sql.reserve).toHaveBeenCalledTimes(1);
      expect(sql.conn.release).toHaveBeenCalled();
    });

    it('should roll back an open transaction rather than refuse to release', async () => {
      const sql = makeSql({});
      const querier = createQuerier(sql, new PostgresDialect());
      await querier.beginTransaction();

      await expect(querier.release()).resolves.toBeUndefined();

      expect(querier.hasOpenTransaction).toBe(false);
      expect(sql.conn.unsafe).toHaveBeenCalledWith('ROLLBACK', undefined);
      expect(sql.conn.release).toHaveBeenCalled();
    });
  });
});
