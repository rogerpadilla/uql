import { PoolConnection } from 'mariadb';

import { log } from '@uql/core';
import { QuerierPoolConnection, QueryUpdateResult } from '@uql/core/type';

export class MariadbConnection implements QuerierPoolConnection {
  constructor(readonly conn: PoolConnection) {}

  async all<T>(query: string) {
    log(query);
    const res = await this.conn.query(query);
    return res.slice(0, res.length);
  }

  async run(query: string) {
    log(query);
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
