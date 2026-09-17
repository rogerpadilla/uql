import { describe, expect, it } from 'bun:test';
import { probeForeignKeys } from '../test/index.js';
import { Sqlite3QuerierPool } from './sqliteQuerierPool.js';

/**
 * Runs only under `bun test`. The vitest suite never reaches the `bun:sqlite` branch of
 * {@link Sqlite3QuerierPool}, because Node resolves `better-sqlite3` instead, so every assertion
 * about that branch has to live here.
 */
describe('Sqlite3QuerierPool on bun:sqlite', () => {
  async function seed() {
    const pool = new Sqlite3QuerierPool(':memory:');
    const querier = await pool.getQuerier();
    await querier.run('CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, s TEXT)');
    return { pool, querier };
  }

  it('should enforce foreign keys, which bun:sqlite leaves off by default', async () => {
    const pool = new Sqlite3QuerierPool(':memory:');
    const querier = await pool.getQuerier();

    // The one branch where the pool's `PRAGMA foreign_keys = ON` is load-bearing: `better-sqlite3` and
    // `node:sqlite` enforce without being asked, `bun:sqlite` does not, so before this the constraints
    // UQL emits in its own DDL were decorative here.
    expect(await probeForeignKeys(querier)).toEqual({ dangling: 'rejected', orphans: [] });
    await pool.end();
  });

  it('should report inserted ids from a RETURNING statement', async () => {
    const { pool, querier } = await seed();

    // `bun:sqlite` statements carry no `reader`, so before the pool derived one from `columnNames`
    // this took the `run()` path, which discards returned rows, and reported `ids: []`.
    const res = await querier.run("INSERT INTO t (s) VALUES ('a') RETURNING `id` `id`");

    expect(res.changes).toBe(1);
    expect(res.ids).toEqual([1]);
    expect(res.firstId).toBe(1);
    await pool.end();
  });

  it('should report changes for a statement without RETURNING', async () => {
    const { pool, querier } = await seed();
    await querier.run("INSERT INTO t (s) VALUES ('a')");

    const res = await querier.run("UPDATE t SET s = 'b'");

    expect(res.changes).toBe(1);
    await pool.end();
  });

  it('should bind values and read rows back', async () => {
    const { pool, querier } = await seed();
    await querier.run('INSERT INTO t (s) VALUES (?)', ['bound']);

    const rows = await querier.all<{ id: number; s: string }>('SELECT * FROM t WHERE s = ?', ['bound']);

    expect(rows).toEqual([{ id: 1, s: 'bound' }]);
    await pool.end();
  });

  it('should read an integer past 2^53 exactly', async () => {
    const { pool, querier } = await seed();

    const rows = await querier.all<{ big: unknown }>('SELECT 9007199254740993 AS big');

    expect(rows).toEqual([{ big: '9007199254740993' }]);
    await pool.end();
  });

  /** `bun:sqlite` opens only a path, so a serialized database has to go through `Database.deserialize`. */
  it('should open a serialized database from a Buffer', async () => {
    const { Database } = await import('bun:sqlite');
    const source = new Database(':memory:');
    source.run('CREATE TABLE t (s TEXT)');
    source.run("INSERT INTO t (s) VALUES ('kept')");
    const pool = new Sqlite3QuerierPool(Buffer.from(source.serialize()));
    const querier = await pool.getQuerier();

    const rows = await querier.all('SELECT s FROM t');

    expect(rows).toEqual([{ s: 'kept' }]);
    await pool.end();
    source.close();
  });
});
