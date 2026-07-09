import { expect } from 'vitest';
import type { AbstractSqlDialect } from '../dialect/index.js';
import type { SqlQuerier } from '../type/index.js';
import { AbstractQuerierPoolIt } from './abstractQuerierPool-test.js';
import type { AbstractSqlQuerierPool } from './abstractSqlQuerierPool.js';

/**
 * Integration suite for SQL pools; extends the generic pool suite with the raw-SQL surface
 * (`pool.all`/`pool.run`), mirroring {@link AbstractSqlQuerierPool} over {@link AbstractQuerierPoolIt}.
 */
export abstract class AbstractSqlQuerierPoolIt<Q extends SqlQuerier> extends AbstractQuerierPoolIt<Q> {
  protected declare pool: AbstractSqlQuerierPool<Q, AbstractSqlDialect>;

  // biome-ignore lint/complexity/noUselessConstructor: narrows the accepted pool type to SQL pools, keeping the `declare` retype of `this.pool` sound
  constructor(pool: AbstractSqlQuerierPool<Q, AbstractSqlDialect>) {
    super(pool);
  }

  async shouldRunRawSqlOnThePool() {
    await this.pool.run('DROP TABLE IF EXISTS pool_raw_it');
    await this.pool.run('CREATE TABLE pool_raw_it (id INTEGER, name VARCHAR(20))');
    try {
      const inserted = await this.pool.run(`INSERT INTO pool_raw_it (id, name) VALUES (1, 'one')`);
      expect(inserted.changes).toBe(1);
      // Concurrent pool-level reads - each call is its own acquire/run/release unit of work.
      const [rows1, rows2] = await Promise.all([
        this.pool.all<{ id: number }>('SELECT id FROM pool_raw_it'),
        this.pool.all<{ id: number }>('SELECT id FROM pool_raw_it'),
      ]);
      expect(rows1).toEqual([{ id: 1 }]);
      expect(rows2).toEqual([{ id: 1 }]);
    } finally {
      await this.pool.run('DROP TABLE pool_raw_it');
    }
  }
}
