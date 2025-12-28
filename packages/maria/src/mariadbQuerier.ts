import type { PoolConnection } from 'mariadb';
import { AbstractSqlQuerier, Serialized } from 'nukak/querier';
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

  @Serialized()
  override async all<T>(query: string) {
    this.extra?.logger?.(query);
    await this.lazyConnect();
    try {
      const res: T[] = await this.conn.query(query);
      return res.slice(0, res.length);
    } finally {
      await this.releaseIfFree();
    }
  }

  @Serialized()
  override async run(query: string) {
    this.extra?.logger?.(query);
    await this.lazyConnect();
    try {
      const res = await this.conn.query(query);
      const ids = res.length ? res.map((r: any) => r.id) : [];
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
