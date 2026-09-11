import { expect } from 'vitest';
import {
  Coupon,
  createTables,
  dropTables,
  InventoryAdjustment,
  Invoice,
  ItemAdjustment,
  LedgerAccount,
  TaxCategory,
  TypedGroup,
  TypedRow,
} from '../test/index.js';
import { col, raw } from '../util/index.js';
import { AbstractQuerierIt } from './abstractQuerier-test.js';
import { AbstractSharedHandleQuerierPool } from './abstractSharedHandleQuerierPool.js';
import type { AbstractSqlQuerier } from './abstractSqlQuerier.js';

/**
 * Wider than 2^53, so any engine or driver that routes it through a float is caught by the digits. Its
 * float needs only 15 significant digits, which SQLite writes into JSON before 3.53 and libSQL still does.
 */
const EXACT_DECIMAL = '12345678901234500000.99';

/**
 * What {@link EXACT_DECIMAL} becomes on the SQLite family, which has no DECIMAL type: NUMERIC affinity
 * converts the literal to a float *on write*, so the digits are gone in the database before anything on
 * the read side could preserve them. Every SQLite driver here answers `expectedExactDecimal` with it.
 */
export const FLOATED_DECIMAL = 12345678901234500000;

/** The row {@link AbstractSqlQuerierIt.wideIntegerSql} reads. */
export type WideRow = { big: unknown };

/** What a driver that reads every integer as a plain float makes of 9007199254740993. */
export const ROUNDED_WIDE_INTEGER = 9007199254740992;

export abstract class AbstractSqlQuerierIt extends AbstractQuerierIt<AbstractSqlQuerier> {
  /**
   * Locking outside a transaction is accepted by every engine and then released as the statement
   * commits, so it silently does nothing. Only the querier can catch it, and this is the one test
   * that proves the guard fires against a live connection rather than a mocked dialect.
   */
  async shouldRejectLockOutsideTransaction() {
    const expected = this.querier.dialect.supportsRowLocks
      ? 'requires an open transaction'
      : 'does not support row-level locking';
    await expect(this.querier.findMany(LedgerAccount, { $lock: true })).rejects.toThrow(expected);
  }

  /**
   * A locked read that also asks for its unpaged total: the total rides in a `COUNT(*) OVER ()`
   * column, and the Postgres family rejects `FOR UPDATE` alongside a window function outright.
   */
  async shouldFindManyAndCountUnderALock() {
    if (!this.querier.dialect.supportsRowLocks) {
      return;
    }
    await this.querier.insertOne(LedgerAccount, { name: 'locked-count' });

    await this.querier.beginTransaction();
    try {
      const [rows, total] = await this.querier.findManyAndCount(LedgerAccount, { $limit: 2, $lock: true });
      expect(rows.length).toBeLessThanOrEqual(2);
      expect(total).toBeGreaterThanOrEqual(1);
    } finally {
      await this.querier.rollbackTransaction();
    }
  }

  /**
   * The case the feature exists for: two workers draw from one queue and must not get the same row.
   * Needs two real connections, since a lock is only visible to a different transaction, which is
   * also why no generated-SQL assertion can stand in for it. Skipped on a shared-handle pool, which has
   * one connection under every querier and so cannot produce a second transaction for a lock to be
   * visible to, however correct the SQL the dialect emits: see {@link AbstractSharedHandleQuerierPool}
   * for what each engine does instead.
   */
  async shouldSkipLockedRowsForAQueue() {
    if (!this.querier.dialect.supportsRowLocks || this.pool instanceof AbstractSharedHandleQuerierPool) {
      return;
    }
    for (let i = 0; i < 6; i++) {
      await this.querier.insertOne(LedgerAccount, { name: `job-${i}` });
    }
    // A plain read resolves the inserts' intents, which CockroachDB's SKIP LOCKED would otherwise skip
    // as locks: https://github.com/cockroachdb/cockroach/issues/167582
    await this.querier.findMany(LedgerAccount, { $select: { id: true } });

    const other = await this.pool.getQuerier();
    try {
      await this.querier.beginTransaction();
      await other.beginTransaction();

      const lock = { wait: 'skip' } as const;
      const mine = await this.querier.findMany(LedgerAccount, { $sort: { id: 'asc' }, $limit: 3, $lock: lock });
      const theirs = await other.findMany(LedgerAccount, { $sort: { id: 'asc' }, $limit: 3, $lock: lock });

      expect(mine).toHaveLength(3);
      expect(theirs).toHaveLength(3);
      const mineIds = mine.map((it) => it.id);
      const theirsIds = theirs.map((it) => it.id);
      expect(mineIds.filter((id) => theirsIds.includes(id))).toEqual([]);

      await other.rollbackTransaction();
      await this.querier.rollbackTransaction();
    } finally {
      await other.release();
    }
  }

