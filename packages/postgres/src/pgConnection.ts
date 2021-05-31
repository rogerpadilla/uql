import { PoolClient } from 'pg';

import { QuerierPoolConnection, QueryUpdateResult } from '@uql/core/type';

export class PgConnection implements QuerierPoolConnection {
  constructor(readonly conn: PoolClient) {}

  async all<T>(query: string) {
    // console.debug(query);
    const res = await this.conn.query<T>(query);
    return res.rows;
  }

  async run(query: string) {
    // console.debug(query);
    const { rowCount: changes, id: lastId }: any = await this.conn.query(query);
    return { changes, lastId } as QueryUpdateResult;
  }

  async release() {
    await this.conn.release();
  }

  async end() {
    await this.conn.release();
  }
}
