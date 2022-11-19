import { PoolConnection } from 'mariadb';

import { MySqlDialect } from '../dialect/index.js';
import { AbstractSqlQuerier } from '../querier/index.js';
import { QuerierLogger, QueryUpdateResult } from '../type/index.js';

export class MariadbQuerier extends AbstractSqlQuerier {
  constructor(readonly conn: PoolConnection, readonly logger?: QuerierLogger) {
    super(new MySqlDialect());
  }

  override async all<T>(query: string) {
    this.logger?.(query);
    const res: T[] = await this.conn.query(query);
    return res.slice(0, res.length);
  }

  override async run(query: string) {
    this.logger?.(query);
    const res = await this.conn.query(query);
    return { changes: res.affectedRows, firstId: Number(res.insertId) } as QueryUpdateResult;
  }

  override async release() {
    if (this.hasOpenTransaction) {
      throw TypeError('pending transaction');
    }
    await this.conn.release();
  }

  override async end() {
    await this.release();
    await this.conn.end();
  }
}
