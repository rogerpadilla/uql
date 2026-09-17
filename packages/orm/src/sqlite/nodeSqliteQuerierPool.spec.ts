import { describe, expect, it } from 'vitest';
import { NodeSqliteQuerierPool } from './nodeSqliteQuerierPool.js';

describe('NodeSqliteQuerierPool', () => {
  it('should tell a statement that returns rows, RETURNING included, from one that does not', async () => {
    const pool = new NodeSqliteQuerierPool();
    const { db } = await pool.getQuerier();
    await (await db.prepare('CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, s TEXT)')).run();

    expect((await db.prepare('SELECT * FROM t')).reader).toBe(true);
    expect((await db.prepare('INSERT INTO t (s) VALUES (?) RETURNING id')).reader).toBe(true);
    expect((await db.prepare('DELETE FROM t RETURNING id')).reader).toBe(true);
    expect((await db.prepare('INSERT INTO t (s) VALUES (?)')).reader).toBe(false);
    expect((await db.prepare('UPDATE t SET s = ?')).reader).toBe(false);
    await pool.end();
  });

  it('should report a change count as a number and stream the rows', async () => {
    const pool = new NodeSqliteQuerierPool();
    const querier = await pool.getQuerier();
    await querier.run('CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, s TEXT)');
    await querier.run('INSERT INTO t (s) VALUES (?), (?)', ['a', 'b']);

    expect((await querier.run('UPDATE t SET s = ?', ['c'])).changes).toBe(2);
    expect(await Array.fromAsync(querier.internalStream('SELECT s FROM t'))).toEqual([{ s: 'c' }, { s: 'c' }]);
    await pool.end();
  });
});
