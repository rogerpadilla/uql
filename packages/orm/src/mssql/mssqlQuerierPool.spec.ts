import { describe, expect, it } from 'vitest';
import { mssqlConnection } from '../test/index.js';
import { MsSqlQuerierPool } from './mssqlQuerierPool.js';

describe('MsSqlQuerierPool', () => {
  /** `mssql` emits `error` when a pooled connection fails, and an unheard `error` event ends the process. */
  it('should log a failed pooled connection rather than crash', async () => {
    const logged: string[] = [];
    const pool = new MsSqlQuerierPool(mssqlConnection(), { logger: { logError: (message) => logged.push(message) } });

    pool.pool.emit('error', new Error('socket hang up'));

    expect(logged).toEqual(['Idle SQL Server pool connection encountered an error']);
    await pool.end();
  });
});
