import { PoolConnection } from 'mysql2/promise';

import { QuerierLogger, QueryUpdateResult } from 'nukak/type/index.js';
import { AbstractSqlQuerier } from 'nukak/querier/index.js';
import { MySqlDialect } from './mysqlDialect.js';

export class MySql2Querier extends AbstractSqlQuerier {
  constructor(readonly conn: PoolConnection, readonly logger?: QuerierLogger) {
    super(new MySqlDialect());
  }

  override async all<T>(query: string) {
    this.logger?.(query);
    const [res] = await this.conn.query(query);
    return res as T[];
  }

  override async run(query: string) {
    this.logger?.(query);
    const [res]: any = await this.conn.query(query);
    return { changes: res.affectedRows, firstId: res.insertId } as QueryUpdateResult;
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
