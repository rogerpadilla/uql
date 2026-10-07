import { expect } from 'vitest';
import { getMeta } from '../entity/index.js';
import { Coupon, MeasureUnit, MeasureUnitCategory } from '../test/index.js';
import type { Type } from '../type/index.js';
import { VectorQuerierIt } from './vectorQuerier-test.js';

/**
 * The MySQL family, MariaDB among them, on their own drivers and Bun's: `ANALYZE TABLE` statistics, a
 * `group_concat_max_len` a read lifts, a stream drained when left, and a session in UTC.
 * {@link MySqlQuerierIt} adds what MySQL alone has.
 */
export class MySqlLikeQuerierIt extends VectorQuerierIt {
  protected override async expectEstimatedCount(entity: Type<object>, rows: number) {
    await this.querier.run(`ANALYZE TABLE ${this.querier.dialect.escapedTableName(getMeta(entity))}`);
    expect(await this.querier.estimatedCount(entity)).toBe(rows);
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

  /** Rows still on the wire when the loop leaves: the driver drains them, or the connection hangs on the next one. */
  async shouldRunAStatementAfterLeavingALongStream() {
    const label = 'x'.repeat(200);
    await this.querier.insertMany(
      Coupon,
      Array.from({ length: 2000 }, (_, index) => ({ code: `c${index}`, label })),
    );

    for await (const _row of this.querier.findManyStream(Coupon, {})) {
      break;
    }

    expect(await this.querier.count(Coupon, {})).toBe(2000);
  }

  /** A session in UTC, as a `DATETIME` is bound and read, so `NOW()` stamps the same instant a bound date names. */
  async shouldRunTheSessionInUtc() {
    const [row] = await this.querier.all<{ tz: string }>('SELECT @@session.time_zone AS tz');
    expect(row?.tz).toBe('+00:00');
  }
}

/** MySQL proper: its `affectedRows` tells an upsert's insert from its update, which it counts twice. */
export class MySqlQuerierIt extends MySqlLikeQuerierIt {
  protected override upsertReport(inserted: number, updated: number) {
    return { changes: inserted + 2 * updated, created: updated === 0 };
  }
}
