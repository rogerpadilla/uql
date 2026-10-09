import { expect } from 'vitest';
import type { AbstractSqlDialect } from '../dialect/abstractSqlDialect.js';
import {
  clearTables,
  Coupon,
  Profile,
  recreateTables,
  Shelf,
  ShelfBook,
  InventoryAdjustment,
  Invoice,
  InvoiceLine,
  ItemAdjustment,
  LedgerAccount,
  MeasureUnit,
  MeasureUnitCategory,
  provisioningTimeout,
  type SpecRequirements,
  type SpecTimeouts,
  Tax,
  TypedGroup,
  TypedRow,
  User,
  violateConstraints,
} from '../test/index.js';
import type { QueryRaw, Type } from '../type/index.js';
import { currentTimestamp, raw, refs } from '../util/index.js';
import { AbstractQuerierIt } from './abstractQuerier-test.js';
import { AbstractSharedHandleQuerierPool } from './abstractSharedHandleQuerierPool.js';
import type { AbstractSqlQuerier } from './abstractSqlQuerier.js';
import { queryErrorKind } from './queryError.js';

/**
 * Wider than 2^53, so any engine or driver that routes it through a float is caught by the digits. Its
 * float needs only 15 significant digits, which SQLite writes into JSON before 3.53 and libSQL still does.
 */
const EXACT_DECIMAL = '12345678901234500000.99';

export abstract class AbstractSqlQuerierIt extends AbstractQuerierIt<AbstractSqlQuerier, AbstractSqlDialect> {
  /** A held lock is only visible to another connection, which a shared-handle pool has not got. */
  override requirements(): SpecRequirements<this> {
    const rowLocks = !!this.pool.dialect.features.rowLocks;
    return {
      ...super.requirements(),
      shouldRefuseALockOutsideATransaction: rowLocks,
      shouldRefuseALockOutsideATransactionOnAStream: rowLocks,
      shouldFindManyAndCountUnderALock: rowLocks,
      shouldSkipOrRefuseLockedRows: rowLocks && !(this.pool instanceof AbstractSharedHandleQuerierPool),
    };
  }

  /** Tens of thousands of rows where an engine binds 65535 values, which CockroachDB takes seconds over. */
  timeouts(): SpecTimeouts<this> {
    return {
      shouldWriteRowsPastEveryLimit: provisioningTimeout,
    };
  }

  /** A cascade deletes the children first, which the foreign key they hold refuses any other way round. */
  async shouldCascadeDeleteChildrenBeforeParent() {
    const id = await this.querier.insertOne(User, { createdAt: 1, profile: { createdAt: 1 } });

    expect(await this.querier.deleteOneById(User, id)).toBe(1);
    expect(await this.querier.findMany(Profile, { $where: { creatorId: id } })).toEqual([]);
    expect(await this.querier.findMany(User, { $where: { id } })).toEqual([]);
  }

  /** `onDelete: 'CASCADE'` hands the cascade to the database: deleting the parent takes its children along. */
  async shouldLetTheDatabaseCascadeWhenOnDeleteIsDeclared() {
    const shelfId = await this.querier.insertOne(Shelf, { label: 'fiction' });
    await this.querier.insertMany(ShelfBook, [{ shelfId }, { shelfId }]);

    expect(await this.querier.deleteOneById(Shelf, shelfId)).toBe(1);
    expect(await this.querier.count(ShelfBook, { $where: { shelfId } })).toBe(0);
  }

  /** SQL in an upsert's `update` reads the row already there: an engine also has the incoming one in scope. */
  async shouldUpsertWithSqlOverTheRowAlreadyThere() {
    const id = '507f1f77bcf86cd799439014';
    const update = { percentage: raw`${refs(Tax).percentage} * 2` };
    await this.querier.upsertOne(Tax, { id: true }, { id, name: 'VAT', percentage: 5 }, update);
    await this.querier.upsertOne(Tax, { id: true }, { id, name: 'VAT', percentage: 5 }, update);
    expect(await this.querier.findOneById(Tax, id, { $select: { percentage: true } })).toMatchObject({
      percentage: 10,
    });
  }

  /** A lock outside a transaction drops as the statement commits, so the querier refuses it on a live connection. */
  async shouldRefuseALockOutsideATransaction() {
    await expect(this.querier.findMany(LedgerAccount, { $lock: true })).rejects.toThrow('requires an open transaction');
  }

