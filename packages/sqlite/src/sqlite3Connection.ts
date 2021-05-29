import { Database } from 'sqlite';
import { QuerierPoolConnection, QueryOptions } from '@uql/core/type';

export class Sqlit3Connection implements QuerierPoolConnection {
  constructor(readonly db: Database) {}

  async query(query: string, opts: QueryOptions = {}) {
    // console.debug(query);
    if (opts.isSelect) {
      return this.db.all(query);
    }
    const { changes: affectedRows, lastID: insertId } = await this.db.run(query);
    return { affectedRows, insertId };
  }

  release() {
    // no-op
  }

  async close() {
    await this.db.close();
  }
}
