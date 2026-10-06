import { v7 as uuidv7 } from 'uuid';
import { describe, expect, it, vi } from 'vitest';
import { AbstractSqlQuerierPoolIt } from '../querier/abstractSqlQuerierPool-test.js';
import { VectorQuerierIt } from '../querier/vectorQuerier-test.js';
import { createSpec, mssqlConnection } from '../test/index.js';
import type { Type } from '../type/index.js';
import type { MsSqlQuerier } from './mssqlQuerier.js';
import { MsSqlQuerierPool } from './mssqlQuerierPool.js';

/** Integration suite against a live SQL Server, run by `bun run test` with every other engine's. */
class MsSqlQuerierIt extends VectorQuerierIt {
  constructor() {
    super(new MsSqlQuerierPool(mssqlConnection()));
  }

  /** A bare literal that wide is NUMERIC on SQL Server, which `tedious` reads as a float. */
  protected override wideIntegerSql() {
    return 'SELECT CAST(9007199254740993 AS BIGINT) AS big';
  }

  /** SQL Server keeps its per-partition row count live, so there is nothing to gather first. */
  protected override async expectEstimatedCount(entity: Type<object>, rows: number) {
    expect(await this.querier.estimatedCount(entity)).toBe(rows);
  }
}

class MsSqlQuerierPoolIt extends AbstractSqlQuerierPoolIt<MsSqlQuerier> {
  constructor() {
    super(() => new MsSqlQuerierPool(mssqlConnection()));
  }
}

createSpec(new MsSqlQuerierIt());
createSpec(new MsSqlQuerierPoolIt());

describe('MsSqlQuerierPool', () => {
  /** `mssql` connects the pool as a whole, and refuses a second `connect` while the first is under way. */
  it('should serve queriers taken at once through one connect', async () => {
    const pool = new MsSqlQuerierPool(mssqlConnection());
    const [first, second] = [await pool.getQuerier(), await pool.getQuerier()];

    const rows = await Promise.all([first.all('SELECT 1 AS one'), second.all('SELECT 2 AS two')]);

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

    await expect(pool.all('SELECT 1 AS one')).rejects.toThrow('Login failed');
    await admin.run(`CREATE DATABASE ${database}`);
    try {
      expect(await pool.all('SELECT 1 AS one')).toEqual([{ one: 1 }]);
    } finally {
      await pool.end();
      await admin.run(`DROP DATABASE ${database}`);
      await admin.end();
    }
  });

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
    const inFlight = querier.all('SELECT 1').catch((error: unknown) => error);
    await vi.waitFor(() => expect(pool.pool.connecting).toBe(true));

    await pool.end();

    await inFlight;
    await expect(querier.all('SELECT 1')).rejects.toThrow(refusal);
  });

  /** `mssql` emits `error` when a pooled connection fails, and an unheard `error` event ends the process. */
  it('should log a failed pooled connection rather than crash', async () => {
    const logged: string[] = [];
    const pool = new MsSqlQuerierPool(mssqlConnection(), { logger: { logError: (message) => logged.push(message) } });

    pool.pool.emit('error', new Error('socket hang up'));

    expect(logged).toEqual(['Idle SQL Server pool connection encountered an error']);
    await pool.end();
  });
});
