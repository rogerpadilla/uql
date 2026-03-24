import { SQL } from 'bun';
import { describe, expect, it, vi } from 'vitest';
import { PostgresDialect } from '../postgres/index.js';
import { SqliteDialect } from '../sqlite/index.js';
import { BunSqlQuerierPool } from './bunSqlQuerierPool.js';

describe('BunSqlQuerierPool', () => {
  it('should initialize with correct dialect', () => {
    const pool = new BunSqlQuerierPool({ url: 'postgres://localhost' });
    expect(pool.dialectInstance).toBeInstanceOf(PostgresDialect);
  });

  it('should initialize with sqlite dialect', () => {
    const pool = new BunSqlQuerierPool({ url: 'sqlite://:memory:' });
    expect(pool.dialectInstance).toBeInstanceOf(SqliteDialect);
  });

  it('should support passing config with url', () => {
    const sql = new SQL('sqlite://test.db');
    const pool = new BunSqlQuerierPool({ url: 'sqlite://test.db' });
    expect(pool.sql.options.adapter).toBe(sql.options.adapter);
  });

  it('should support config object with adapter', () => {
    const pool = new BunSqlQuerierPool({ adapter: 'postgres', hostname: 'localhost' });
    expect(pool.sql).toBeDefined();
  });

  it('should handle cockroachdb alias', () => {
    const pool = new BunSqlQuerierPool({ adapter: 'cockroachdb', hostname: 'localhost' } as any);
    expect(pool.dialectInstance.dialect).toBe('cockroachdb');
  });

  describe('pool shim', () => {
    it('should provide pg-compatible query method', async () => {
      const pool = new BunSqlQuerierPool({ url: 'postgres://localhost' });
      const mockResult = [{ id: 1 }];
      (mockResult as any).affectedRows = 1;

      vi.spyOn(pool.sql, 'unsafe').mockResolvedValue(mockResult as any);

      const res = await pool.pool.query('SELECT 1', [123]);
      expect(res.rows).toBe(mockResult);
      expect(res.rowCount).toBe(1);
      expect(pool.sql.unsafe).toHaveBeenCalledWith('SELECT 1', [123]);
    });

    it('should provide no-op event listeners', () => {
      const pool = new BunSqlQuerierPool({ url: 'postgres://localhost' });
      expect(() => pool.pool.on!('error', () => {})).not.toThrow();
    });
  });

  it('should return a BunSqlQuerier', async () => {
    const pool = new BunSqlQuerierPool({ url: 'postgres://localhost' });
    const querier = await pool.getQuerier();
    expect(querier).toBeDefined();
    expect(querier.sql).toBe(pool.sql);
  });

  it('should close the sql client on end', async () => {
    const pool = new BunSqlQuerierPool({ url: 'postgres://localhost' });
    const spy = vi.spyOn(pool.sql, 'close');
    await pool.end();
    expect(spy).toHaveBeenCalled();
  });
});