  /** A stream is a read like any other, so the same rule reaches it rather than only `findMany`. */
  async shouldRefuseALockOutsideATransactionOnAStream() {
    expect(() => this.querier.findManyStream(LedgerAccount, { $lock: true })).toThrow('requires an open transaction');
  }

  /**
   * A locked read that also asks for its unpaged total: the total rides in a `COUNT(*) OVER ()`
   * column, and the Postgres family rejects `FOR UPDATE` alongside a window function outright.
   */
  async shouldFindManyAndCountUnderALock() {
    await this.querier.insertMany(LedgerAccount, [{ name: 'a' }, { name: 'b' }, { name: 'c' }]);

    const [rows, total] = await this.querier.transaction(() =>
      this.querier.findManyAndCount(LedgerAccount, { $limit: 2, $lock: true }),
    );

    expect([rows.length, total]).toEqual([2, 3]);
  }

  /**
   * Two workers drawing from one queue never get the same row, and one that will not wait is refused as
   * `retryable`. A plain read first resolves the inserts' intents, which CockroachDB's SKIP LOCKED would
   * otherwise skip as locks.
   */
  async shouldSkipOrRefuseLockedRows() {
    for (let i = 0; i < 6; i++) {
      await this.querier.insertOne(LedgerAccount, { name: `job-${i}` });
    }
    await this.querier.findMany(LedgerAccount, { $select: { id: true } });

    const other = await this.pool.getQuerier();
    const firstThree = { $sort: { id: 'asc' }, $limit: 3, $lock: { $wait: 'skip' } } as const;
    const { promise: mineTaken, resolve: takeMine } = Promise.withResolvers<LedgerAccount['id'][]>();
    const { promise: othersDone, resolve: finishOthers } = Promise.withResolvers<void>();
    try {
      const held = this.querier.transaction(async () => {
        const mine = await this.querier.findMany(LedgerAccount, firstThree);
        takeMine(mine.map((it) => it.id));
        await othersDone;
      });
      const mineIds = await mineTaken;
      const theirs = await other.transaction(() => other.findMany(LedgerAccount, firstThree));
      const refused = await other
        .transaction(() =>
          other.findMany(LedgerAccount, {
            $select: { id: true },
            $where: { id: mineIds[0] },
            $lock: { $wait: 'nowait' },
          }),
        )
        .catch((thrown: unknown) => thrown);
      finishOthers();
      await held;

      expect(mineIds).toHaveLength(3);
      expect(theirs).toHaveLength(3);
      const theirsIds = theirs.map((it) => it.id);
      expect(mineIds.filter((id) => theirsIds.includes(id))).toEqual([]);
      expect(queryErrorKind(refused)).toBe('retryable');
    } finally {
      finishOthers();
      await other.release();
    }
  }

  /**
   * A read returns the JS types the entity declared, on every dialect, the BIGINT id included: an engine
   * stores a type in what it has (SQLite has no boolean, node-postgres returns BIGINT as text), and only a
   * real read shows it.
   */
  async shouldReadBackDeclaredTypes() {
    const id = await this.querier.insertOne(TypedRow, { id: 7, name: 'typed', count: 7, amount: 12.5, enabled: true });
    const found = await this.querier.findOneById(TypedRow, id, {
      $select: { id: true, name: true, count: true, amount: true, enabled: true },
    });

    expect(found).toEqual({ id: 7, name: 'typed', count: 7, amount: 12.5, enabled: true });
  }

  /**
   * A populated row reads back exactly as a read of its own does, every declared type included. It
   * crosses JSON inside its parent's statement, which has no 64-bit integer, exact decimal or date, so
   * this pins the decode that puts each one back.
   */
  async shouldPopulateRowsTypedAsTheirOwnRead() {
    const [own, populated] = await this.readTypedRowsBothWays();

    expect(populated).toEqual(own);
  }

  /**
   * A date is the instant written, and a day the day written, read on its own or populated, whichever
   * zone the process runs in.
   */
  async shouldReadADateAsTheInstantWrittenInAnyZone() {
    const at = new Date(Date.UTC(2026, 8, 10, 12, 30, 0, 123));
    const day = new Date('2026-09-10');
    const groupId = await inTimeZone('America/Bogota', async () => {
      const id = await this.querier.insertOne(TypedGroup, { name: 'zoned' });
      await this.querier.insertOne(TypedRow, { groupId: id, name: 'zoned', at, zonelessAt: at, day });
      return id;
    });

    const [own, populated] = await inTimeZone('Asia/Tokyo', () => this.readDatesBothWays(groupId));

    expect(own).toEqual({ at, zonelessAt: at, day });
    expect(populated).toEqual({ at, zonelessAt: at, day });
  }

