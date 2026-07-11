import { expect } from 'vitest';
import { createTables, dropTables, LedgerAccount, TaxCategory } from '../test/index.js';
import type { IdValue, PrimaryKey, QuerierPool } from '../type/index.js';
import { AbstractQuerierIt } from './abstractQuerier-test.js';
import type { AbstractSqlQuerier } from './abstractSqlQuerier.js';

export abstract class AbstractSqlQuerierIt extends AbstractQuerierIt<AbstractSqlQuerier> {
  constructor(
    pool: QuerierPool<AbstractSqlQuerier>,
    readonly idType: string,
  ) {
    super(pool);
  }

  override createTables() {
    return createTables(this.querier, this.idType);
  }

  override dropTables() {
    return dropTables(this.querier);
  }

  /**
   * Expected `insertMany` IDs for a mixed batch (explicit ID in the middle), given the IDs the
   * database actually assigned. `'returning'` dialects report every ID exactly;
   * {@link MySqlLikeQuerierIt} and SQLite override since header-derived IDs are unsafe for
   * mixed batches (only the provided ID is reported, never inferred values).
   */
  protected expectedMixedBatchIds(persistedIds: IdValue<LedgerAccount>[]): IdValue<LedgerAccount>[] {
    return persistedIds;
  }

  /**
   * `firstId` is asserted defined by default (every `'returning'`-ish dialect reports one).
   * {@link MySqlLikeQuerierIt} overrides to a no-op: MySQL has no `RETURNING`, so a manually
   * specified (non-auto-increment) PK reports no `firstId` on upsert.
   */
  protected assertUpsertFirstId(firstId: PrimaryKey | undefined): void {
    expect(firstId).toBeDefined();
  }

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

  override async shouldUpsertOne() {
    const pk = '507f1f77bcf86cd799439011';

    const insertResult = await this.querier.upsertOne(TaxCategory, { pk: true }, { pk, name: 'Some Name C' });
    expect(insertResult.changes).toBeGreaterThanOrEqual(1);
    this.assertUpsertFirstId(insertResult.firstId);
    this.assertUpsertCreatedOnInsert(insertResult.created);

    const record2 = await this.querier.findOne(TaxCategory, { $select: { name: true }, $where: { pk } });
    expect(record2).toMatchObject({ name: 'Some Name C' });

    const updateResult = await this.querier.upsertOne(TaxCategory, { pk: true }, { pk, name: 'Some Name D' });
    expect(updateResult.changes).toBeGreaterThanOrEqual(1);
    this.assertUpsertFirstId(updateResult.firstId);
    this.assertUpsertCreatedOnUpdate(updateResult.created);

    const record3 = await this.querier.findOne(TaxCategory, { $select: { name: true }, $where: { pk } });
    expect(record3).toMatchObject({ name: 'Some Name D' });
  }

  async shouldInsertManyWithProvidedAndGeneratedIds() {
    const ids = await this.querier.insertMany(LedgerAccount, [
      { name: 'Mixed A' },
      { id: 5000, name: 'Mixed B' },
      { name: 'Mixed C' },
    ]);
    expect(ids).toHaveLength(3);
    expect(ids[1]).toBe(5000);

    const founds = await this.querier.findMany(LedgerAccount, {
      $select: { id: true, name: true },
      $where: { name: ['Mixed A', 'Mixed B', 'Mixed C'] },
      $sort: { name: 1 },
    });
    expect(founds).toHaveLength(3);
    const persistedIds = founds.map(({ id }) => id);
    for (const id of persistedIds) {
      expect(id).toBeDefined();
    }
    expect(Number(persistedIds[1])).toBe(5000);
    expect(ids).toEqual(this.expectedMixedBatchIds([persistedIds[0], 5000, persistedIds[2]]));
  }
}
