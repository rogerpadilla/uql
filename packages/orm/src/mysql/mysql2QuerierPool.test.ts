import { describe, expect, it } from 'vitest';
import { AbstractSqlQuerierPoolIt } from '../querier/abstractSqlQuerierPool-test.js';
import { createSpec, mysqlConnection } from '../test/index.js';
import type { MySql2Querier } from './mysql2Querier.js';
import { MySql2QuerierPool } from './mysql2QuerierPool.js';

export class MySql2QuerierPoolIt extends AbstractSqlQuerierPoolIt<MySql2Querier> {
  constructor() {
    super(() => new MySql2QuerierPool(mysqlConnection()));
  }
}

createSpec(new MySql2QuerierPoolIt());

describe('MySql2QuerierPool', () => {
  /** A rollback that fails leaves a session nothing here can name, so the connection is dropped, not reused. */
  it('should drop a connection whose rollback failed at release, and serve on a new one', async () => {
    const pool = new MySql2QuerierPool({ ...mysqlConnection(), connectionLimit: 1 }, { logger: false });
    const querier = await pool.getQuerier();
    const [{ id }] = await querier.all<{ id: number }>('SELECT CONNECTION_ID() AS id');
    await querier.beginTransaction();
    await expect(querier.all(`KILL ${id}`)).rejects.toThrow();

    await querier.release();

    const [next] = await pool.all<{ id: number; tz: string }>(
      'SELECT CONNECTION_ID() AS id, @@session.time_zone AS tz',
    );
    expect(next.id).not.toBe(id);
    expect(next.tz).toBe('+00:00');
    await pool.end();
  });
});
