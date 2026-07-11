import { expect } from 'vitest';
import type { LedgerAccount } from '../test/index.js';
import type { IdValue } from '../type/index.js';
import { AbstractSqlQuerierIt } from './abstractSqlQuerier-test.js';

/**
 * Shared expectations for MySQL-protocol drivers (mysql2, Bun MySQL), which have no `RETURNING`
 * support and only report header-derived IDs.
 */
export abstract class MySqlLikeQuerierIt extends AbstractSqlQuerierIt {
  protected override expectedMixedBatchIds([, providedId]: IdValue<LedgerAccount>[]): IdValue<LedgerAccount>[] {
    return [undefined, providedId, undefined];
  }

  /** MySQL reports no `firstId` for upserts on non-auto-increment PKs (no `RETURNING`). */
  protected override assertUpsertFirstId(): void {
    // no signal to assert
  }

  /** MySQL's `affectedRows` convention exposes the `created` flag on upsert. */
  protected override assertUpsertCreatedOnInsert(created: boolean | undefined): void {
    expect(created).toBe(true);
  }

  protected override assertUpsertCreatedOnUpdate(created: boolean | undefined): void {
    expect(created).toBe(false);
  }
}
