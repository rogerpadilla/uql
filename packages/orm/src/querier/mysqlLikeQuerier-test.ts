import { expect } from 'vitest';
import { MeasureUnit, MeasureUnitCategory } from '../test/index.js';
import { VectorQuerierIt } from './vectorQuerier-test.js';

/**
 * Shared expectations for the MySQL family (MySQL and MariaDB, on their own drivers and Bun's), which
 * report header-derived ids rather than `RETURNING` them.
 */
export abstract class MySqlLikeQuerierIt extends VectorQuerierIt {
  /** MySQL's `affectedRows` convention exposes the `created` flag on upsert. */
  protected override assertUpsertCreatedOnInsert(created: boolean | undefined): void {
    expect(created).toBe(true);
  }

  protected override assertUpsertCreatedOnUpdate(created: boolean | undefined): void {
    expect(created).toBe(false);
  }

  /**
   * A to-many's array, off the read's own row or a joined one, is not cut at `group_concat_max_len`, which
   * a read lifts for its own statement: the connection's value is set to the smallest there is, which
   * would cut every array past four bytes. MariaDB's `JSON_ARRAYAGG` is cut at the same length.
   */
  async shouldReadARelationPastTheConcatLimit() {
    await this.querier.run('SET SESSION group_concat_max_len = 4');
    try {
      const categoryId = await this.querier.insertOne(MeasureUnitCategory, { name: 'units' });
      await this.querier.insertMany(MeasureUnit, [
        { name: 'gram', categoryId },
        { name: 'meter', categoryId },
        { name: 'second', categoryId },
      ]);

      const measureUnits = { $select: { name: true }, $sort: { name: 1 } } as const;
      const [category] = await this.querier.findMany(MeasureUnitCategory, {
        $select: { name: true },
        $where: { id: categoryId },
        $populate: { measureUnits },
      });
      const [unit] = await this.querier.findMany(MeasureUnit, {
        $select: { name: true },
        $where: { categoryId, name: 'gram' },
        $populate: { category: { $select: { name: true }, $populate: { measureUnits } } },
      });

      const names = [{ name: 'gram' }, { name: 'meter' }, { name: 'second' }];
      expect(category.measureUnits).toEqual(names);
      expect(unit).toMatchObject({ category: { measureUnits: names } });
    } finally {
      await this.querier.run('SET SESSION group_concat_max_len = DEFAULT');
    }
  }

  /** A session in UTC, as a `DATETIME` is bound and read, so `NOW()` stamps the same instant a bound date names. */
  async shouldRunTheSessionInUtc() {
    const [row] = await this.querier.all<{ tz: string }>('SELECT @@session.time_zone AS tz');
    expect(row?.tz).toBe('+00:00');
  }
}

/**
 * MariaDB's upsert hands its id back through `RETURNING`, which answers rows rather than the `affectedRows`
 * MySQL's `created` flag is read from, so it reports none.
 */
export abstract class MariadbLikeQuerierIt extends MySqlLikeQuerierIt {
  protected override assertUpsertCreatedOnInsert(created: boolean | undefined): void {
    expect(created).toBeUndefined();
  }

  protected override assertUpsertCreatedOnUpdate(created: boolean | undefined): void {
    expect(created).toBeUndefined();
  }
}
