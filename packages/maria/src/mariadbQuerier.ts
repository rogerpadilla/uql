import type { PoolConnection } from 'mariadb';
import { AbstractSqlQuerier } from 'nukak/querier';
import type { ExtraOptions, QueryUpdateResult } from 'nukak/type';
import { MariaDialect } from './mariaDialect.js';

export class MariadbQuerier extends AbstractSqlQuerier {
  conn: PoolConnection;

  constructor(
    readonly connect: () => Promise<PoolConnection>,
    readonly extra?: ExtraOptions,
  ) {
    super(new MariaDialect());
  }

  override async internalAll<T>(query: string) {
    this.extra?.logger?.(query);
    await this.lazyConnect();
    const res: T[] = await this.conn.query(query);
    return res.slice(0, res.length);
  }

  override async internalRun(query: string) {
    this.extra?.logger?.(query);
    await this.lazyConnect();
    const res = await this.conn.query(query);
    const ids = res.length ? res.map((r: any) => r.id) : [];
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