  /**
   * A read returns the JS types the entity declared, for every dialect.
   *
   * The class of bug this exists for is invisible to the compiler and to any mocked test: an engine
   * stores a declared type in whatever it has (SQLite has no boolean; node-postgres returns BIGINT
   * as text) and the driver hands that back verbatim, so a field declared `boolean` arrives as `1`
   * and one declared `number` as `'9'`. Every consumer then computes on it and is quietly wrong.
   * Two shipped instances were found this way, so the contract is asserted rather than assumed.
   */
  async shouldReadBackDeclaredTypes() {
    const id = await this.querier.insertOne(TypedRow, { name: 'typed', count: 7, amount: 12.5, enabled: true });
    const found = await this.querier.findOneById(TypedRow, id, {
      $select: { id: true, name: true, count: true, amount: true, enabled: true },
    });

    // The id too: it is BIGINT on every engine here, and the one every consumer indexes by.
    expect(typeof found!.id).toBe('number');
    expect(typeof found!.name).toBe('string');
    expect(typeof found!.count).toBe('number');
    expect(found!.count).toBe(7);
    expect(typeof found!.amount).toBe('number');
    expect(found!.amount).toBe(12.5);
    expect(typeof found!.enabled).toBe('boolean');
    expect(found!.enabled).toBe(true);
  }

  /**
   * A populated row reads back exactly as a read of its own does, every declared type included. It
   * crosses JSON inside its parent's statement, which has no 64-bit integer, exact decimal or date, so
   * this pins the decode that puts each one back. A `bigint` within 2^53, since some SQLite drivers
   * refuse to read a wider one at all.
   */
  async shouldPopulateRowsTypedAsTheirOwnRead() {
    const [own, populated] = await this.readTypedRowsBothWays();

    expect(populated).toEqual(own);
  }

  /** The same rows read on their own and populated under their group, both sorted by name. */
  protected async readTypedRowsBothWays() {
    const groupId = await this.querier.insertOne(TypedGroup, { name: 'typed group' });
    const at = new Date(Date.UTC(2026, 8, 10, 12, 30, 0, 123));
    await this.querier.insertMany(TypedRow, [
      {
        groupId,
        name: 'first',
        count: 7,
        amount: 12.5,
        enabled: true,
        exact: EXACT_DECIMAL,
        wide: 42n,
        at,
      },
      { groupId, name: 'second', count: -3, amount: 0.25, enabled: false },
    ]);
    const $select = {
      id: true,
      groupId: true,
      name: true,
      count: true,
      amount: true,
      enabled: true,
      exact: true,
      wide: true,
      at: true,
    } as const;

    const own = await this.querier.findMany(TypedRow, { $select, $where: { groupId }, $sort: { name: 1 } });
    const [group] = await this.querier.findMany(TypedGroup, {
      $select: { name: true },
      $where: { id: groupId },
      $populate: { rows: { $select, $sort: { name: 1 } } },
    });

    return [own, group.rows] as const;
  }

  /**
   * The opt-out from that numeric decoding, for a decimal wider than a JS number can hold.
   *
   * `columnType: 'decimal'` still builds a DECIMAL column, but the declared `String` keeps the field
   * off the numeric path, so the driver's exact text survives. Drizzle and MikroORM both make this
   * the *default* for a decimal and require opting in to a number; uql decodes by the declaration
   * instead, which only works as a trade if this way out keeps working.
   */
  async shouldKeepADecimalDeclaredAsStringExact() {
    const id = await this.querier.insertOne(TypedRow, { name: 'exact', exact: EXACT_DECIMAL });
    const found = await this.querier.findOneById(TypedRow, id, { $select: { exact: true } });

    expect(found!.exact).toBe(this.expectedExactDecimal());
  }

