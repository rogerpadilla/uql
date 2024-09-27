import { PoolConnection } from 'mysql2/promise';
import type { ExtraOptions, QueryUpdateResult } from 'nukak/type';
import { AbstractSqlQuerier } from 'nukak/querier';
import { MySqlDialect } from './mysqlDialect.js';

export class MySql2Querier extends AbstractSqlQuerier {
  conn: PoolConnection;

  constructor(
    readonly connect: () => Promise<PoolConnection>,
    readonly extra?: ExtraOptions,
  ) {
    super(new MySqlDialect());
  }

  override async all<T>(query: string) {
    this.extra?.logger?.(query);
    await this.lazyConnect();
    try {
      const [res] = await this.conn.query(query);
      return res as T[];
    } finally {
      await this.releaseIfFree();
    }
  }

  override async run(query: string) {
    this.extra?.logger?.(query);
    await this.lazyConnect();
    try {
      const [res]: any = await this.conn.query(query);
      const ids = res.insertId
        ? Array(res.affectedRows)
            .fill(res.insertId)
            .map((i, index) => i + index)
        : [];
      return { changes: res.affectedRows, ids, firstId: ids[0] } satisfies QueryUpdateResult;
    } finally {
      await this.releaseIfFree();
    }
  }

  async lazyConnect() {
    this.conn ??= await this.connect();
  }

  override async release() {
    if (this.hasOpenTransaction) {
      throw TypeError('pending transaction');
    }
    if (!this.conn) {
      return;
    }
    await this.conn.release();
    this.conn = undefined;
  }
}
