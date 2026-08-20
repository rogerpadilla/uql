import { describe, expect, it, vi } from 'vitest';
import { AbstractSqlQuerierSpec } from '../querier/abstractSqlQuerier-spec.js';
import { createSpec, probeForeignKeys, User } from '../test/index.js';
import { Sqlite3QuerierPool } from './sqliteQuerierPool.js';

class SqliteQuerierSpec extends AbstractSqlQuerierSpec {
  constructor() {
    super(new Sqlite3QuerierPool(':memory:'));
  }

  override async beforeEach() {
    await super.beforeEach();
    await Promise.all([
      // No `foreign_keys` here on purpose: the pool sets it on connect now, and a suite that turns it on
      // itself is exactly why nobody noticed the pool never did. See the enforcement test below.
      this.querier.run('PRAGMA journal_mode = WAL'),
      this.querier.run('PRAGMA synchronous = normal'),
      this.querier.run('PRAGMA temp_store = memory'),
    ]);
    vi.spyOn(this.querier, 'run').mockClear();
  }
}

createSpec(new SqliteQuerierSpec());

// ─── insertMany: chunking and ID reliability ───
import BetterSqlite3 from 'better-sqlite3';
import { Entity, Field, Id } from '../entity/index.js';
import { SqliteDialect } from './sqliteDialect.js';
import { SqliteQuerier } from './sqliteQuerier.js';

/** Forces tiny statements: floor(6 / params-per-record) records per INSERT. */
class TinyBatchDialect extends SqliteDialect {
  override readonly maxBindValues = 6;
}

/** A primary key the database does not generate (no auto-increment, no `onInsert`). */
@Entity()
class TextPkNote {
  @Id({ type: String })
  code?: string;

  @Field({ type: String })
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
    const querier = new SqliteQuerier(new BetterSqlite3(':memory:'), new SqliteDialect());
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

describe('foreign key enforcement', () => {
  /**
   * Guards the `better-sqlite3` branch, which already defaults to enforcing. It is here so a future
   * driver default flipping off is caught rather than silently changing behaviour; the branch where the
   * pool's `PRAGMA` is what makes the difference is `bun:sqlite`, covered in `sqliteQuerier.bun.test.ts`.
   */
  it('should enforce the constraints in its own DDL', async () => {
    const pool = new Sqlite3QuerierPool(':memory:');
    const querier = await pool.getQuerier();

    expect(await probeForeignKeys(querier)).toEqual({ dangling: 'rejected', orphans: [] });
    await pool.end();
  });
});
