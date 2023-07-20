import { PoolConnection } from 'mysql2/promise';

import type { ExtraOptions, QueryUpdateResult } from 'nukak/type';
import { AbstractSqlQuerier } from 'nukak/querier';
import { MySqlDialect } from './mysqlDialect.js';

export class MySql2Querier extends AbstractSqlQuerier {
  constructor(
    readonly conn: PoolConnection,
    readonly extra?: ExtraOptions,
  ) {
    super(new MySqlDialect());
  }

  override async all<T>(query: string) {
    this.extra?.logger?.(query);
    const [res] = await this.conn.query(query);
    return res as T[];
  }

  override async run(query: string) {
    this.extra?.logger?.(query);
    const [res]: any = await this.conn.query(query);
    return { changes: res.affectedRows, firstId: res.insertId } satisfies QueryUpdateResult;
  }

  override async release() {
    if (this.hasOpenTransaction) {
      throw TypeError('pending transaction');
    }
    await this.conn.release();
  }
}
