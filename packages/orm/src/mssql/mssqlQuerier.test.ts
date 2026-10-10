import { v7 as uuidv7 } from 'uuid';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { SqlQuerierPoolIt } from '../querier/abstractSqlQuerierPool-test.js';
import { VectorQuerierIt } from '../querier/vectorQuerier-test.js';
import { createSpec, mssqlConnection } from '../test/index.js';
import type { Type } from '../type/index.js';
import { sql } from '../util/sql.js';
import { MsSqlQuerierPool } from './mssqlQuerierPool.js';

class MsSqlQuerierIt extends VectorQuerierIt {
  /** A bare literal that wide is NUMERIC on SQL Server, which `tedious` reads as a float. */
  protected override wideIntegerSql() {
    return sql`SELECT CAST(9007199254740993 AS BIGINT) AS big`;
  }

  /** SQL Server keeps its per-partition row count live, so there is nothing to gather first. */
  protected override async expectEstimatedCount(entity: Type<object>, rows: number) {
    expect(await this.querier.estimatedCount(entity)).toBe(rows);
  }
}

createSpec(new MsSqlQuerierIt(new MsSqlQuerierPool(mssqlConnection())));
createSpec(new SqlQuerierPoolIt(() => new MsSqlQuerierPool(mssqlConnection())));

describe('MsSqlQuerierPool', () => {
  /** `mssql` connects the pool as a whole, and refuses a second `connect` while the first is under way. */
  it('should serve queriers taken at once through one connect', async () => {
    const pool = new MsSqlQuerierPool(mssqlConnection());
    const [first, second] = [await pool.getQuerier(), await pool.getQuerier()];

    const rows = await Promise.all([first.all`SELECT 1 AS one`, second.all`SELECT 2 AS two`]);

    expect(rows).toEqual([[{ one: 1 }], [{ two: 2 }]]);
    await first.release();
    await second.release();
    await pool.end();
    expect(pool.pool.connected).toBe(false);
  });

  /** Memoized, one transient failure would be handed to every later caller for the pool's life. */
  it('should connect again after a failed attempt', async () => {
    const database = `uql_retry_${uuidv7().replaceAll('-', '')}`;
    const admin = new MsSqlQuerierPool(mssqlConnection('master'));
    const pool = new MsSqlQuerierPool(mssqlConnection(database));
    onTestFinished(async () => {
      await pool.end();
      await admin.run(sql.text(`DROP DATABASE IF EXISTS ${database}`));
      await admin.end();
    });

    await expect(pool.all`SELECT 1 AS one`).rejects.toThrow('Login failed');
    await admin.run(sql.text(`CREATE DATABASE ${database}`));

    expect(await pool.all`SELECT 1 AS one`).toEqual([{ one: 1 }]);
  });

  /** Holds the pool's connect until `open` is called, so a test can end the pool while it is under way. */
  function holdConnect(pool: MsSqlQuerierPool) {
    const connect = pool.pool.connect.bind(pool.pool);
    let open!: () => void;
    const held = new Promise<void>((resolve) => {
      open = resolve;
    });
    const connecting = vi.spyOn(pool.pool, 'connect').mockImplementation(async () => {
      await held;
      return connect();
    });
    return { connecting, open };
  }

  /** `mssql` refuses to close a pool mid-connect, so `end` lets the connect under way settle first. */
  it.each([
    ['succeeds', mssqlConnection(), 'Connection is closed.'],
    [
      'fails',
      mssqlConnection(`uql_missing_${uuidv7().replaceAll('-', '')}`),
      'Cannot use a pool after calling end on it',
    ],
  ])('should end while a connect is under way, whether it %s', async (_outcome, connection, refusal) => {
    const pool = new MsSqlQuerierPool(connection);
    const querier = await pool.getQuerier();
    const { connecting, open } = holdConnect(pool);
    const inFlight = querier.all`SELECT 1`.catch((error: unknown) => error);
    await vi.waitFor(() => expect(connecting).toHaveBeenCalled());

    const ended = pool.end();
    open();
    await ended;
    await inFlight;
    await expect(querier.all`SELECT 1`).rejects.toThrow(refusal);
  });
});
