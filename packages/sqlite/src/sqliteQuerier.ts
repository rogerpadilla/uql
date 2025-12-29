import type { Database } from 'better-sqlite3';
import { AbstractSqlQuerier } from 'nukak/querier';
import type { ExtraOptions, QueryUpdateResult } from 'nukak/type';
import { SqliteDialect } from './sqliteDialect.js';

export class SqliteQuerier extends AbstractSqlQuerier {
  constructor(
    readonly db: Database,
    readonly extra?: ExtraOptions,
  ) {
    super(new SqliteDialect());
  }

  override async internalAll<T>(query: string, values?: unknown[]) {
    this.extra?.logger?.(query, values);
    return this.db.prepare(query).all(values || []) as T[];
  }

  override async internalRun(query: string, values?: unknown[]) {
    this.extra?.logger?.(query, values);
    const { changes, lastInsertRowid } = this.db.prepare(query).run(values || []);
    const firstId = lastInsertRowid ? Number(lastInsertRowid) - (changes - 1) : undefined;
    const ids = firstId
      ? Array(changes)
          .fill(firstId)
          .map((i, index) => i + index)
      : [];
    return { changes, ids, firstId } satisfies QueryUpdateResult;
  }

  override async internalRelease() {
    if (this.hasOpenTransaction) {
      throw TypeError('pending transaction');
    }
    // no-op
  }
}
