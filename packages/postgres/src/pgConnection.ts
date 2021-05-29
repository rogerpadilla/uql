import { PoolClient } from 'pg';

import { QuerierPoolConnection } from '@uql/core/type';

export class PgConnection implements QuerierPoolConnection {
  constructor(readonly conn: PoolClient) {}

  async all<T>(query: string) {
    // console.debug(query);
    const res = await this.conn.query<T>(query);
    return res.rows;
  }

  async run(query: string) {
    // console.debug(query);
    const res: { rowCount: number; insertId?: any } = await this.conn.query(query);
    return { changes: res.rowCount, insertId: res.insertId };
  }

  async release() {
    await this.conn.release();
  }

  async end() {
    await this.conn.release();
  }
}
