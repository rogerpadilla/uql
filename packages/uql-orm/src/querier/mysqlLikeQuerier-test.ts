import { expect } from 'vitest';
import { MeasureUnit, MeasureUnitCategory } from '../test/index.js';
import type { PrimaryKey } from '../type/index.js';
import { AbstractSqlQuerierIt } from './abstractSqlQuerier-test.js';
import type { AbstractSqlQuerier } from './abstractSqlQuerier.js';

/**
 * A to-many's array, off the read's own row or a joined one, is not cut at `group_concat_max_len`, which a
 * read lifts for its own statement: the
 * connection's value is set to the smallest there is, which would cut every array past four bytes.
 * Shared with MariaDB, whose `JSON_ARRAYAGG` is cut at the same length.
 */
export async function assertRelationPastConcatLimit(querier: AbstractSqlQuerier): Promise<void> {
  await querier.run('SET SESSION group_concat_max_len = 4');
  try {
    const categoryId = await querier.insertOne(MeasureUnitCategory, { name: 'units' });
    await querier.insertMany(MeasureUnit, [
      { name: 'gram', categoryId },
      { name: 'meter', categoryId },
      { name: 'second', categoryId },
    ]);

    const measureUnits = { $select: { name: true }, $sort: { name: 1 } } as const;
    const [category] = await querier.findMany(MeasureUnitCategory, {
      $select: { name: true },
      $where: { id: categoryId },
      $populate: { measureUnits },
    });
    const [unit] = await querier.findMany(MeasureUnit, {
      $select: { name: true },
      $where: { categoryId, name: 'gram' },
      $populate: { category: { $select: { name: true }, $populate: { measureUnits } } },
    });

    const names = [{ name: 'gram' }, { name: 'meter' }, { name: 'second' }];
    expect(category.measureUnits).toEqual(names);
    expect(unit).toMatchObject({ category: { measureUnits: names } });
  } finally {
    await querier.run('SET SESSION group_concat_max_len = DEFAULT');
  }
}

/**
 * Shared expectations for MySQL-protocol drivers (mysql2, Bun MySQL), which have no `RETURNING`
 * support and only report header-derived IDs.
 */
export abstract class MySqlLikeQuerierIt extends AbstractSqlQuerierIt {
  /** MySQL's `affectedRows` convention exposes the `created` flag on upsert. */
  protected override assertUpsertCreatedOnInsert(created: boolean | undefined): void {
    expect(created).toBe(true);
  }

  protected override assertUpsertCreatedOnUpdate(created: boolean | undefined): void {
    expect(created).toBe(false);
  }

  shouldReadARelationPastTheConcatLimit() {
    return assertRelationPastConcatLimit(this.querier);
  }
}
