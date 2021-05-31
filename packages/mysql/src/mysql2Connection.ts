import { QuerierPoolConnection, QueryUpdateResult } from '@uql/core/type';
import { PoolConnection } from 'mysql2/promise';

export class MySql2Connection implements QuerierPoolConnection {
  constructor(readonly conn: PoolConnection) {}

  async all<T>(query: string) {
    // console.debug(query);
    const res = await this.conn.query(query);
    return res[0] as T[];
  }

  async run(query: string) {
    // console.debug(query);
    const { affectedRows: changes, insertId: lastId }: any = await this.conn.query(query);
    return { changes, lastId } as QueryUpdateResult;
  }

  async release() {
    await this.conn.release();
  }

  async end() {
    await this.conn.end();
  }
}
