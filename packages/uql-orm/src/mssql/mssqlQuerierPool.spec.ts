import { describe, expect, it, vi } from 'vitest';
import { MsSqlDialect } from './mssqlDialect.js';
import { MsSqlQuerierPool } from './mssqlQuerierPool.js';

vi.mock('mssql', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    ConnectionPool: class extends EventEmitter {
      connect = vi.fn().mockResolvedValue(this);
      close = vi.fn().mockResolvedValue(undefined);
      request = vi.fn();
      transaction = vi.fn();
    },
  };
});

describe('MsSqlQuerierPool', () => {
  const config = { server: 'localhost', database: 'test' };

  it('should build a SQL Server dialect from the pool options', () => {
    const pool = new MsSqlQuerierPool(config);

    expect(pool.dialect).toBeInstanceOf(MsSqlDialect);
    expect(pool.dialect.dialectName).toBe('mssql');
  });

  it('should pass the naming strategy and schema through to the dialect', () => {
    const pool = new MsSqlQuerierPool(config, { schema: 'crm' });

    expect(pool.dialect.resolveSchema({ schema: undefined } as never)).toBe('crm');
  });

  /** `mssql` connects the pool as a whole rather than per checkout, so two queriers share one connect. */
  it('should connect once however many queriers are taken', async () => {
    const pool = new MsSqlQuerierPool(config);
    const [first, second] = [await pool.getQuerier(), await pool.getQuerier()];

    await first.all('SELECT 1').catch(() => undefined);
    await second.all('SELECT 1').catch(() => undefined);

    expect(pool.pool.connect).toHaveBeenCalledOnce();
  });

  /** Memoized, one transient failure would be handed to every later caller for the pool's life. */
  it('should not keep a failed connection attempt', async () => {
    const pool = new MsSqlQuerierPool(config);
    pool.pool.connect = vi.fn().mockRejectedValueOnce(new Error('unreachable')).mockResolvedValue(pool.pool);

    await expect((await pool.getQuerier()).all('SELECT 1')).rejects.toThrow('unreachable');
    await expect((await pool.getQuerier()).all('SELECT 1')).rejects.not.toThrow('unreachable');
    expect(pool.pool.connect).toHaveBeenCalledTimes(2);
  });

  /** `mssql` emits `error` when a pooled connection fails, and an unheard `error` event ends the process. */
  it('should keep a failed pooled connection from crashing the process', () => {
    const pool = new MsSqlQuerierPool(config);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => pool.pool.emit('error', new Error('socket hang up'))).not.toThrow();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('SQL Server'), expect.any(Error));
    consoleSpy.mockRestore();
  });

  it('should close the underlying pool on end', async () => {
    const pool = new MsSqlQuerierPool(config);
    await pool.end();

    expect(pool.pool.close).toHaveBeenCalledOnce();
  });
});
