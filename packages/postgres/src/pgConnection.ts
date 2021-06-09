import { PoolClient } from 'pg';

import { log } from '@uql/core';
import { QuerierPoolConnection, QueryUpdateResult } from '@uql/core/type';

export class PgConnection implements QuerierPoolConnection {
  constructor(readonly conn: PoolClient) {}

  async all<T>(query: string) {
    log(query);
    const res = await this.conn.query<T>(query);
    return res.rows;
  }

  async run(query: string) {
    log(query);
    const { rowCount: changes, rows }: any = await this.conn.query(query);
    return { changes, firstId: rows[0]?.id } as QueryUpdateResult;
  }

  async release() {
    await this.conn.release();
  }

  async end() {
    await this.conn.release();
  }
}
