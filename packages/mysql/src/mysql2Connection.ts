import { PoolConnection } from 'mysql2/promise';

import { Logger, QuerierPoolConnection, QueryUpdateResult } from '@uql/core/type';

export class MySql2Connection implements QuerierPoolConnection {
  constructor(readonly conn: PoolConnection, readonly logger?: Logger) {}

  async all<T>(query: string) {
    this.logger?.(query);
    const [res] = await this.conn.query(query);
    return res as T[];
  }

  async run(query: string) {
    this.logger?.(query);
    const [res]: any = await this.conn.query(query);
    return { changes: res.affectedRows, firstId: res.insertId } as QueryUpdateResult;
  }

  async release() {
    await this.conn.release();
  }

  async end() {
    await this.conn.end();
  }
}