  /** A list of dates binds as one, which a driver that takes no JS array spells as a literal. */
  async shouldFindByAListOfDates() {
    const at = new Date(Date.UTC(2026, 8, 10, 12, 30, 0, 123));
    const groupId = await this.querier.insertOne(TypedGroup, { name: 'listed' });
    await this.querier.insertOne(TypedRow, { groupId, name: 'listed', at });

    expect(await this.querier.count(TypedRow, { $where: { groupId, at: { $in: [at] } } })).toBe(1);
  }

  /**
   * A date the database stamps is the instant it is, whichever zone reads it, and reads back as the value it
   * stored, so it matches itself where SQLite's `CURRENT_TIMESTAMP` wrote other text. Not a zoneless
   * column's on Postgres, which the database fills with the session's wall clock.
   */
  async shouldReadADatabaseStampAsTheCurrentInstant() {
    const groupId = await this.querier.insertOne(TypedGroup, { name: 'stamped' });
    await this.querier.insertOne(TypedRow, { groupId, name: 'stamped' });
    await this.querier.updateMany(TypedRow, { $where: { groupId } }, { at: currentTimestamp });

    const [own, populated] = await inTimeZone('Asia/Tokyo', () => this.readDatesBothWays(groupId));

    expect(Math.abs(Number(own.at) - Date.now())).toBeLessThan(60_000);
    expect(populated).toEqual(own);
    expect(await this.querier.count(TypedRow, { $where: { groupId, at: own.at } })).toBe(1);
  }

  /**
   * Rows the database's clock stamped page as the engine orders them, on every engine: each timestamp holds
   * the milliseconds a `Date` holds, as text a bound one matches on SQLite, so the cursor carries the
   * boundary row's value whole and never repeats it or skips the rows after it.
   */
  async shouldPageByTimestampsTheDatabaseWrote() {
    for (const id of [1, 2, 3, 4, 5]) {
      await this.querier.insertOne(TypedRow, { id, name: 'stamped' });
      await this.querier.updateMany(TypedRow, { $where: { id } }, { at: currentTimestamp });
    }
    const q = { $select: { id: true }, $sort: { at: -1, id: 1 } } as const;

    const pages = await this.walkPages(TypedRow, { ...q, $limit: 2 });

    expect(pages.flatMap((page) => page.items)).toEqual(await this.querier.findMany(TypedRow, q));
  }

  /**
   * A BIGINT past 2^53 reads as its exact text, and bound back as text it compares exactly on every SQL
   * engine, so a page by one walks as the engine orders it.
   */
  async shouldPageByAnIntegerPastADoublesPrecision() {
    const counts = [raw`9007199254740995`, raw`9007199254740993`, raw`9007199254740994`, raw`9007199254740993`];
    for (const [at, id] of [1, 2, 3, 4].entries()) {
      await this.querier.insertOne(TypedRow, { id, name: 'wide' });
      await this.querier.updateMany(TypedRow, { $where: { id } }, { count: counts[at] });
    }
    const q = { $select: { id: true }, $sort: { count: 1, id: 1 } } as const;

    const pages = await this.walkPages(TypedRow, { ...q, $limit: 1 });

    expect(pages.flatMap((page) => page.items)).toEqual(await this.querier.findMany(TypedRow, q));
  }

  private async readDatesBothWays(groupId: TypedRow['groupId']) {
    const $select = { at: true, zonelessAt: true, day: true } as const;
    const [row] = await this.querier.findMany(TypedRow, { $select, $where: { groupId } });
    const [group] = await this.querier.findMany(TypedGroup, {
      $select: { name: true },
      $where: { id: groupId },
      $populate: { rows: { $select } },
    });
    return [row, group.rows[0]] as const;
  }

