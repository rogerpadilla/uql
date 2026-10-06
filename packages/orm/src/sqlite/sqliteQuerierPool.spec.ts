import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { v7 as uuidv7 } from 'uuid';
import { describe, expect, it } from 'vitest';
import { Sqlite3QuerierPool } from './sqliteQuerierPool.js';

/**
 * Runs on `better-sqlite3`, the driver Node resolves; the `bun:sqlite` branch is held by
 * `sqliteQuerier.bun.test.ts`, which only `bun test` runs.
 */
describe('Sqlite3QuerierPool', () => {
  /** better-sqlite3 takes a serialized database as its filename. */
  it('should open a serialized database from a Buffer', async () => {
    const source = new BetterSqlite3(':memory:');
    source.exec("CREATE TABLE t (s TEXT); INSERT INTO t (s) VALUES ('kept')");
    const pool = new Sqlite3QuerierPool(source.serialize());
    const querier = await pool.getQuerier();

    expect(await querier.all('SELECT s FROM t')).toEqual([{ s: 'kept' }]);
    await pool.end();
    source.close();
  });

  /**
   * The open is awaited, so a caller arriving during it waits for the same database rather than opening
   * one of its own, which on `:memory:` would be a separate, unclosed database.
   */
  it('should open one database when acquisitions race', async () => {
    const pool = new Sqlite3QuerierPool(':memory:');

    const [querier1, querier2] = await Promise.all([pool.getQuerier(), pool.getQuerier()]);

    expect(querier1.db).toBe(querier2.db);
    await pool.end();
  });

  /** A driver that could not start once is retried rather than refused for the life of the pool. */
  it('should open the database again after a failed open', async () => {
    const dir = join(tmpdir(), `uql-sqlite-${uuidv7()}`);
    const pool = new Sqlite3QuerierPool(join(dir, 'db.sqlite'));

    await expect(pool.getQuerier()).rejects.toThrow('directory does not exist');
    mkdirSync(dir);
    const querier = await pool.getQuerier();

    expect(await querier.all('SELECT 1 AS one')).toEqual([{ one: 1 }]);
    await pool.end();
    rmSync(dir, { recursive: true, force: true });
  });

  /** The failure belongs to the caller acquiring, so an end waiting on that open has nothing to close. */
  it('should end while a failing open is in flight', async () => {
    const pool = new Sqlite3QuerierPool(join(tmpdir(), `uql-missing-${uuidv7()}`, 'db.sqlite'));

    const acquiring = pool.getQuerier();

    await expect(pool.end()).resolves.toBeUndefined();
    await expect(acquiring).rejects.toThrow('directory does not exist');
  });
});
