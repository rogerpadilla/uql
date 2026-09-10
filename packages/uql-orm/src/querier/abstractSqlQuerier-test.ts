import { expect } from 'vitest';
import {
  Coupon,
  createTables,
  dropTables,
  InventoryAdjustment,
  Invoice,
  LedgerAccount,
  TaxCategory,
  TypedRow,
} from '../test/index.js';
import type { IdValue, PrimaryKey } from '../type/index.js';
import { AbstractQuerierIt } from './abstractQuerier-test.js';
import { AbstractSharedHandleQuerierPool } from './abstractSharedHandleQuerierPool.js';
import type { AbstractSqlQuerier } from './abstractSqlQuerier.js';

/** Wider than 2^53, so any engine or driver that routes it through a float is caught by the digits. */
const EXACT_DECIMAL = '12345678901234567890.99';

/**
 * What {@link EXACT_DECIMAL} becomes on the SQLite family, which has no DECIMAL type: NUMERIC affinity
 * converts the literal to a float *on write*, so the digits are gone in the database before anything on
 * the read side could preserve them. Every SQLite driver here answers `expectedExactDecimal` with it.
 */
export const FLOATED_DECIMAL = 12345678901234567000;

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

  /** The children are looked up by the parent's id, so it comes back despite being subtracted. */
  async shouldFillToManyRelationsWhen$excludeSubtractsTheParentId() {
    const id = await this.querier.insertOne(InventoryAdjustment, {
      description: 'some description',
      itemAdjustments: [{ buyPrice: 50 }, { buyPrice: 300 }],
    });

    const [found] = await this.querier.findMany(InventoryAdjustment, {
      $exclude: { id: true },
      $populate: { itemAdjustments: { $select: { buyPrice: true } } },
    });

    expect(found.id).toBe(id);
    expect(found.itemAdjustments).toMatchObject([{ buyPrice: 50 }, { buyPrice: 300 }]);
  }

  /** Same for the FK the children are grouped onto their parent by. */
  async shouldFillToManyRelationsWhen$excludeSubtractsTheChildForeignKey() {
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