  /** The same rows read on their own and populated under their group, both sorted by name. */
  private async readTypedRowsBothWays() {
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
        wide: 9007199254740993n,
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
   * The opt-out from numeric decoding, for a decimal wider than a JS number: `columnType: 'decimal'`
   * builds the column, and the declared `String` keeps the driver's exact text.
   */
  async shouldKeepADecimalDeclaredAsStringExact() {
    const id = await this.querier.insertOne(TypedRow, { name: 'exact', exact: EXACT_DECIMAL });
    const found = await this.querier.findOneById(TypedRow, id, { $select: { exact: true } });

    expect(found?.exact).toBe(this.expectedExactDecimal());
  }

  /**
   * What survives a round-trip through a DECIMAL column declared `String`: the text itself, on every
   * engine that has a real DECIMAL, which the SQLite family has not.
   */
  protected expectedExactDecimal(): string {
    return EXACT_DECIMAL;
  }

  /**
   * A `bigint` past 2^53 is written exactly: the database finds the row by its own value, and not by the
   * neighbour a rounded bind would have stored in its place. Compared there rather than read back, so a
   * broken write cannot hide behind a broken read.
   */
  async shouldWriteAWideBigIntExactly() {
    await this.querier.insertOne(TypedRow, { name: 'wide', wide: 9007199254740993n });

    expect(await this.querier.count(TypedRow, { $where: { wide: 9007199254740993n } })).toBe(1);
    expect(await this.querier.count(TypedRow, { $where: { wide: 9007199254740992n } })).toBe(0);
  }

  async shouldIncrementAWideBigIntExactly() {
    const id = await this.querier.insertOne(TypedRow, { name: 'wide', wide: 9007199254740992n });

    await this.querier.updateOneById(TypedRow, id, { wide: { $inc: 1n } });

    expect(await this.querier.count(TypedRow, { $where: { wide: 9007199254740993n } })).toBe(1);
  }

  /**
   * Past 2^53 a JS number rounds silently, so a BIGINT that wide reads back as its exact text: the one
   * rule every driver's decode shares (`decodeWideNumber`).
   */
  async shouldReadAWideIntegerExactly() {
    const [row] = await this.querier.all<{ big: unknown }>(this.wideIntegerSql());

    expect(row?.big).toBe('9007199254740993');
  }

  /**
   * A `$sum` reads as the column it totals, so a wide one keeps every digit rather than rounding through
   * a float to an even neighbour: a `bigint`, as the result type promises, whichever of a number or its
   * digits the engine sent. A `$count` is a number whatever it reads, as the relation aggregate's `sum` is.
   */
  async shouldTotalAWideIntegerExactly() {
    const groupId = await this.querier.insertOne(TypedGroup, { name: 'wide totals' });
    await this.querier.insertMany(TypedRow, [
      { groupId, name: 'a', wide: 9007199254740993n },
      { groupId, name: 'b', wide: 2n },
    ]);

    const [row] = await this.querier.aggregate(TypedRow, {
      $where: { groupId },
      $group: { groupId: true },
      $select: { total: { $sum: { wide: true } }, rows: { $count: '*' } },
    });

    expect(row?.total).toBe(9007199254740995n);
    expect(row?.rows).toBe(2);
  }

  /**
   * The table's row count as the engine's statistics hold it once gathered, without reading a row. An
   * engine keeping none refuses, rather than run the scan an estimate exists to avoid.
   */
  async shouldEstimateACountFromStatistics() {
    await this.querier.insertMany(User, [
      { name: 'a', email: 'a@estimate.com' },
      { name: 'b', email: 'b@estimate.com' },
      { name: 'c', email: 'c@estimate.com' },
    ]);

    await this.expectEstimatedCount(User, 3);
  }

  /** Each engine's own constraint errors, which the unit table can only imitate: MSSQL's two 547s among them. */
  async shouldNameConstraintViolations() {
    const { foreignKey, notNull, check } = await violateConstraints(this.querier);

    expect([queryErrorKind(foreignKey), queryErrorKind(notNull), queryErrorKind(check)]).toEqual([
      'foreignKeyViolation',
      'notNullViolation',
      'checkViolation',
    ]);
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
    const [group] = await this.querier.findMany(TypedGroup, {
      $select: { name: true },
      $where: { id: groupId },
      $populate: { rows: { $select: [raw`UPPER(${refs(TypedRow).name})`.as('label')] } },
    });
    const [row] = await this.querier.findMany(TypedRow, {
      $select: { name: true },
      $where: { groupId },
      $populate: { group: { $select: [raw`UPPER(${refs(TypedGroup).name})`.as('label')] } },
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

  /** What an engine keeping no statistics answers; one that keeps them gathers them, then reads them back. */
  protected async expectEstimatedCount(entity: Type<object>, _rows: number): Promise<void> {
    await expect(this.querier.estimatedCount(entity)).rejects.toThrow(
      `${this.querier.dialect.dialectName} does not support estimatedCount`,
    );
  }

  protected wideIntegerSql(): QueryRaw {
    return raw`SELECT 9007199254740993 AS big`;
  }

  override recreateTables(_querier: AbstractSqlQuerier) {
    return recreateTables(this.pool);
  }

  override clearTables() {
    return clearTables(this.querier);
  }

  /** Each nested transaction a savepoint inside the last, all committing with the outermost. */
  async shouldReuseDeeplyNestedTransactions() {
    const result = await this.querier.transaction(async () => {
      await this.querier.insertOne(User, { name: 'level-1' });
      return this.querier.transaction(async () => {
        await this.querier.insertOne(User, { name: 'level-2' });
        return this.querier.transaction(async () => {
          await this.querier.insertOne(User, { name: 'level-3' });
          return this.querier.count(User, {});
        });
      });
    });

    expect(result).toBe(3);
    await expect(this.querier.count(User, {})).resolves.toBe(3);
  }

  /** Needing no id, a tally composes with a raw projection too. */
  async shouldCountBesideARawSelect() {
    const categoryId = await this.querier.insertOne(MeasureUnitCategory, { name: 'raw category' });
    await this.querier.insertMany(MeasureUnit, [
      { name: 'one', categoryId },
      { name: 'two', categoryId },
    ]);

    const found = await this.querier.findMany(MeasureUnitCategory, {
      $select: [raw`name`],
      $count: { measureUnits: true },
    });

    expect(found).toEqual([{ name: 'raw category', _count: { measureUnits: 2 } }]);
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

    const inserted = await this.querier.findOne(Coupon, { $select: { id: true }, $where: { code: 'BRAND-NEW' } });
    expect(result).toEqual([inserted?.id, existingId]);
  }

  /** A statement per shape, which reorders the rows: the ids still have to follow the payload. */
  async shouldUpsertManyReportIdsInPayloadOrder() {
    const ids = await this.querier.upsertMany(Coupon, { code: true }, [
      { code: 'A', label: 'x' },
      { code: 'B' },
      { code: 'C', label: 'y' },
    ]);
    const found = await this.querier.findMany(Coupon, { $select: { id: true }, $sort: { code: 1 } });

    expect(ids).toEqual(found.map(({ id }) => id));
  }

  /** Every column the key or its default: each row its own `DEFAULT VALUES`, or MySQL's `() VALUES ()`. */
  async shouldInsertRowsWithNothingToWrite() {
    const id = await this.querier.insertOne(InvoiceLine, {});
    const ids = await this.querier.insertMany(InvoiceLine, [{}, {}]);

    expect(new Set([id, ...ids].map(String)).size).toBe(3);
    expect(await this.querier.count(InvoiceLine, {})).toBe(3);
  }

  /** Pins each engine's bind budget against its server: a statement binding that many values has to run. */
  async shouldRunAStatementFillingTheBindBudget() {
    const rows = await this.querier.all(this.readBinding(this.querier.dialect.maxBindValues));

    expect(rows).toHaveLength(1);
  }

  /**
   * Rows written past each engine's limits on its own server: SQL Server's 2098 values and 1000 rows, PGlite's
   * 32767, and a MySQL upsert filling 65535. The id lists' split is pinned in `sqliteQuerier.spec.ts`.
   */
  async shouldWriteRowsPastEveryLimit() {
    const count = Math.max(1001, Math.floor(this.querier.dialect.maxBindValues / 2) + 1);
    const rows = Array.from({ length: count }, (_, index) => ({ code: `c${index}`, label: 'inserted' }));
    const paged = { $sort: { id: 1 }, $limit: count } as const;

    const ids = await this.querier.insertMany(Coupon, rows);
    await this.querier.upsertMany(
      Coupon,
      { code: true },
      rows.map(({ code }) => ({ code, label: 'upserted' })),
    );
    const updated = await this.querier.updateMany(
      Coupon,
      { $where: { label: 'upserted' }, ...paged },
      { label: 'updated' },
    );
    const deleted = await this.querier.deleteMany(Coupon, { $where: { label: 'updated' }, ...paged });

    expect(new Set(ids.map(String)).size).toBe(count);
    expect([updated, deleted]).toEqual([count, count]);
  }

  /** A read binding `count` values. */
  private readBinding(count: number): QueryRaw {
    const { dialect } = this.querier;
    const ids = raw(({ ctx }) => {
      for (let index = 0; index < count; index++) {
        ctx.append(index ? ', ' : '').addValue(index);
      }
    });
    return raw`SELECT COUNT(*) AS n FROM ${raw.text(dialect.escapeId('Coupon'))} WHERE ${raw.text(dialect.escapeId('id'))} IN (${ids})`;
  }

  /** Matched on a column that is not the key, which leaves MySQL's header with no id for the row. */
  async shouldUpsertOneReportTheIdOfTheRowItUpdated() {
    const existingId = await this.querier.insertOne(Coupon, { code: 'EXISTING', label: 'Old' });

    const id = await this.querier.upsertOne(Coupon, { code: true }, { code: 'EXISTING', label: 'Updated' });

    expect(id).toBe(existingId);
  }

  async shouldFindWith$excludeOmittingTheColumn() {
    const id = await this.querier.insertOne(LedgerAccount, { name: 'Some Account' });

    const [found] = await this.querier.findMany(LedgerAccount, { $exclude: { name: true } });

    expect(found.id).toBe(id);
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
      $populate: {
        itemAdjustments: { $exclude: { inventoryAdjustmentId: true, number: true }, $sort: { buyPrice: 1 } },
      },
    });

    expect(found.itemAdjustments).toMatchObject([{ buyPrice: 50 }, { buyPrice: 300 }]);
    expect(found.itemAdjustments?.[0]).not.toHaveProperty('number');
  }

  /** Past every engine's expression depth as one flat chain (the Rust Turso engine allows 100, SQLite 1000). */
  async shouldMatchAnOrOfManyAlternatives() {
    await this.querier.insertMany(User, [{ name: 'kept' }, { name: 'other' }]);
    const $or = Array.from({ length: 1200 }, (_, at) => ({ name: `absent ${at}` }));

    const found = await this.querier.findMany(User, {
      $select: { name: true },
      $where: { $or: [...$or, { name: 'kept' }] },
    });

    expect(found.map(({ name }) => name)).toEqual(['kept']);
  }

  /** A key left to the database is assigned by it: the shape only a SQL engine can offer. */
  async shouldInsertManyWithAutoIncrementIdAsDefault() {
    const ids = await this.querier.insertMany(Invoice, [
      { description: 'Some Name A' },
      { description: 'Some Name B' },
      { description: 'Some Name C' },
    ]);
    const founds = await this.querier.findMany(Invoice, { $sort: { id: 1 } });
    expect(founds.map(({ id }) => id)).toEqual(ids);
  }

  async shouldInsertManyWithProvidedAndGeneratedIds() {
    const ids = await this.querier.insertMany(Invoice, [
      { description: 'Mixed A' },
      { id: 5000, description: 'Mixed B' },
      { description: 'Mixed C' },
    ]);
    const founds = await this.querier.findMany(Invoice, { $select: { id: true }, $sort: { description: 1 } });

    expect(ids).toEqual(founds.map(({ id }) => id));
    expect(ids[1]).toBe(5000);
  }

  /**
   * The same mixed batch, cascading: header-derived ids hold only for a statement whose every row left the
   * key to the database, so a supplied one in the batch must not cost the generated row's child its parent.
   */
  async shouldCascadeFromABatchMixingProvidedAndGeneratedIds() {
    const ids = await this.querier.insertMany(Invoice, [
      { description: 'mixed cascade a', lines: [{ amount: 50 }] },
      { id: 5001, description: 'mixed cascade b' },
    ]);

    const [found] = await this.querier.findMany(Invoice, {
      $select: { id: true },
      $where: { description: 'mixed cascade a' },
      $populate: { lines: { $select: { amount: true } } },
    });
    expect(ids).toEqual([found.id, 5001]);
    expect(found.lines).toEqual([{ amount: 50 }]);
  }
}

/**
 * Runs `fn` with the process in `zone`, the way a server in another zone would run it. An unset zone is
 * deleted again, since assigning `undefined` would set the text "undefined", a zone every later test ran in.
 */
async function inTimeZone<T>(zone: string, fn: () => Promise<T>): Promise<T> {
  const previous = process.env.TZ;
  process.env.TZ = zone;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}
