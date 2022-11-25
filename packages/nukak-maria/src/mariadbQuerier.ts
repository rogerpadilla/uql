import { PoolConnection } from 'mariadb';

import { AbstractSqlQuerier } from 'nukak/querier/index.js';
import { QuerierLogger, QueryUpdateResult } from 'nukak/type/index.js';
import { MariaDialect } from './mariaDialect.js';

export class MariadbQuerier extends AbstractSqlQuerier {
  constructor(readonly conn: PoolConnection, readonly logger?: QuerierLogger) {
    super(new MariaDialect());
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
