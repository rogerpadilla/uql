import BetterSqlite3 from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { withContext } from '../context/context.js';
import { Entity, Field, Id } from '../entity/index.js';
import { AbstractSqlQuerierSpec } from '../querier/abstractSqlQuerier-spec.js';
import { Coupon, createSpec, Invoice, InvoiceLine, probeForeignKeys, TenantNote } from '../test/index.js';
import { idKey } from '../type/index.js';
import { SqliteDialect } from './sqliteDialect.js';
import { SqliteQuerier } from './sqliteQuerier.js';
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

/** Forces tiny statements: floor(6 / params-per-record) records per INSERT. */
class TinyBatchDialect extends SqliteDialect {
  override readonly maxBindValues = 6;
}

/** Forces short statements: 2 records per INSERT, whatever they bind. */
class TwoRowDialect extends SqliteDialect {
  override readonly maxInsertRows = 2;
}

/** A primary key the database does not generate (no auto-increment, no `onInsert`). */
@Entity()
class TextPkNote {
  [idKey]?: 'code';
  @Id({ type: String })
  code?: string;

  @Field({ type: String })
  title?: string | null;
}

describe('insertMany id semantics', () => {
  it('should split oversized batches by maxBindValues and return every id', async () => {
    const querier = new SqliteQuerier(new BetterSqlite3(':memory:'), new TinyBatchDialect());
    await querier.run('CREATE TABLE `Coupon` (`id` INTEGER PRIMARY KEY, `code` TEXT, `label` TEXT)');
    const runSpy = vi.spyOn(querier, 'run');
    const payload: Coupon[] = Array.from({ length: 7 }, (_, index) => ({ code: `c${index}`, label: `chunk ${index}` }));
    const ids = await querier.insertMany(Coupon, payload);
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7]);
    // 2 bind params per record (code, label) -> 3 records per statement -> 3 INSERTs for 7 records.
    const insertCalls = runSpy.mock.calls.filter(([sql]) => sql.startsWith('INSERT'));
    expect(insertCalls).toHaveLength(3);
    const founds = await querier.findMany(Coupon, { $select: { id: true, label: true }, $sort: { id: 1 } });
    expect(founds.map(({ id }) => id)).toEqual(ids);
    expect(founds.map(({ label }) => label)).toEqual(payload.map(({ label }) => label));
    await querier.release();
  });

  /** The assignments bind once per statement beside the rows, so a split filling the budget would bind one too many. */
  it('should split an upsert leaving room for what its assignments bind', async () => {
    const querier = new SqliteQuerier(new BetterSqlite3(':memory:'), new TinyBatchDialect());
    await querier.run('CREATE TABLE `Coupon` (`id` INTEGER PRIMARY KEY, `code` TEXT UNIQUE, `label` TEXT)');
    const payload = Array.from({ length: 6 }, (_, index) => ({ code: `c${index}`, label: 'new' }));

    await querier.insertOne(Coupon, { code: 'c0', label: 'old' });

    await querier.upsertMany(Coupon, { code: true }, payload, { label: 'updated' });

    const founds = await querier.findMany(Coupon, { $select: { label: true }, $sort: { code: 1 } });
    expect(founds.map(({ label }) => label)).toEqual(['updated', 'new', 'new', 'new', 'new', 'new']);
    await querier.release();
  });

  /** Each key is read back once, so one listed in two batches is not taken for two rows sharing it. */
  it('should read a guarded upsert back once per key, however the batches fall', async () => {
    const querier = new SqliteQuerier(new BetterSqlite3(':memory:'), new TinyBatchDialect());
    await querier.run('CREATE TABLE `TenantNote` (`id` TEXT PRIMARY KEY, `tenantId` TEXT, `title` TEXT)');
    const asTenant = <T>(fn: () => Promise<T>) => withContext({ tenantId: 't' }, fn);
    await asTenant(() => querier.insertOne(TenantNote, { id: 'a', title: 'old' }));

    const { ids } = await asTenant(() =>
      querier.upsertMany(TenantNote, { id: true }, [
        { id: 'a', title: 'first' },
        { id: 'b', title: 'b' },
        { id: 'c', title: 'c' },
        { id: 'd', title: 'd' },
        { id: 'a', title: 'last' },
      ]),
    );

    expect(ids).toEqual(['a', 'b', 'c', 'd', 'a']);
    expect(await asTenant(() => querier.findMany(TenantNote, { $select: { title: true }, $sort: { id: 1 } }))).toEqual([
      { title: 'last' },
      { title: 'b' },
      { title: 'c' },
      { title: 'd' },
    ]);
    await querier.release();
  });

  /** A null never conflicts, as a unique index reads it, so a row whose conflict key holds one is inserted. */
  it('should insert a guarded row whose conflict key holds a null, not update one that holds it too', async () => {
    const querier = new SqliteQuerier(new BetterSqlite3(':memory:'), new SqliteDialect());
    await querier.run('CREATE TABLE `TenantNote` (`id` TEXT PRIMARY KEY, `tenantId` TEXT, `title` TEXT)');
    const asTenant = <T>(fn: () => Promise<T>) => withContext({ tenantId: 't' }, fn);
    await asTenant(() => querier.insertOne(TenantNote, { id: 'a', title: null }));

    await asTenant(() =>
      querier.upsertMany(TenantNote, { tenantId: true, title: true }, [
        { id: 'b', tenantId: 't', title: null },
        { id: 'c', tenantId: 't', title: null },
      ]),
    );

    expect(await asTenant(() => querier.count(TenantNote, {}))).toBe(3);
    await querier.release();
  });

  it('should split oversized batches by maxInsertRows', async () => {
    const querier = new SqliteQuerier(new BetterSqlite3(':memory:'), new TwoRowDialect());
    await querier.run('CREATE TABLE `Coupon` (`id` INTEGER PRIMARY KEY, `code` TEXT, `label` TEXT)');
    const runSpy = vi.spyOn(querier, 'run');

    const ids = await querier.insertMany(
      Coupon,
      Array.from({ length: 5 }, (_, index) => ({ code: `c${index}` })),
    );

    expect(ids).toEqual([1, 2, 3, 4, 5]);
    expect(runSpy.mock.calls.filter(([sql]) => sql.startsWith('INSERT'))).toHaveLength(3);
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

    // 3 bind params per record (id, code, label) -> 2 records per statement -> 4 statements.
    const upsertCalls = runSpy.mock.calls.filter(([sql]) => sql.startsWith('INSERT'));
    expect(upsertCalls).toHaveLength(4);
    const founds = await querier.findMany(Coupon, { $select: { id: true, label: true }, $sort: { id: 1 } });
    expect(founds.map(({ label }) => label)).toEqual(payload.map(({ label }) => label));
    await querier.release();
  });
});

