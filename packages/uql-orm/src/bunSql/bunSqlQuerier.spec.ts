import type { SQL } from 'bun';
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

function createQuerier(sql: ReturnType<typeof makeSql>, dialect: AbstractSqlDialect) {
  return new BunSqlQuerier(sql as unknown as SQL, dialect, () => sql.reserve());
}

/** Reaches into the protected `conn` field to assert connection lifecycle in tests. */
function getConn(querier: BunSqlQuerier) {
  return (querier as unknown as { conn?: ReturnType<typeof makeSql>['conn'] }).conn;
}

describe('BunSqlQuerier', () => {
  describe('run', () => {
    it('should ignore header ids for sqlite ("returning" source: rows are the truth)', async () => {
      // SQLite's dialect appends RETURNING, so a header-only result (no rows) means no id is known.
      const querier = createQuerier(makeSql({ count: 1, lastInsertRowid: 42 }), new SqliteDialect());
      const res = await querier.run('INSERT...');
      expect(res.firstId).toBeUndefined();
      expect(res.ids).toEqual([]);
      expect(res.changes).toBe(1);
    });

    it('should use RETURNING rows for sqlite ids', async () => {
      const querier = createQuerier(makeSql([{ id: 42 }]), new SqliteDialect());
      const res = await querier.run('INSERT... RETURNING `id` `id`');
      expect(res.firstId).toBe(42);
      expect(res.ids).toEqual([42]);
      expect(res.changes).toBe(1);
    });

    it('should ignore header ids for postgres ("returning" source: rows are the truth)', async () => {
      const querier = createQuerier(makeSql({ count: 1, lastInsertRowid: 7 }), new PostgresDialect());
      const res = await querier.run('INSERT...');
      expect(res.firstId).toBeUndefined();
      expect(res.ids).toEqual([]);
      expect(res.changes).toBe(1);
    });

    it('should use the "firstId" source for mysql', async () => {
      // 'firstId': firstId = Number(lastInsertRowid) directly (no offset)
      const querier = createQuerier(makeSql({ affectedRows: 3, lastInsertRowid: 10 }), new MySqlDialect());
      const res = await querier.run('INSERT...');
      expect(res.firstId).toBe(10);
      expect(res.changes).toBe(3);
    });

    it('should support bigint IDs in RETURNING rows', async () => {
      const querier = createQuerier(makeSql([{ id: 9007199254740991n }]), new SqliteDialect());
      const res = await querier.run('INSERT... RETURNING `id` `id`');
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
      const conn = getConn(querier);
      expect(conn).toBeDefined();

      await querier.release();
      expect(conn?.release).toHaveBeenCalled();
      expect(getConn(querier)).toBeUndefined();
    });

    it('should skip release when connection has no release method', async () => {
      const conn = { unsafe: vi.fn().mockResolvedValue([]) };
      const sql = { reserve: vi.fn().mockResolvedValue(conn) };
      const querier = new BunSqlQuerier(sql as unknown as SQL, new SqliteDialect(), () => sql.reserve());
      await querier.run('SELECT 1');
      await expect(querier.release()).resolves.toBeUndefined();
    });

    it('should roll back an open transaction rather than refuse to release', async () => {
      const sql = makeSql({});
      const querier = createQuerier(sql, new SqliteDialect());
      await querier.beginTransaction();

      await expect(querier.release()).resolves.toBeUndefined();

      expect(querier.hasOpenTransaction).toBe(false);
      expect(sql.conn.unsafe).toHaveBeenCalledWith('ROLLBACK', undefined);
      expect(sql.conn.release).toHaveBeenCalled();
    });
  });
});
