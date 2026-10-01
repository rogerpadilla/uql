import { expect } from 'vitest';
import { withContext } from '../context/context.js';
import type { AbstractSqlDialect } from '../dialect/abstractSqlDialect.js';
import {
  clearTables,
  Coupon,
  createTables,
  dropTables,
  InventoryAdjustment,
  Invoice,
  InvoiceLine,
  ItemAdjustment,
  LedgerAccount,
  provisioningTimeout,
  type SpecRequirements,
  type SpecTimeouts,
  Tax,
  TenantNote,
  TaxCategory,
  TypedGroup,
  TypedRow,
  violateConstraints,
} from '../test/index.js';
import type { QuerierPool } from '../type/index.js';
import { currentTimestamp, raw, refs } from '../util/index.js';
import { UqlUsageError } from '../util/uqlError.js';
import { AbstractQuerierIt } from './abstractQuerier-test.js';
import { AbstractSharedHandleQuerierPool } from './abstractSharedHandleQuerierPool.js';
import type { AbstractSqlQuerier } from './abstractSqlQuerier.js';
import { queryErrorKind } from './queryError.js';

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

export abstract class AbstractSqlQuerierIt extends AbstractQuerierIt<AbstractSqlQuerier> {
  declare protected pool: QuerierPool<AbstractSqlQuerier, AbstractSqlDialect>;

  requirements(): SpecRequirements<this> {
    const rowLocks = !!this.pool.dialect.features.rowLocks;
    // A held lock is only visible to another connection, which a shared-handle pool has not got.
    const connections = !(this.pool instanceof AbstractSharedHandleQuerierPool);
    // Every engine with vector functions ranks through a relation; MySQL has none outside HeatWave.
    const vectors = this.pool.dialect.vectorMetrics.size > 0;
    return {
      shouldRankByTheNearestRowOfAToMany: vectors,
      shouldRankByTheNearestTargetOfAManyToMany: vectors,
      shouldRankByAToOneWithoutPopulatingIt: vectors,
      shouldRejectLockOutsideTransaction: rowLocks,
      shouldRejectLockOutsideTransactionOnAStream: rowLocks,
      shouldRejectALockTheEngineLacks: !rowLocks,
      shouldFindManyAndCountUnderALock: rowLocks,
      shouldSkipOrRefuseLockedRows: rowLocks && connections,
    };
  }

  /** Tens of thousands of rows where an engine binds 65535 values, which CockroachDB takes seconds over. */
  timeouts(): SpecTimeouts<this> {
    return {
      shouldWriteRowsPastEveryLimit: provisioningTimeout,
      shouldUpsertGuardedRowsPastTheBindBudget: provisioningTimeout,
    };
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
  async shouldRejectLockOutsideTransaction() {
    await expect(this.querier.findMany(LedgerAccount, { $lock: true })).rejects.toThrow('requires an open transaction');
  }

  /** A stream is a read like any other, so the same rule reaches it rather than only `findMany`. */
  async shouldRejectLockOutsideTransactionOnAStream() {
    expect(() => this.querier.findManyStream(LedgerAccount, { $lock: true })).toThrow('requires an open transaction');
  }

  async shouldRejectALockTheEngineLacks() {
    await expect(this.querier.findMany(LedgerAccount, { $lock: true })).rejects.toThrow(
      'does not support row-level locking',
    );
  }

  /**
   * A locked read that also asks for its unpaged total: the total rides in a `COUNT(*) OVER ()`
   * column, and the Postgres family rejects `FOR UPDATE` alongside a window function outright.
   */
  async shouldFindManyAndCountUnderALock() {
    await this.querier.insertMany(LedgerAccount, [{ name: 'a' }, { name: 'b' }, { name: 'c' }]);

    await this.querier.beginTransaction();
    try {
      const [rows, total] = await this.querier.findManyAndCount(LedgerAccount, { $limit: 2, $lock: true });
      expect([rows.length, total]).toEqual([2, 3]);
    } finally {
      await this.querier.rollbackTransaction();
    }
  }

  /**
   * Two workers drawing from one queue never get the same row, and one that will not wait is refused as
   * `retryable`.
   */
  async shouldSkipOrRefuseLockedRows() {
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

      const lock = { $wait: 'skip' } as const;
      const mine = await this.querier.findMany(LedgerAccount, { $sort: { id: 'asc' }, $limit: 3, $lock: lock });
      const theirs = await other.findMany(LedgerAccount, { $sort: { id: 'asc' }, $limit: 3, $lock: lock });

      expect(mine).toHaveLength(3);
      expect(theirs).toHaveLength(3);
      const mineIds = mine.map((it) => it.id);
      const theirsIds = theirs.map((it) => it.id);
      expect(mineIds.filter((id) => theirsIds.includes(id))).toEqual([]);

      const refused = await other
        .findMany(LedgerAccount, { $select: { id: true }, $where: { id: mineIds[0] }, $lock: { $wait: 'nowait' } })
        .catch((thrown: unknown) => thrown);
      expect(queryErrorKind(refused)).toBe('retryable');

      await other.rollbackTransaction();
      await this.querier.rollbackTransaction();
    } finally {
      await other.release();
    }
  }

