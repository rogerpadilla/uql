import { expect, onTestFinished } from 'vitest';
import type { AbstractSqlDialect } from '../dialect/index.js';
import type { SqlQuerier } from '../type/index.js';
import { sql } from '../util/sql.js';

import { QuerierPoolIt } from './abstractQuerierPool-test.js';
import type { AbstractSqlQuerierPool } from './abstractSqlQuerierPool.js';

/** The pool suite, and the raw-SQL surface a SQL pool adds (`pool.all`/`pool.run`). */
export class SqlQuerierPoolIt extends QuerierPoolIt<AbstractSqlQuerierPool<SqlQuerier, AbstractSqlDialect>> {
  /** One that needs no table, so only a released querier or an ended pool refuses it. */
  protected override statementOn(querier: SqlQuerier): Promise<unknown> {
    return querier.all`SELECT 1`;
  }

  async shouldRunRawSqlOnThePool() {
    await this.pool.run`DROP TABLE IF EXISTS pool_raw_it`;
    await this.pool.run`CREATE TABLE pool_raw_it (id INTEGER, name VARCHAR(20))`;
    onTestFinished(async () => {
      await this.pool.run`DROP TABLE pool_raw_it`;
    });

    const inserted = await this.pool.run`INSERT INTO pool_raw_it (id, name) VALUES (1, 'one')`;
    // Concurrent pool-level reads, each call its own acquire/run/release unit of work.
    const reads = await Promise.all([
      this.pool.all<{ id: number }>`SELECT id FROM pool_raw_it`,
      this.pool.all<{ id: number }>`SELECT id FROM pool_raw_it`,
    ]);

    expect(inserted.changes).toBe(1);
    expect(reads).toEqual([[{ id: 1 }], [{ id: 1 }]]);
  }

  /** A value carrying SQL reaches the database as a value, through a tag and a fragment alike. */
  async shouldBindAValueCarryingSqlAsItIs() {
    const hostile = "x'); DROP TABLE pool_bind_it; --";
    await this.pool.run`DROP TABLE IF EXISTS pool_bind_it`;
    await this.pool.run`CREATE TABLE pool_bind_it (name VARCHAR(64))`;
    onTestFinished(async () => {
      await this.pool.run`DROP TABLE pool_bind_it`;
    });

    await this.pool.run`INSERT INTO pool_bind_it (name) VALUES (${hostile})`;
    const rows = await this.pool.all<{ name: string }>`SELECT name FROM pool_bind_it WHERE ${sql`name = ${hostile}`}`;

    expect(rows).toEqual([{ name: hostile }]);
  }
}
