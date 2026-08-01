import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { adaptNodeSqlite } from './nodeSqliteAdapter.js';

describe('adaptNodeSqlite', () => {
  function seed() {
    const nodeDb = new DatabaseSync(':memory:');
    nodeDb.exec('CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, s TEXT)');
    return adaptNodeSqlite(nodeDb);
  }

  it('should derive `reader` for row-returning statements, including RETURNING', () => {
    const db = seed();

    expect(db.prepare('SELECT * FROM t').reader).toBe(true);
    expect(db.prepare('INSERT INTO t (s) VALUES (?) RETURNING id').reader).toBe(true);
    expect(db.prepare('DELETE FROM t RETURNING id').reader).toBe(true);
    expect(db.prepare('INSERT INTO t (s) VALUES (?)').reader).toBe(false);
    expect(db.prepare('UPDATE t SET s = ?').reader).toBe(false);
  });

  it('should report `changes` as a number and stream rows', async () => {
    const db = seed();
    await db.prepare('INSERT INTO t (s) VALUES (?)').run('a');
    await db.prepare('INSERT INTO t (s) VALUES (?)').run('b');

    const { changes } = await db.prepare('UPDATE t SET s = ?').run('c');

    expect(changes).toBe(2);
    expect(typeof changes).toBe('number');

    const streamed: unknown[] = [];
    for await (const row of db.prepare('SELECT s FROM t').iterate()) {
      streamed.push(row);
    }
    expect(streamed).toEqual([{ s: 'c' }, { s: 'c' }]);
  });
});
