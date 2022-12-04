import type { Database } from 'sqlite';
import type { ExtraOptions, QueryUpdateResult } from 'nukak/type/index.js';
import { AbstractSqlQuerier } from 'nukak/querier/index.js';
import { SqliteDialect } from './sqliteDialect.js';

export class SqliteQuerier extends AbstractSqlQuerier {
  constructor(readonly db: Database, readonly extra?: ExtraOptions) {
    super(new SqliteDialect());
  }

  override async all<T>(query: string) {
    this.extra?.logger?.(query);
    return this.db.all<T[]>(query);
  }

  override async run(query: string) {
    this.extra?.logger?.(query);
    const { changes, lastID } = await this.db.run(query);
    const firstId = lastID ? lastID - (changes - 1) : undefined;
    return { changes, firstId } satisfies QueryUpdateResult;
  }

  override async release() {
    if (this.hasOpenTransaction) {
      throw TypeError('pending transaction');
    }
    // no-op
  }
}
