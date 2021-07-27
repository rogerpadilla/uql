import { Database } from 'sqlite';
import { Logger, QuerierPoolConnection, QueryUpdateResult } from '@uql/core/type';

export class SqliteConnection implements QuerierPoolConnection {
  constructor(readonly db: Database, readonly logger?: Logger) {}

  async all<T>(query: string) {
    this.logger?.(query);
    return this.db.all<T[]>(query);
  }

  async run(query: string) {
    this.logger?.(query);
    const { changes, lastID } = await this.db.run(query);
    const firstId = lastID ? lastID - (changes - 1) : undefined;
    return { changes, firstId } as QueryUpdateResult;
  }

  async release() {
    // no-op
  }

  async end() {
    await this.db.close();
  }
}
