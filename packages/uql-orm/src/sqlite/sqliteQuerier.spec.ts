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

// ─── insertMany: chunking and ID reliability ───
import BetterSqlite3 from 'better-sqlite3';
import { Entity, Field, Id } from '../entity/index.js';
import { BetterSqlite3Dialect } from './betterSqlite3Dialect.js';
import { SqliteQuerier } from './sqliteQuerier.js';

/** Forces tiny statements: floor(6 / params-per-record) records per INSERT. */
class TinyBatchDialect extends BetterSqlite3Dialect {
  override readonly maxBindValues = 6;
}

/** A primary key the database does not generate (no auto-increment, no `onInsert`). */
@Entity()
class TextPkNote {
  @Id()
  code?: string;

  @Field()
  title?: string;
}

describe('insertMany id semantics', () => {
  it('should split oversized batches by maxBindValues and return every id', async () => {
    const querier = new SqliteQuerier(new BetterSqlite3(':memory:'), new TinyBatchDialect());
    await querier.run('CREATE TABLE `User` (`id` INTEGER PRIMARY KEY, `name` TEXT, `createdAt` BIGINT)');
    const runSpy = vi.spyOn(querier, 'run');
    const payload: User[] = Array.from({ length: 7 }, (_, index) => ({ name: `chunk ${index}`, createdAt: index + 1 }));
    const ids = await querier.insertMany(User, payload);
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7]);
    // 2 bind params per record (name, createdAt) → 3 records per statement → 3 INSERTs for 7 records.
    const insertCalls = runSpy.mock.calls.filter(([sql]) => sql.startsWith('INSERT'));
    expect(insertCalls).toHaveLength(3);
    const founds = await querier.findMany(User, { $select: { id: true, name: true }, $sort: { id: 1 } });
    expect(founds.map(({ id }) => id)).toEqual(ids);
    expect(founds.map(({ name }) => name)).toEqual(payload.map(({ name }) => name));
    await querier.release();
  });

  it('should return the real persisted value (not the internal rowid) when the primary key is not database-generated', async () => {
    const querier = new SqliteQuerier(new BetterSqlite3(':memory:'), new BetterSqlite3Dialect());
    await querier.run('CREATE TABLE `TextPkNote` (`code` TEXT PRIMARY KEY, `title` TEXT)');
    // No id provided: RETURNING reports the real persisted NULL, never the internal rowid.
    const generated = await querier.insertMany(TextPkNote, [{ title: 'no pk' }]);
    expect(generated).toEqual([null]);
    // Provided ids are returned as-is.
    const provided = await querier.insertMany(TextPkNote, [{ code: 'abc', title: 'has pk' }, { title: 'still no pk' }]);
    expect(provided).toEqual(['abc', null]);
    const founds = await querier.findMany(TextPkNote, { $select: { code: true, title: true }, $sort: { title: 1 } });
    expect(founds).toEqual([
      { code: 'abc', title: 'has pk' },
      { code: null, title: 'no pk' },
      { code: null, title: 'still no pk' },
    ]);
    await querier.release();
  });
});

// ─── Entity lifecycle hooks (@BeforeInsert and friends, run through a real querier) ───
import { AfterInsert, AfterLoad, BeforeInsert, BeforeUpdate } from '../entity/index.js';
import type { HookContext } from '../util/index.js';

/** Exercises every hook the querier emits, including one that awaits and one that mutates. */
@Entity()
class HookedNote {
  @Id()
  id?: number;

  @Field()
  title?: string;

  @Field()
  slug?: string;

  static readonly seen: string[] = [];

  @BeforeInsert()
  async stampSlug(this: HookedNote, ctx: HookContext) {
    HookedNote.seen.push(`beforeInsert:${ctx.querier.hasOpenTransaction}`);
    await Promise.resolve();
    this.slug = this.title?.toLowerCase().replace(/\s+/g, '-');
  }

  @AfterInsert()
  recordInsert() {
    HookedNote.seen.push('afterInsert');
  }

  @BeforeUpdate()
  recordUpdate() {
    HookedNote.seen.push('beforeUpdate');
  }

  @AfterLoad()
  recordLoad(this: HookedNote) {
    HookedNote.seen.push(`afterLoad:${this.id}`);
  }
}

describe('entity lifecycle hooks', () => {
  let querier: SqliteQuerier;

  beforeEach(async () => {
    HookedNote.seen.length = 0;
    querier = new SqliteQuerier(new BetterSqlite3(':memory:'), new BetterSqlite3Dialect());
    await querier.run('CREATE TABLE `HookedNote` (`id` INTEGER PRIMARY KEY, `title` TEXT, `slug` TEXT)');
  });

  afterEach(async () => {
    await querier.release();
  });

  it('should run @BeforeInsert before the row is written and await it', async () => {
    await querier.insertOne(HookedNote, { title: 'Hello World' });

    const [found] = await querier.findMany(HookedNote, { $select: { id: true, slug: true } });
    expect(found.slug).toBe('hello-world');
    expect(HookedNote.seen).toContain('beforeInsert:false');
    expect(HookedNote.seen).toContain('afterInsert');
  });

  it('should run @AfterLoad once per loaded row', async () => {
    await querier.insertMany(HookedNote, [{ title: 'One' }, { title: 'Two' }]);
    HookedNote.seen.length = 0;

    await querier.findMany(HookedNote, { $select: { id: true } });

    expect(HookedNote.seen).toEqual(['afterLoad:1', 'afterLoad:2']);
  });

  it('should run @BeforeUpdate on the update payload', async () => {
    await querier.insertOne(HookedNote, { title: 'One' });
    HookedNote.seen.length = 0;

    await querier.updateMany(HookedNote, { $where: { id: 1 } }, { title: 'Renamed' });

    expect(HookedNote.seen).toContain('beforeUpdate');
  });
});
