import { expect } from 'vitest';
import { createTables, dropTables, LedgerAccount, TaxCategory } from '../test/index.js';
import type { IdValue, QuerierPool } from '../type/index.js';
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

/**
 * Shared expectations for MySQL-protocol drivers (mysql2, Bun MySQL), which have no `RETURNING`
 * support and only report header-derived IDs.
 */
export abstract class MySqlLikeQuerierIt extends AbstractSqlQuerierIt {
  protected override expectedMixedBatchIds([, providedId]: IdValue<LedgerAccount>[]): IdValue<LedgerAccount>[] {
    return [undefined, providedId, undefined];
  }

  /**
   * MySQL reports no `firstId` for upserts on non-auto-increment PKs (no `RETURNING`), but its
   * `affectedRows` convention exposes the `created` flag, which the base test does not cover.
   */
  override async shouldUpsertOne() {
    const pk = '507f1f77bcf86cd799439011';

    const insertResult = await this.querier.upsertOne(TaxCategory, { pk: true }, { pk, name: 'Some Name C' });
    expect(insertResult.changes).toBeGreaterThanOrEqual(1);
    expect(insertResult.created).toBe(true);

    const record2 = await this.querier.findOne(TaxCategory, { $select: { name: true }, $where: { pk } });
    expect(record2).toMatchObject({ name: 'Some Name C' });

    const updateResult = await this.querier.upsertOne(TaxCategory, { pk: true }, { pk, name: 'Some Name D' });
    expect(updateResult.changes).toBeGreaterThanOrEqual(1);
    expect(updateResult.created).toBe(false);

    const record3 = await this.querier.findOne(TaxCategory, { $select: { name: true }, $where: { pk } });
    expect(record3).toMatchObject({ name: 'Some Name D' });
  }
}
