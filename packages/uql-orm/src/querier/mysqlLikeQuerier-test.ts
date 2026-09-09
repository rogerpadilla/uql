import { expect } from 'vitest';
import type { PrimaryKey } from '../type/index.js';
import { AbstractSqlQuerierIt } from './abstractSqlQuerier-test.js';

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

  /**
   * No `RETURNING`: once a batch touches more than one row, `affectedRows` is a weighted sum
   * (1=insert, 2=update) that can't be apportioned back to individual rows. The result stays
   * payload-aligned, so those rows report `undefined` rather than fabricated values - a row that
   * named its own key would still report that.
   */
  protected override assertUpsertManyIds(ids: readonly (PrimaryKey | undefined)[]): void {
    expect(ids).toEqual([undefined, undefined]);
  }
}
