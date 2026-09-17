import { describe, expect, it, vi } from 'vitest';
import { PostgresDialect } from '../postgres/index.js';
import { assertDefined } from '../test/index.js';
import { BunSqlQuerier } from './bunSqlQuerier.js';
import { BunSqlQuerierPool } from './bunSqlQuerierPool.js';

describe('BunSqlQuerierPool', () => {
  it('should initialize with correct dialect', () => {
    const pool = new BunSqlQuerierPool({ url: 'postgres://localhost' });
    expect(pool.dialect).toBeInstanceOf(PostgresDialect);
    expect(pool.dialect).toMatchObject({ driverCapabilities: { explicitJsonCast: true, nativeArrays: false } });
  });

  it('should support config object with adapter', () => {
    const pool = new BunSqlQuerierPool({ adapter: 'postgres', hostname: 'localhost' });
    expect(pool.sql).toBeDefined();
  });

  it('should handle cockroachdb', () => {
    const pool = new BunSqlQuerierPool({ url: 'cockroachdb://localhost' });
    expect(pool.dialect.dialectName).toBe('cockroachdb');
    // bun:sql routes CockroachDB through its own Postgres wire-protocol implementation, so it
    // needs the identical wire-driver-capability fix as postgres (verified live: without it,
    // $set/$push on a JSONB column silently produce the wrong value or throw).
    expect(pool.dialect).toMatchObject({ driverCapabilities: { explicitJsonCast: true, nativeArrays: false } });
  });

  /** `Sqlite3QuerierPool` runs on `bun:sqlite` under Bun, so SQLite is refused here rather than half-served. */
  it('should refuse SQLite, pointing at its own pool', () => {
    expect(() => new BunSqlQuerierPool({ url: 'sqlite://:memory:' })).toThrow('uql-orm/sqlite pool');
  });

  describe('pool shim', () => {
    it('should provide pg-compatible query method', async () => {
      const pool = new BunSqlQuerierPool({ url: 'postgres://localhost' });
      vi.spyOn(pool.sql, 'unsafe').mockResolvedValue(Object.assign([{ id: 1 }], { affectedRows: 1 }));

      const res = await pool.pool.query('SELECT 1', [123]);
      expect(res.rows).toEqual([{ id: 1 }]);
      expect(res.rowCount).toBe(1);
      expect(pool.sql.unsafe).toHaveBeenCalledWith('SELECT 1', [123]);
    });

    it('should provide no-op event listeners', () => {
      const pool = new BunSqlQuerierPool({ url: 'postgres://localhost' });
      const { on } = pool.pool;
      assertDefined(on);
      expect(() => on('error', () => {})).not.toThrow();
    });
  });

  it('should return a BunSqlQuerier', async () => {
    const pool = new BunSqlQuerierPool({ url: 'postgres://localhost' });
    expect(await pool.getQuerier()).toBeInstanceOf(BunSqlQuerier);
  });

  it('should close the sql client on end', async () => {
    const pool = new BunSqlQuerierPool({ url: 'postgres://localhost' });
    const spy = vi.spyOn(pool.sql, 'close');
    await pool.end();
    expect(spy).toHaveBeenCalled();
  });
});
