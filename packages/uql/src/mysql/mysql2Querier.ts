import type { PoolConnection } from 'mysql2/promise';
import { AbstractSqlQuerier } from 'nukak/querier';
import type { ExtraOptions, QueryUpdateResult } from 'nukak/type';
import { MySqlDialect } from './mysqlDialect.js';

export class MySql2Querier extends AbstractSqlQuerier {
  conn: PoolConnection;

  constructor(
    readonly connect: () => Promise<PoolConnection>,
    readonly extra?: ExtraOptions,
  ) {
    super(new MySqlDialect(extra?.namingStrategy));
  }

  override async internalAll<T>(query: string, values?: unknown[]) {
    this.extra?.logger?.(query, values);
    await this.lazyConnect();
    const [res] = await this.conn.query(query, values);
    return res as T[];
  }

  override async internalRun(query: string, values?: unknown[]) {
    this.extra?.logger?.(query, values);
    await this.lazyConnect();
    const [res]: any = await this.conn.query(query, values);
    const ids = res.insertId
      ? Array(res.affectedRows)
          .fill(res.insertId)
          .map((i, index) => i + index)
      : [];
    return { changes: res.affectedRows, ids, firstId: ids[0] } satisfies QueryUpdateResult;
  }

  async lazyConnect() {
    this.conn ??= await this.connect();
  }

  override async internalRelease() {
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
