import { Database } from 'sqlite';
import { QuerierPoolConnection } from '@uql/core/type';

export class Sqlit3Connection implements QuerierPoolConnection {
  constructor(readonly db: Database) {}

  query(query: string) {
    // console.debug(query);
    return this.db.all(query);
  }

  async run(query: string) {
    // console.debug(query);
    const { changes, lastID } = await this.db.run(query);
    return { changes, lastID };
  }

  release() {
    // no-op
  }

  async close() {
    await this.db.close();
  }
}
