import { PoolConnection } from 'mariadb';

import { QuerierPoolConnection, QueryUpdateResult } from '@uql/core/type';

export class MariadbConnection implements QuerierPoolConnection {
  constructor(readonly conn: PoolConnection) {}

  async all<T>(query: string) {
    // console.debug(query);
    const res = await this.conn.query(query);
    return res.slice(0, res.length);
  }

  async run(query: string) {
    // console.debug(query);
    const res = await this.conn.query(query);
    return res as QueryUpdateResult;
  }

  async release() {
    await this.conn.release();
  }

  async end() {
    await this.conn.end();
  }
}