/** Lists the ORM builds itself, split to fit a 6-value budget: 3 ids a statement. */
describe('id lists past the bind budget', () => {
  const tables = async () => {
    const querier = new SqliteQuerier(new BetterSqlite3(':memory:'), new TinyBatchDialect());
    await querier.run('CREATE TABLE `Invoice` (`id` INTEGER PRIMARY KEY, `description` TEXT)');
    await querier.run('CREATE TABLE `InvoiceLine` (`id` INTEGER PRIMARY KEY, `amount` INTEGER, `invoiceId` INTEGER)');
    return querier;
  };
  const seven = <T>(row: (index: number) => T) => Array.from({ length: 7 }, (_, index) => row(index));
  const paged = { $sort: { id: 1 }, $limit: 7 } as const;

  it('should update the rows a paged update settles, in batches', async () => {
    const querier = await tables();
    await querier.insertMany(
      InvoiceLine,
      seven(() => ({ amount: 1 })),
    );

    expect(await querier.updateMany(InvoiceLine, { $where: { amount: 1 }, ...paged }, { amount: 2 })).toBe(7);
    expect(await querier.count(InvoiceLine, { $where: { amount: 2 } })).toBe(7);
    await querier.release();
  });

  it('should delete the rows a paged delete settles, in batches', async () => {
    const querier = await tables();
    await querier.insertMany(
      InvoiceLine,
      seven(() => ({ amount: 1 })),
    );

    expect(await querier.deleteMany(InvoiceLine, { $where: { amount: 1 }, ...paged })).toBe(7);
    expect(await querier.count(InvoiceLine, {})).toBe(0);
    await querier.release();
  });

  it('should cascade a delete to the children of every batch', async () => {
    const querier = await tables();
    await querier.insertMany(
      Invoice,
      seven(() => ({ description: 'x', lines: [{ amount: 1 }] })),
    );

    expect(await querier.deleteMany(Invoice, { $where: { description: 'x' } })).toBe(7);
    expect(await querier.count(InvoiceLine, {})).toBe(0);
    await querier.release();
  });

  it('should replace the to-many of every row an update settles', async () => {
    const querier = await tables();
    await querier.insertMany(
      Invoice,
      seven(() => ({ description: 'x', lines: [{ amount: 1 }] })),
    );

    await querier.updateMany(Invoice, { $where: { description: 'x' } }, { lines: [{ amount: 2 }] });

    expect(await querier.count(InvoiceLine, { $where: { amount: 2 } })).toBe(7);
    expect(await querier.count(InvoiceLine, {})).toBe(7);
    await querier.release();
  });

  /** A split write lands whole: a later batch failing takes the earlier ones with it. */
  it('should roll every batch back when a later one fails', async () => {
    const querier = await tables();
    await querier.insertMany(
      InvoiceLine,
      seven(() => ({ amount: 1 })),
    );
    await querier.run(
      "CREATE TRIGGER `refuseLast` BEFORE UPDATE ON `InvoiceLine` WHEN NEW.`id` = 7 BEGIN SELECT RAISE(ABORT, 'refused'); END",
    );

    await expect(querier.updateMany(InvoiceLine, { $where: { amount: 1 }, ...paged }, { amount: 2 })).rejects.toThrow(
      'refused',
    );
    expect(await querier.count(InvoiceLine, { $where: { amount: 1 } })).toBe(7);
    await querier.release();
  });
});

/** A chunk of rows that name nothing is one `DEFAULT VALUES` each, however the rows around it chunk. */
it('should insert the rows naming nothing in a chunk of their own one at a time', async () => {
  const querier = new SqliteQuerier(new BetterSqlite3(':memory:'), new TwoRowDialect());
  await querier.run('CREATE TABLE `InvoiceLine` (`id` INTEGER PRIMARY KEY, `amount` INTEGER, `invoiceId` INTEGER)');

  const ids = await querier.insertMany(InvoiceLine, [{ amount: 1 }, {}, {}, {}]);

  expect(ids).toEqual([1, 2, 3, 4]);
  await querier.release();
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
