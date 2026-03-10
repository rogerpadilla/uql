import { vi } from 'vitest';
import { AbstractSqlQuerierSpec } from '../querier/abstractSqlQuerier-spec.js';
import { createSpec } from '../test/index.js';

vi.mock('better-sqlite3', async () => {
  try {
    const { Database } = await import('bun:sqlite');
    class BetterSqlite3 extends Database {
      pragma(source: string) {
        return (this as any).query(`PRAGMA ${source}`).all();
      }
    }
    return {
      default: BetterSqlite3,
    };
  } catch (e) {
    return await vi.importActual('better-sqlite3');
  }
});

import { Sqlite3QuerierPool } from './sqliteQuerierPool.js';

class SqliteQuerierSpec extends AbstractSqlQuerierSpec {
  constructor() {
    super(new Sqlite3QuerierPool(':memory:'), 'INTEGER PRIMARY KEY');
  }

  override async beforeEach() {
    await super.beforeEach();
    await Promise.all([
      this.querier.run('PRAGMA foreign_keys = ON'),
      this.querier.run('PRAGMA journal_mode = WAL'),
      this.querier.run('PRAGMA synchronous = normal'),
      this.querier.run('PRAGMA temp_store = memory'),
    ]);
    vi.spyOn(this.querier, 'run').mockClear();
  }
}

createSpec(new SqliteQuerierSpec());

// ─── Global listeners (covers abstractQuerier.ts emitHook lines 533-545) ───
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clearTables, createTables, dropTables, User } from '../test/index.js';
import type { QuerierListener } from '../type/index.js';

describe('global listeners', () => {
  // Track whether async work actually completed before the operation returned
  let asyncWorkDone = false;

  const asyncListener: QuerierListener = {
    afterLoad: vi.fn(async () => {
      // Real async: microtask delay to simulate I/O
      await new Promise((r) => setTimeout(r, 5));
      asyncWorkDone = true;
    }),
    beforeInsert: vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 5));
      asyncWorkDone = true;
    }),
    afterInsert: vi.fn(),
  };

  const pool = new Sqlite3QuerierPool(':memory:', undefined, { listeners: [asyncListener] });
  let q: Awaited<ReturnType<typeof pool.getQuerier>>;

  beforeAll(async () => {
    q = await pool.getQuerier();
    await dropTables(q).catch(() => {});
    await createTables(q, 'INTEGER PRIMARY KEY');
  });

  beforeEach(async () => {
    q = await pool.getQuerier();
    await clearTables(q);
    asyncWorkDone = false;
    vi.mocked(asyncListener.afterLoad!).mockClear();
    vi.mocked(asyncListener.beforeInsert!).mockClear();
    vi.mocked(asyncListener.afterInsert!).mockClear();
  });

  afterEach(async () => {
    await q.release();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('should await async afterLoad listener before returning', async () => {
    await q.findMany(User, {});
    expect(asyncWorkDone).toBe(true);
    expect(asyncListener.afterLoad).toHaveBeenCalledWith(expect.objectContaining({ entity: User, event: 'afterLoad' }));
  });

  it('should await async beforeInsert and call sync afterInsert', async () => {
    await q.insertOne(User, { name: 'Test', createdAt: 1 });
    // Proves the async beforeInsert completed before insertOne resolved
    expect(asyncWorkDone).toBe(true);
    expect(asyncListener.beforeInsert).toHaveBeenCalledWith(
      expect.objectContaining({ entity: User, event: 'beforeInsert' }),
    );
    // Sync afterInsert should also have been called
    expect(asyncListener.afterInsert).toHaveBeenCalledWith(
      expect.objectContaining({ entity: User, event: 'afterInsert' }),
    );
  });
});
