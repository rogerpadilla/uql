import { expect } from 'vitest';
import type { AbstractSqlDialect } from '../dialect/abstractSqlDialect.js';
import {
  clearTables,
  Cohort,
  CohortLabel,
  CohortSkill,
  Coupon,
  Label,
  Profile,
  recreateTables,
  Seminar,
  SeminarSkill,
  Shelf,
  ShelfBook,
  Skill,
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
import type { QuerySql, Type } from '../type/index.js';
import { currentTimestamp, sql, refs } from '../util/index.js';
import { AbstractQuerierIt } from './abstractQuerier-test.js';
import { AbstractSharedHandleQuerierPool } from './abstractSharedHandleQuerierPool.js';
import type { AbstractSqlQuerier } from './abstractSqlQuerier.js';
import { queryErrorKind } from './queryError.js';

/**
 * Wider than 2^53, so any engine or driver that routes it through a float is caught by the digits. Its
 * float needs only 15 significant digits, which SQLite writes into JSON before 3.53 and libSQL still does.
 */
const EXACT_DECIMAL = '12345678901234500000.99';

/** A `Skill` carrying a column besides its key, so saving it writes the row where a bare key only links one. */
const skill = (area: string, name: string) => ({ area, name, note: name });

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
    const update = { percentage: sql`${refs(Tax).percentage} * 2` };
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
    const counts = [sql`9007199254740995`, sql`9007199254740993`, sql`9007199254740994`, sql`9007199254740993`];
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
      $populate: { rows: { $select: [sql`UPPER(${refs(TypedRow).name})`.as('label')] } },
    });
    const [row] = await this.querier.findMany(TypedRow, {
      $select: { name: true },
      $where: { groupId },
      $populate: { group: { $select: [sql`UPPER(${refs(TypedGroup).name})`.as('label')] } },
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

  protected wideIntegerSql(): QuerySql {
    return sql`SELECT 9007199254740993 AS big`;
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
      $select: [sql`name`],
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
  private readBinding(count: number): QuerySql {
    const { dialect } = this.querier;
    const ids = sql(({ ctx }) => {
      for (let index = 0; index < count; index++) {
        ctx.append(index ? ', ' : '').addValue(index);
      }
    });
    return sql`SELECT COUNT(*) AS n FROM ${sql.text(dialect.escapeId('Coupon'))} WHERE ${sql.text(dialect.escapeId('id'))} IN (${ids})`;
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

  /** Every column of a composite key names the row: one sharing the first column is another row. */
  async shouldWriteAndAddressARowByItsWholeCompositeKey() {
    const ids = await this.querier.insertMany(Cohort, [
      { year: 2026, track: 'a', title: 'a1' },
      { year: 2026, track: 'b', title: 'b1' },
    ]);
    expect(ids).toEqual([
      { year: 2026, track: 'a' },
      { year: 2026, track: 'b' },
    ]);

    await this.querier.updateOneById(Cohort, { year: 2026, track: 'a' }, { title: 'a2' });
    await this.querier.saveOne(Cohort, { year: 2026, track: 'b', title: 'b2' });
    await this.querier.saveOne(Cohort, { year: 2027, track: 'a', title: 'c1' });

    const titles = await this.querier.findMany(Cohort, { $select: { title: true }, $sort: { year: 1, track: 1 } });
    expect(titles).toEqual([{ title: 'a2' }, { title: 'b2' }, { title: 'c1' }]);
    expect(await this.querier.findOneById(Cohort, { year: 2026, track: 'b' })).toEqual({
      year: 2026,
      track: 'b',
      title: 'b2',
    });

    await expect(this.querier.deleteOneById(Cohort, { track: 'a' })).rejects.toThrow(/missing year/);
    await this.querier.deleteOneById(Cohort, { year: 2026, track: 'a' });
    expect(await this.querier.count(Cohort)).toBe(2);
  }

  /** A part of the key filters, sorts and projects like any column, whichever order a statement names the key in. */
  async shouldReadThePartsOfACompositeKeyAsColumns() {
    await this.querier.insertMany(Cohort, [
      { year: 2026, track: 'a', title: 'x' },
      { year: 2026, track: 'b', title: 'y' },
      { year: 2027, track: 'a', title: 'z' },
    ]);

    const byYear = await this.querier.findMany(Cohort, { $where: { year: 2026 }, $sort: { track: -1 } });
    const byTrack = await this.querier.findMany(Cohort, {
      $select: { track: true },
      $where: { track: { $in: ['a'] }, year: { $gt: 2026 } },
    });
    const whole = await this.querier.findMany(Cohort, { $where: { track: 'b', year: 2026 } });
    const counted = await this.querier.count(Cohort, { $where: { year: { $in: [2026, 2027] } } });

    expect(byYear.map((it) => it.track)).toEqual(['b', 'a']);
    expect(byTrack).toEqual([{ track: 'a' }]);
    expect(whole).toEqual([{ year: 2026, track: 'b', title: 'y' }]);
    expect(counted).toBe(3);
  }

  /** The chain compares each part of the key, so a page over a composite key neither skips nor repeats a row. */
  async shouldPageByCursorOverACompositeKey() {
    await this.querier.insertMany(Cohort, [
      { year: 2026, track: 'a' },
      { year: 2026, track: 'b' },
      { year: 2027, track: 'a' },
    ]);
    const $sort = { year: 1, track: 1 } as const;

    const first = await this.querier.findManyPage(Cohort, { $sort, $limit: 2 });
    const second = await this.querier.findManyPage(Cohort, { $sort, $limit: 2, $after: first.endCursor });

    expect(first.items.map((it) => [it.year, it.track])).toEqual([
      [2026, 'a'],
      [2026, 'b'],
    ]);
    expect(second.items.map((it) => [it.year, it.track])).toEqual([[2027, 'a']]);
  }

  /** The rows a to-many lists point at the whole key of their parent, so a sibling sharing a column keeps its own. */
  async shouldSaveTheChildrenOfACompositeParent() {
    await this.querier.insertOne(Cohort, { year: 2026, track: 'a', seminars: [{ title: 's1' }, { title: 's2' }] });
    await this.querier.insertOne(Cohort, { year: 2026, track: 'b', seminars: [{ title: 's3' }] });
    const [kept] = await this.querier.findMany(Seminar, { $where: { title: 's1' } });

    await this.querier.updateOneById(
      Cohort,
      { year: 2026, track: 'a' },
      { seminars: [{ id: kept.id, title: 's1b' }, { title: 's4' }] },
    );

    const seminars = await this.querier.findMany(Seminar, {
      $select: { id: true, title: true, cohortYear: true, cohortTrack: true },
      $sort: { title: 1 },
    });
    expect(seminars).toEqual([
      { id: kept.id, title: 's1b', cohortYear: 2026, cohortTrack: 'a' },
      { id: expect.any(String), title: 's3', cohortYear: 2026, cohortTrack: 'b' },
      { id: expect.any(String), title: 's4', cohortYear: 2026, cohortTrack: 'a' },
    ]);
  }

  async shouldGiveEveryCompositeParentAnUpdateMatchedItsOwnChildren() {
    await this.querier.insertMany(Cohort, [
      { year: 2026, track: 'a' },
      { year: 2026, track: 'b' },
    ]);

    await this.querier.updateMany(Cohort, { $where: { year: 2026 } }, { seminars: [{ title: 'shared' }] });

    const cohorts = await this.querier.findMany(Cohort, { $populate: { seminars: true }, $sort: { track: 1 } });
    expect(cohorts.map((cohort) => cohort.seminars?.map((seminar) => seminar.title))).toEqual([['shared'], ['shared']]);
  }

  /** A link is four columns here, and replacing them takes the ones no longer listed by their whole key. */
  async shouldLinkACompositeParentToCompositeTargets() {
    await this.querier.insertOne(Cohort, {
      year: 2026,
      track: 'a',
      skills: [skill('science', 'algebra'), skill('science', 'geometry')],
    });
    await this.querier.insertOne(Cohort, { year: 2026, track: 'b', skills: [skill('science', 'geometry')] });
    const [kept] = await this.querier.findMany(CohortSkill, { $where: { skillName: 'algebra' } });

    await this.querier.updateOneById(
      Cohort,
      { year: 2026, track: 'a' },
      {
        skills: [skill('science', 'algebra'), skill('arts', 'geometry')],
      },
    );

    const links = await this.querier.findMany(CohortSkill, {
      $select: { id: true, cohortTrack: true, skillArea: true, skillName: true },
      $where: { cohortTrack: 'a' },
      $sort: { skillArea: 1 },
    });
    const populated = await this.querier.findMany(Cohort, {
      $select: { track: true },
      $populate: { skills: { $select: { area: true, name: true }, $sort: { area: 1 } } },
      $sort: { track: 1 },
    });
    expect(links).toEqual([
      { id: expect.any(String), cohortTrack: 'a', skillArea: 'arts', skillName: 'geometry' },
      { id: kept.id, cohortTrack: 'a', skillArea: 'science', skillName: 'algebra' },
    ]);
    expect(populated).toEqual([
      {
        track: 'a',
        skills: [
          { area: 'arts', name: 'geometry' },
          { area: 'science', name: 'algebra' },
        ],
      },
      { track: 'b', skills: [{ area: 'science', name: 'geometry' }] },
    ]);
  }

  async shouldLinkACompositeParentToSoleKeyTargets() {
    const [first, second] = await this.querier.insertMany(Label, [{ name: 'l1' }, { name: 'l2' }]);
    await this.querier.insertOne(Cohort, { year: 2026, track: 'a', labels: [{ id: first }] });
    await this.querier.insertOne(Cohort, { year: 2026, track: 'b', labels: [{ id: first }] });

    await this.querier.updateOneById(Cohort, { year: 2026, track: 'a' }, { labels: [{ id: second }] });

    const links = await this.querier.findMany(CohortLabel, {
      $select: { cohortTrack: true, labelId: true },
      $sort: { cohortTrack: 1 },
    });
    expect(links).toEqual([
      { cohortTrack: 'a', labelId: second },
      { cohortTrack: 'b', labelId: first },
    ]);

    await this.querier.updateOneById(Cohort, { year: 2026, track: 'a' }, { labels: [] });

    expect(await this.querier.count(CohortLabel, { $where: { cohortTrack: 'a' } })).toBe(0);
    expect(await this.querier.count(CohortLabel, { $where: { cohortTrack: 'b' } })).toBe(1);
  }

  async shouldLinkASoleKeyParentToCompositeTargets() {
    const id = await this.querier.insertOne(Seminar, {
      title: 's',
      skills: [skill('science', 'algebra'), skill('science', 'geometry')],
    });

    await this.querier.updateOneById(Seminar, id, { skills: [skill('science', 'geometry')] });

    const found = await this.querier.findOneById(Seminar, id, { $populate: { skills: true } });
    expect(found?.skills?.map((it) => [it.area, it.name])).toEqual([['science', 'geometry']]);
    expect(await this.querier.count(SeminarSkill)).toBe(1);
  }

  async shouldFilterAndCountByAManyToManyWhoseTargetKeyIsComposite() {
    await this.querier.insertOne(Cohort, {
      year: 2026,
      track: 'a',
      skills: [skill('science', 'algebra'), skill('science', 'geometry')],
    });
    await this.querier.insertOne(Cohort, { year: 2026, track: 'b', skills: [skill('science', 'algebra')] });

    const filtered = await this.querier.findMany(Cohort, {
      $select: { track: true },
      $where: { skills: { note: 'geometry' } },
    });
    const counted = await this.querier.findMany(Cohort, {
      $select: { track: true },
      $count: { skills: true },
      $sort: { track: 1 },
    });

    expect(filtered).toEqual([{ track: 'a' }]);
    expect(counted.map((it) => it._count.skills)).toEqual([2, 1]);
  }

  /** A to-one over several columns joins on every one of them, populated or filtered. */
  async shouldReadAToOneWhoseTargetKeyIsComposite() {
    await this.querier.insertOne(Cohort, { year: 2026, track: 'a', title: 'first', seminars: [{ title: 's1' }] });
    await this.querier.insertOne(Cohort, { year: 2026, track: 'b', title: 'second', seminars: [{ title: 's2' }] });

    const populated = await this.querier.findMany(Seminar, {
      $select: { title: true },
      $populate: { cohort: { $select: { title: true } } },
      $sort: { title: 1 },
    });
    const filtered = await this.querier.findMany(Seminar, {
      $select: { title: true },
      $where: { cohort: { title: 'second' } },
    });

    expect(populated).toEqual([
      { title: 's1', cohort: { year: 2026, track: 'a', title: 'first' } },
      { title: 's2', cohort: { year: 2026, track: 'b', title: 'second' } },
    ]);
    expect(filtered).toEqual([{ title: 's2' }]);
  }

  async shouldDeleteTheChildrenAndLinksOfACompositeParentWithIt() {
    await this.querier.insertOne(Cohort, {
      year: 2026,
      track: 'a',
      seminars: [{ title: 's1' }],
      skills: [skill('science', 'algebra')],
    });
    await this.querier.insertOne(Cohort, {
      year: 2026,
      track: 'b',
      seminars: [{ title: 's2' }],
      skills: [skill('science', 'algebra')],
    });

    await this.querier.deleteOneById(Cohort, { year: 2026, track: 'a' });

    expect((await this.querier.findMany(Seminar, { $select: { title: true } })).map((it) => it.title)).toEqual(['s2']);
    expect(await this.querier.count(CohortSkill)).toBe(1);
    expect(await this.querier.count(Skill)).toBe(1);
  }

  async shouldUpsertOnAWholeCompositeKey() {
    await this.querier.insertOne(Cohort, { year: 2026, track: 'a', title: 'old' });

    await this.querier.upsertMany(Cohort, { year: true, track: true }, [
      { year: 2026, track: 'a', title: 'new' },
      { year: 2026, track: 'b', title: 'added' },
    ]);

    const founds = await this.querier.findMany(Cohort, { $sort: { track: 1 } });
    expect(founds).toEqual([
      { year: 2026, track: 'a', title: 'new' },
      { year: 2026, track: 'b', title: 'added' },
    ]);
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
