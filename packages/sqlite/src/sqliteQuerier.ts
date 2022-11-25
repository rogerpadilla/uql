import type { Database } from 'sqlite';
import type { QuerierLogger, QueryUpdateResult } from 'nukak/type/index.js';
import { AbstractSqlQuerier } from 'nukak/querier/index.js';
import { SqliteDialect } from 'nukak/dialect/index.js';

export class SqliteQuerier extends AbstractSqlQuerier {
  constructor(readonly db: Database, readonly logger?: QuerierLogger) {
    super(new SqliteDialect());
  }

  override async all<T>(query: string) {
    this.logger?.(query);
    return this.db.all<T[]>(query);
  }

  override async run(query: string) {
    this.logger?.(query);
    const { changes, lastID } = await this.db.run(query);
    const firstId = lastID ? lastID - (changes - 1) : undefined;
    return { changes, firstId } as QueryUpdateResult;
  }

  override async release() {
    if (this.hasOpenTransaction) {
      throw TypeError('pending transaction');
    }
    // no-op
  }

  override async end() {
    await this.release();
    await this.db.close();
  }
}