  /**
   * What survives a round-trip through a DECIMAL column declared `String`: the text itself, on every
   * engine that has a real DECIMAL. The SQLite family overrides with {@link FLOATED_DECIMAL}.
   */
  protected expectedExactDecimal(): string | number {
    return EXACT_DECIMAL;
  }

  /**
   * A `bigint` past 2^53 is written exactly: the database finds the row by its own value, and not by the
   * neighbour a rounded bind would have stored in its place. Compared there rather than read back, so
   * it holds on the SQLite drivers too, whose reads of a value that wide are the one exception.
   */
  async shouldWriteAWideBigIntExactly() {
    await this.querier.insertOne(TypedRow, { name: 'wide', wide: 9007199254740993n });

    expect(await this.querier.count(TypedRow, { $where: { wide: 9007199254740993n } })).toBe(1);
    expect(await this.querier.count(TypedRow, { $where: { wide: 9007199254740992n } })).toBe(0);
  }

  /**
   * Past 2^53 a JS number rounds silently, so a BIGINT that wide reads back as its exact text: the one
   * rule every driver's decode shares (`decodeWideNumber`). The SQLite family is the exception - no
   * driver there hands uql the digits - so each of its suites pins what its own driver does instead.
   */
  async shouldReadAWideIntegerExactly() {
    await this.assertWideInteger(this.querier.all<WideRow>(this.wideIntegerSql()));
  }

  /** A BIGINT past 2^53 crosses JSON as text, so a populated row keeps every digit JSON would round. */
  async shouldPopulateAWideIntegerExactly() {
    const groupId = await this.querier.insertOne(TypedGroup, { name: 'wide group' });
    await this.querier.insertOne(TypedRow, { groupId, name: 'wide', wide: 9007199254740993n });

    const [group] = await this.querier.findMany(TypedGroup, {
      $select: { name: true },
      $where: { id: groupId },
      $populate: { rows: { $select: { wide: true } } },
    });

    expect(group.rows).toEqual([{ wide: 9007199254740993n }]);
  }

  /** Bytes cross JSON as `\x` and hex, which a populated row decodes back to the bytes written. */
  async shouldPopulateBytes() {
    const groupId = await this.querier.insertOne(TypedGroup, { name: 'bytes group' });
    await this.querier.insertOne(TypedRow, { groupId, name: 'bytes', bytes: Buffer.from('hi') });

    const [group] = await this.querier.findMany(TypedGroup, {
      $select: { name: true },
      $where: { id: groupId },
      $populate: { rows: { $select: { bytes: true } } },
    });

    expect(group.rows).toEqual([{ bytes: new Uint8Array([0x68, 0x69]) }]);
  }

  /** A raw projection answers under its alias in a populated row, joined or aggregated alike. */
  async shouldPopulateARawSelect() {
    const groupId = await this.querier.insertOne(TypedGroup, { name: 'raw group' });
    await this.querier.insertOne(TypedRow, { groupId, name: 'raw row' });
    const $select = [raw`UPPER(${col('name')})`.as('label')];

    const [group] = await this.querier.findMany(TypedGroup, {
      $select: { name: true },
      $where: { id: groupId },
      $populate: { rows: { $select } },
    });
    const [row] = await this.querier.findMany(TypedRow, {
      $select: { name: true },
      $where: { groupId },
      $populate: { group: { $select } },
    });

    expect(group.rows).toEqual([{ label: 'RAW ROW' }]);
    expect(row.group).toEqual({ id: groupId, label: 'RAW GROUP' });
  }

  /** A joined row is there when its key is: an unmatched join's computed column, a count of 0, makes none. */
  async shouldLeaveOutAnUnmatchedJoinWithAComputedField() {
    const id = await this.querier.insertOne(ItemAdjustment, { number: 1 });

    const [adjustment] = await this.querier.findMany(ItemAdjustment, {
      $select: { number: true },
      $where: { id },
      $populate: { item: true },
    });

    expect(adjustment).not.toHaveProperty('item');
  }

