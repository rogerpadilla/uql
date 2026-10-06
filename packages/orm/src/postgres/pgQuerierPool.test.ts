import { describe, expect, it } from 'vitest';
import { Entity, Id } from '../entity/index.js';
import { AbstractSqlQuerierPoolIt } from '../querier/abstractSqlQuerierPool-test.js';
import { createSpec, postgresConnection } from '../test/index.js';
import type { PgQuerier } from './pgQuerier.js';
import { PgQuerierPool } from './pgQuerierPool.js';

export class PostgresQuerierPoolIt extends AbstractSqlQuerierPoolIt<PgQuerier> {
  constructor() {
    super(() => new PgQuerierPool(postgresConnection()));
  }
}

createSpec(new PostgresQuerierPoolIt());

/** Declared only here, so no suite's fixture creates its table. */
@Entity({ name: 'uql_never_created' })
class NeverCreated {
  @Id({ type: Number }) id?: number;
}

describe('PgQuerierPool', () => {
  /** A catalog that does not know the table answers no row, which is nothing counted. */
  it('should estimate no rows for a table that does not exist', async () => {
    const pool = new PgQuerierPool(postgresConnection());
    await pool.run('DROP TABLE IF EXISTS "uql_never_created"');

    expect(await pool.estimatedCount(NeverCreated)).toBe(0);
    await pool.end();
  });

  /** A statement sent past the querier's own entry points, which connect first, finds no connection taken. */
  it('should refuse a statement on a querier that took no connection', async () => {
    const pool = new PgQuerierPool(postgresConnection());
    const querier = await pool.getQuerier();

    await expect(querier.internalAll('SELECT 1')).rejects.toThrow('pool querier not connected');
    await pool.end();
  });

  /** A querier left in a transaction proves its client healthy by rolling back, and the pool keeps it. */
  it('should keep a client whose transaction rolled back at release', async () => {
    const pool = new PgQuerierPool(postgresConnection(), { logger: false });
    const querier = await pool.getQuerier();
    await querier.beginTransaction();

    await querier.release();

    expect([pool.pool.totalCount, pool.pool.idleCount]).toEqual([1, 1]);
    await pool.end();
  });

  /**
   * The server dropping a client a querier holds makes it emit `error` with no statement to report it to,
   * which unheard would end the process; the rollback at release fails instead, and the pool evicts it.
   */
  it('should evict a client the server dropped while a querier held it', async () => {
    const pool = new PgQuerierPool(postgresConnection(), { logger: false });
    const querier = await pool.getQuerier();
    await querier.beginTransaction();
    await expect(querier.all('SELECT pg_terminate_backend(pg_backend_pid())')).rejects.toThrow();

    await querier.release();

    expect(pool.pool.totalCount).toBe(0);
    expect(await pool.all('SELECT 1 AS one')).toEqual([{ one: 1 }]);
    await pool.end();
  });
});
