import { AbstractSqlQuerier } from '../querier/index.js';
import type { QueryUpdateResult } from '../type/index.js';

export abstract class AbstractSqliteQuerier extends AbstractSqlQuerier {
  protected buildUpdateResult(changes: number, lastInsertRowid?: number | bigint): QueryUpdateResult {
    const firstId = lastInsertRowid ? Number(lastInsertRowid) - (changes - 1) : undefined;
    const ids = firstId
      ? Array(changes)
          .fill(firstId)
          .map((i, index) => i + index)
      : [];
    return { changes, ids, firstId };
  }
}