  protected wideIntegerSql(): string {
    return 'SELECT 9007199254740993 AS big';
  }

  protected async assertWideInteger(read: Promise<WideRow[]>): Promise<void> {
    expect((await read)[0]?.big).toBe('9007199254740993');
  }

  override createTables() {
    return createTables(this.querier);
  }

  override dropTables() {
    return dropTables(this.querier);
  }

  /**
   * `firstId` is asserted defined by default (every `'returning'`-ish dialect reports one).
   * {@link MySqlLikeQuerierIt} overrides to a no-op: MySQL has no `RETURNING`, so a manually
   * specified (non-auto-increment) PK reports no `firstId` on upsert.
   */
  /**
   * `created` is asserted `undefined` by default: most dialects (SQLite, MariaDB, CockroachDB)
   * have no reliable insert-vs-update signal for a `RETURNING`-based upsert. Dialects that DO have
   * one (Postgres's `xmax`, MySQL's `affectedRows` convention) override both of these to assert
   * `true`/`false` instead.
   */
  protected assertUpsertCreatedOnInsert(created: boolean | undefined): void {
    expect(created).toBeUndefined();
  }

  protected assertUpsertCreatedOnUpdate(created: boolean | undefined): void {
    expect(created).toBeUndefined();
  }

  /**
   * `code`, not the key, is the conflict path, so a row's id is only the database's to report: on an
   * engine with no ordered `RETURNING` it is read back by that column. Every backend reports each one.
   */
  async shouldUpsertManyReturnIdsForNonPkConflictPath() {
    const existingId = await this.querier.insertOne(Coupon, { code: 'EXISTING', label: 'Old' });

    const result = await this.querier.upsertMany(Coupon, { code: true }, [
      { code: 'BRAND-NEW', label: 'New' },
      { code: 'EXISTING', label: 'Updated' },
    ]);
    expect(result.changes).toBeGreaterThanOrEqual(2);

    const inserted = await this.querier.findOne(Coupon, { $select: { id: true }, $where: { code: 'BRAND-NEW' } });
    expect(result.ids.map(String)).toEqual([String(inserted!.id), String(existingId)]);
  }

  /** A statement per shape, which reorders the rows: the ids still have to follow the payload. */
  async shouldUpsertManyReportIdsInPayloadOrder() {
    const { ids } = await this.querier.upsertMany(Coupon, { code: true }, [
      { code: 'A', label: 'x' },
      { code: 'B' },
      { code: 'C', label: 'y' },
    ]);
    const found = await this.querier.findMany(Coupon, { $select: { id: true }, $sort: { code: 1 } });

    expect(ids.map(String)).toEqual(found.map(({ id }) => String(id)));
  }

  /** Matched on a column that is not the key, which leaves MySQL's header with no id for the row. */
  async shouldUpsertOneReportTheIdOfTheRowItUpdated() {
    const existingId = await this.querier.insertOne(Coupon, { code: 'EXISTING', label: 'Old' });

    const { id } = await this.querier.upsertOne(Coupon, { code: true }, { code: 'EXISTING', label: 'Updated' });

    expect(String(id)).toBe(String(existingId));
  }

  override async shouldUpsertOne() {
    const pk = '507f1f77bcf86cd799439011';

    const insertResult = await this.querier.upsertOne(TaxCategory, { pk: true }, { pk, name: 'Some Name C' });
    expect(insertResult.changes).toBeGreaterThanOrEqual(1);
    expect(insertResult.id).toBe(pk);
    this.assertUpsertCreatedOnInsert(insertResult.created);

    const record2 = await this.querier.findOne(TaxCategory, { $select: { name: true }, $where: { pk } });
    expect(record2).toMatchObject({ name: 'Some Name C' });

    const updateResult = await this.querier.upsertOne(TaxCategory, { pk: true }, { pk, name: 'Some Name D' });
    expect(updateResult.changes).toBeGreaterThanOrEqual(1);
    expect(updateResult.id).toBe(pk);
    this.assertUpsertCreatedOnUpdate(updateResult.created);

    const record3 = await this.querier.findOne(TaxCategory, { $select: { name: true }, $where: { pk } });
    expect(record3).toMatchObject({ name: 'Some Name D' });
  }

