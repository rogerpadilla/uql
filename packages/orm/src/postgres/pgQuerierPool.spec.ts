import { describe, expect, it, onTestFinished } from 'vitest';
import { postgresConnection } from '../test/index.js';
import { PgQuerierPool } from './pgQuerierPool.js';

describe('PgQuerierPool', () => {
  /** A statement sent past the querier's own entry points, which connect first, finds no connection taken. */
  it('should refuse a statement on a querier that took no connection', async () => {
    const pool = new PgQuerierPool(postgresConnection());
    onTestFinished(() => pool.end());
    const querier = await pool.getQuerier();

    await expect(querier.internalAll('SELECT 1')).rejects.toThrow('pool querier not connected');
  });
});
