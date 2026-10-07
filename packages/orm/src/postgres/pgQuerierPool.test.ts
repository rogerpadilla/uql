import { describe, expect, it, onTestFinished } from 'vitest';
import { SqlQuerierPoolIt } from '../querier/abstractSqlQuerierPool-test.js';
import { createSpec, postgresConnection } from '../test/index.js';
import { PgQuerierPool } from './pgQuerierPool.js';

createSpec(new SqlQuerierPoolIt(() => new PgQuerierPool(postgresConnection())));

describe('PgQuerierPool', () => {
  /** A querier left in a transaction proves its client healthy by rolling back, and the pool keeps it. */
  it('should keep a client whose transaction rolled back at release', async () => {
    const pool = new PgQuerierPool(postgresConnection(), { logger: false });
    onTestFinished(() => pool.end());
    const querier = await pool.getQuerier();
    await querier.beginTransaction();

    await querier.release();

    expect([pool.pool.totalCount, pool.pool.idleCount]).toEqual([1, 1]);
  });

  /**
   * The server dropping a client a querier holds makes it emit `error` with no statement to report it to,
   * which unheard would end the process; the rollback at release fails instead, and the pool evicts it.
   */
  it('should evict a client the server dropped while a querier held it', async () => {
    const pool = new PgQuerierPool(postgresConnection(), { logger: false });
    onTestFinished(() => pool.end());
    const querier = await pool.getQuerier();
    await querier.beginTransaction();
    await expect(querier.all('SELECT pg_terminate_backend(pg_backend_pid())')).rejects.toThrow();

    await querier.release();

    expect(pool.pool.totalCount).toBe(0);
    expect(await pool.all('SELECT 1 AS one')).toEqual([{ one: 1 }]);
  });
});
