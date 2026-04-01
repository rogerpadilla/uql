import { describe, expect, it, vi } from 'vitest';
import { PostgresDialect } from '../postgres/index.js';
import { SqliteDialect } from '../sqlite/index.js';
import { BunSqlQuerierPool } from './bunSqlQuerierPool.js';

describe('BunSqlQuerierPool', () => {
  it('should initialize with correct dialect', () => {
    const pool = new BunSqlQuerierPool({ url: 'postgres://localhost' });
    expect(pool.dialect).toBeInstanceOf(PostgresDialect);
    expect(pool.dialect.features.explicitJsonCast).toBe(true);
    expect(pool.dialect.features.nativeArrays).toBe(false);
  });

  it('should initialize with sqlite dialect', () => {
    const pool = new BunSqlQuerierPool({ url: 'sqlite://:memory:' });
    expect(pool.dialect).toBeInstanceOf(SqliteDialect);
  });

  it('should support passing config with url', () => {
    const pool = new BunSqlQuerierPool({ url: 'sqlite://test.db' });
    expect(pool.sql).toBeDefined();
    expect(pool.dialect).toBeInstanceOf(SqliteDialect);
  });

  it('should support config object with adapter', () => {
    const pool = new BunSqlQuerierPool({ adapter: 'postgres', hostname: 'localhost' });
    expect(pool.sql).toBeDefined();
  });

  it('should handle cockroachdb alias', () => {
    const pool = new BunSqlQuerierPool({ adapter: 'cockroachdb', hostname: 'localhost' } as any);
    expect(pool.dialect.dialectName).toBe('cockroachdb');
  });

  describe('pool shim', () => {
    it('should provide pg-compatible query method', async () => {
      const pool = new BunSqlQuerierPool({ url: 'postgres://localhost' });
      const mockResult = [{ id: 1 }];
      (mockResult as any).affectedRows = 1;

      vi.spyOn(pool.sql, 'unsafe').mockResolvedValue(mockResult as any);

      const res = await pool.pool.query('SELECT 1', [123]);
      expect(res.rows).toEqual([{ id: 1 }]);
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

  it('should wire sqlite querier to sql without reserve', async () => {
    const pool = new BunSqlQuerierPool({ url: 'sqlite://:memory:' });
    const reserve = vi.spyOn(pool.sql, 'reserve');
    const mockRows = Object.assign([{ n: 1 }], {});
    vi.spyOn(pool.sql, 'unsafe').mockResolvedValue(mockRows as any);

    const querier = await pool.getQuerier();
    expect(reserve).not.toHaveBeenCalled();
    await querier.all('SELECT 1');
    expect((querier as any).conn).toBe(pool.sql);
    await querier.release();
  });

  it('should close the sql client on end', async () => {
    const pool = new BunSqlQuerierPool({ url: 'postgres://localhost' });
    const spy = vi.spyOn(pool.sql, 'close');
    await pool.end();
    expect(spy).toHaveBeenCalled();
  });
});
