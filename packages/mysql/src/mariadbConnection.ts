import { PoolConnection } from 'mariadb';

import { Logger, QuerierPoolConnection, QueryUpdateResult } from '@uql/core/type';

export class MariadbConnection implements QuerierPoolConnection {
  constructor(readonly conn: PoolConnection, readonly logger?: Logger) {}

  async all<T>(query: string) {
    this.logger?.(query);
    const res = await this.conn.query(query);
    return res.slice(0, res.length);
  }

  async run(query: string) {
    this.logger?.(query);
    const res = await this.conn.query(query);
    return { changes: res.affectedRows, firstId: res.insertId } as QueryUpdateResult;
  }

  async release() {
    await this.conn.release();
  }

  async end() {
    await this.conn.end();
  }
}