  /**
   * A read returns the JS types the entity declared, on every dialect: an engine stores a type in what it
   * has (SQLite has no boolean, node-postgres returns BIGINT as text), and only a real read shows it.
   */
  async shouldReadBackDeclaredTypes() {
    const id = await this.querier.insertOne(TypedRow, { name: 'typed', count: 7, amount: 12.5, enabled: true });
    const found = await this.querier.findOneById(TypedRow, id, {
      $select: { id: true, name: true, count: true, amount: true, enabled: true },
    });

    // The id too: it is BIGINT on every engine here, and the one every consumer indexes by.
    expect(typeof found?.id).toBe('number');
    expect(typeof found?.name).toBe('string');
    expect(typeof found?.count).toBe('number');
    expect(found?.count).toBe(7);
    expect(typeof found?.amount).toBe('number');
    expect(found?.amount).toBe(12.5);
    expect(typeof found?.enabled).toBe('boolean');
    expect(found?.enabled).toBe(true);
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
   * A date the database stamps is the instant it is, whichever zone reads it. Not a zoneless column's
   * on Postgres, which the database fills with the session's wall clock.
   */
  async shouldReadADatabaseStampAsTheCurrentInstant() {
    const groupId = await this.querier.insertOne(TypedGroup, { name: 'stamped' });
    await this.querier.insertOne(TypedRow, { groupId, name: 'stamped' });
    await this.querier.updateMany(TypedRow, { $where: { groupId } }, { at: currentTimestamp });

    const [own, populated] = await inTimeZone('Asia/Tokyo', () => this.readDatesBothWays(groupId));

    expect(Math.abs(Number(own.at) - Date.now())).toBeLessThan(60_000);
    expect(populated).toEqual(own);
    // Read back as the value it stored, so it matches itself, where SQLite's `CURRENT_TIMESTAMP` wrote other text.
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
   * engine that has a real DECIMAL. The SQLite family overrides with {@link FLOATED_DECIMAL}.
   */
  protected expectedExactDecimal(): string | number {
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
   * a float - the same rule a relation aggregate's `sum` reads by. A `$count` and an `$avg` are numbers
   * whatever they read, since the engine widens one and floats the other.
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

    // Odd past 2^53, so a total that went through a float would answer an even neighbour instead. A
    // `bigint`, which is what the result type promises, whichever of a number or its digits the engine sent.
    expect(row?.total).toBe(9007199254740995n);
    expect(row?.rows).toBe(2);
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

  protected wideIntegerSql(): string {
    return 'SELECT 9007199254740993 AS big';
  }

  override createTables() {
    return createTables(this.querier);
  }

  override dropTables() {
    return dropTables(this.querier);
  }

  override clearTables() {
    return clearTables(this.querier);
  }

  /**
   * `created` is `undefined` where an upsert has no insert-or-update signal (SQLite, MariaDB,
   * CockroachDB); an engine with one (Postgres's `xmax`, MySQL's `affectedRows`) overrides both.
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
    expect(result.ids.map(String)).toEqual([String(inserted?.id), String(existingId)]);
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

  /** Every column the key or its default: each row its own `DEFAULT VALUES`, or MySQL's `() VALUES ()`. */
  async shouldInsertRowsWithNothingToWrite() {
    const id = await this.querier.insertOne(InvoiceLine, {});
    const ids = await this.querier.insertMany(InvoiceLine, [{}, {}]);

    expect(new Set([id, ...ids].map(String)).size).toBe(3);
    expect(await this.querier.count(InvoiceLine, {})).toBe(3);
  }

  /** Pins each engine's bind budget against its server: a statement binding that many values has to run. */
  async shouldRunAStatementFillingTheBindBudget() {
    const rows = await this.querier.all(...this.readBinding(this.querier.dialect.maxBindValues));

    expect(rows).toHaveLength(1);
  }

  /** Refused before the driver sees it, which would fail it, or on PGlite answer it and every read after wrong. */
  async shouldRefuseAStatementPastTheBindBudget() {
    await expect(this.querier.all(...this.readBinding(this.querier.dialect.maxBindValues + 1))).rejects.toThrow(
      UqlUsageError,
    );
  }

  /**
   * Past every limit a write meets: the bind budget, SQL Server's 1000-row `INSERT ... VALUES`, and the id
   * list the ORM builds itself for a paged update or delete, which it names its rows by.
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

  /** A guarded upsert reads its rows back by key first, a list as long as the payload. */
  async shouldUpsertGuardedRowsPastTheBindBudget() {
    const count = Math.floor(this.querier.dialect.maxBindValues / 2) + 1;
    const notes = Array.from({ length: count }, (_, index) => ({ id: `n${index}`, title: 'note' }));

    const { ids } = await withContext({ tenantId: 'a' }, () =>
      this.querier.upsertMany(TenantNote, { id: true }, notes),
    );

    expect(ids).toEqual(notes.map(({ id }) => id));
    expect(await withContext({ tenantId: 'a' }, () => this.querier.count(TenantNote, {}))).toBe(count);
  }

  /** A read binding `count` values, a placeholder each, in the dialect's own spelling. */
  private readBinding(count: number): [string, number[]] {
    const { dialect } = this.querier;
    const values = Array.from({ length: count }, (_, index) => index);
    const placeholders = values.map((_, index) => dialect.placeholder(index + 1)).join(', ');
    return [
      `SELECT COUNT(*) AS n FROM ${dialect.escapeId('Coupon')} WHERE ${dialect.escapeId('id')} IN (${placeholders})`,
      values,
    ];
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
    expect(found.itemAdjustments?.[0]).not.toHaveProperty('number');
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

/** Runs `fn` with the process in `zone`, the way a server in another zone would run it. */
async function inTimeZone<T>(zone: string, fn: () => Promise<T>): Promise<T> {
  const previous = process.env.TZ;
  process.env.TZ = zone;
  try {
    return await fn();
  } finally {
    // Assigning `undefined` would set the text "undefined", an unknown zone every later test ran in.
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}
