import { describe, expect, it, vi } from 'vitest';
import { AbstractSqlQuerierSpec } from '../querier/abstractSqlQuerier-spec.js';
import { Coupon, createSpec, probeForeignKeys, User } from '../test/index.js';
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
import { idKey } from '../type/index.js';
import { SqliteDialect } from './sqliteDialect.js';
import { SqliteQuerier } from './sqliteQuerier.js';

/** Forces tiny statements: floor(6 / params-per-record) records per INSERT. */
class TinyBatchDialect extends SqliteDialect {
  override readonly maxBindValues = 6;
}

/** A primary key the database does not generate (no auto-increment, no `onInsert`). */
@Entity()
class TextPkNote {
  [idKey]?: 'code';
  @Id({ type: String })
  code?: string;

  @Field({ type: String })
  title?: string;
}

describe('insertMany id semantics', () => {
  it('should split oversized batches by maxBindValues and return every id', async () => {
    const querier = new SqliteQuerier(new BetterSqlite3(':memory:'), new TinyBatchDialect());
    await querier.run('CREATE TABLE `Coupon` (`id` INTEGER PRIMARY KEY, `code` TEXT, `label` TEXT)');
    const runSpy = vi.spyOn(querier, 'run');
    const payload: Coupon[] = Array.from({ length: 7 }, (_, index) => ({ code: `c${index}`, label: `chunk ${index}` }));
    const ids = await querier.insertMany(Coupon, payload);
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7]);
    // 2 bind params per record (code, label) → 3 records per statement → 3 INSERTs for 7 records.
    const insertCalls = runSpy.mock.calls.filter(([sql]) => sql.startsWith('INSERT'));
    expect(insertCalls).toHaveLength(3);
    const founds = await querier.findMany(Coupon, { $select: { id: true, label: true }, $sort: { id: 1 } });
    expect(founds.map(({ id }) => id)).toEqual(ids);
    expect(founds.map(({ label }) => label)).toEqual(payload.map(({ label }) => label));
    await querier.release();
  });

  it('should return the real persisted value (not the internal rowid) when the primary key is not database-generated', async () => {
    const querier = new SqliteQuerier(new BetterSqlite3(':memory:'), new SqliteDialect());
    await querier.run('CREATE TABLE `TextPkNote` (`code` TEXT PRIMARY KEY, `title` TEXT)');
    // No id provided: the persisted key is NULL, which names no row, so none is reported - never the rowid.
    const generated = await querier.insertMany(TextPkNote, [{ title: 'no pk' }]);
    expect(generated).toEqual([undefined]);
    // Provided ids are returned as-is.
    const provided = await querier.insertMany(TextPkNote, [{ code: 'abc', title: 'has pk' }, { title: 'still no pk' }]);
    expect(provided).toEqual(['abc', undefined]);
    const founds = await querier.findMany(TextPkNote, { $select: { code: true, title: true }, $sort: { title: 1 } });
    expect(founds).toEqual([
      { code: 'abc', title: 'has pk' },
      { code: null, title: 'no pk' },
      { code: null, title: 'still no pk' },
    ]);
    await querier.release();
  });

  /**
   * An upsert binds like an insert and has to be split like one. Only `insertMany` chunked, so a
   * batch of any size went out as a single statement and overflowed the dialect's bind budget - 100
   * on D1, which a couple of dozen rows reach.
   */
  it('should split an oversized upsert by maxBindValues', async () => {
    const querier = new SqliteQuerier(new BetterSqlite3(':memory:'), new TinyBatchDialect());
    await querier.run('CREATE TABLE `Coupon` (`id` INTEGER PRIMARY KEY, `code` TEXT, `label` TEXT)');
    const runSpy = vi.spyOn(querier, 'run');
    const payload: Coupon[] = Array.from({ length: 7 }, (_, index) => ({
      id: index + 1,
      code: `c${index}`,
      label: `up ${index}`,
    }));

    await querier.upsertMany(Coupon, { id: true }, payload);

    // 3 bind params per record (id, code, label) → 2 records per statement → 4 statements.
    const upsertCalls = runSpy.mock.calls.filter(([sql]) => sql.startsWith('INSERT'));
    expect(upsertCalls).toHaveLength(4);
    const founds = await querier.findMany(Coupon, { $select: { id: true, label: true }, $sort: { id: 1 } });
    expect(founds.map(({ label }) => label)).toEqual(payload.map(({ label }) => label));
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