  async shouldFindWith$excludeOmittingTheColumn() {
    await this.querier.insertOne(LedgerAccount, { name: 'Some Account' });

    const [found] = await this.querier.findMany(LedgerAccount, { $exclude: { name: true } });

    expect(found.id).toBeDefined();
    expect('name' in found).toBe(false);
  }

  /** Read with the parent, the children need no id of it, so the parent keeps what it selected. */
  async shouldPopulateAToManyWhen$excludeSubtractsTheParentId() {
    await this.querier.insertOne(InventoryAdjustment, {
      description: 'some description',
      itemAdjustments: [{ buyPrice: 50 }, { buyPrice: 300 }],
    });

    const [found] = await this.querier.findMany(InventoryAdjustment, {
      $exclude: { id: true },
      $populate: { itemAdjustments: { $select: { buyPrice: true }, $sort: { buyPrice: 1 } } },
    });

    expect('id' in found).toBe(false);
    expect(found.itemAdjustments).toEqual([{ buyPrice: 50 }, { buyPrice: 300 }]);
  }

  /** The children's own `$exclude` applies to what they answer under. */
  async shouldPopulateAToManyWhen$excludeSubtractsTheChildForeignKey() {
    await this.querier.insertOne(InventoryAdjustment, {
      description: 'some description',
      itemAdjustments: [{ buyPrice: 50 }, { buyPrice: 300 }],
    });

    const [found] = await this.querier.findMany(InventoryAdjustment, {
      $populate: { itemAdjustments: { $exclude: { inventoryAdjustmentId: true, number: true } } },
    });

    expect(found.itemAdjustments).toMatchObject([{ buyPrice: 50 }, { buyPrice: 300 }]);
    expect('number' in found.itemAdjustments![0]).toBe(false);
  }

  /** A key left to the database is assigned by it: the shape only a SQL engine can offer. */
  async shouldInsertManyWithAutoIncrementIdAsDefault() {
    const ids = await this.querier.insertMany(Invoice, [
      { description: 'Some Name A' },
      { description: 'Some Name B' },
      { description: 'Some Name C' },
    ]);
    expect(ids).toHaveLength(3);
    for (const id of ids) {
      expect(id).toBeDefined();
    }
    const founds = await this.querier.findMany(Invoice, { $sort: { id: 1 } });
    expect(founds.map(({ id }) => id)).toEqual(ids);
  }

  async shouldInsertManyWithProvidedAndGeneratedIds() {
    const ids = await this.querier.insertMany(Invoice, [
      { description: 'Mixed A' },
      { id: 5000, description: 'Mixed B' },
      { description: 'Mixed C' },
    ]);
    expect(ids).toHaveLength(3);
    expect(ids[1]).toBe(5000);

    const founds = await this.querier.findMany(Invoice, {
      $select: { id: true, description: true },
      $where: { description: ['Mixed A', 'Mixed B', 'Mixed C'] },
      $sort: { description: 1 },
    });
    expect(founds).toHaveLength(3);
    const persistedIds = founds.map(({ id }) => id);
    for (const id of persistedIds) {
      expect(id).toBeDefined();
    }
    expect(Number(persistedIds[1])).toBe(5000);
    expect(ids).toEqual([persistedIds[0], 5000, persistedIds[2]]);
  }

  /**
   * The same mixed batch, cascading. Header-derived ids are only sound when every row in the
   * *statement* left the key to the database, and that was asked of the whole batch: one supplied id
   * made every id `undefined`, so the cascade had no parent to point at and wrote a null foreign
   * key, silently orphaning the child.
   */
  async shouldCascadeFromABatchMixingProvidedAndGeneratedIds() {
    const ids = await this.querier.insertMany(Invoice, [
      { description: 'mixed cascade a', lines: [{ amount: 50 }] },
      { id: 5001, description: 'mixed cascade b' },
    ]);

    expect(ids[0]).toBeDefined();
    expect(Number(ids[1])).toBe(5001);

    const [found] = await this.querier.findMany(Invoice, {
      $where: { description: 'mixed cascade a' },
      $populate: { lines: { $select: { amount: true } } },
    });
    expect(found.lines).toMatchObject([{ amount: 50 }]);
  }
}
