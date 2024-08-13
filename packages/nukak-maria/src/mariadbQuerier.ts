import { PoolConnection } from 'mariadb';
import { AbstractSqlQuerier } from 'nukak/querier';
import type { ExtraOptions, QueryUpdateResult } from 'nukak/type';
import { MariaDialect } from './mariaDialect.js';

export class MariadbQuerier extends AbstractSqlQuerier {
  constructor(
    readonly conn: PoolConnection,
    readonly extra?: ExtraOptions,
  ) {
    super(new MariaDialect());
  }

  override async all<T>(query: string) {
    this.extra?.logger?.(query);
    const res: T[] = await this.conn.query(query);
    return res.slice(0, res.length);
  }

  override async run(query: string) {
    this.extra?.logger?.(query);
    const res = await this.conn.query(query);
    const ids = res.length ? res.map((r: any) => r.id) : [];
    return { changes: res.affectedRows, ids, firstId: ids[0] } satisfies QueryUpdateResult;
  }

  override async release() {
    if (this.hasOpenTransaction) {
      throw TypeError('pending transaction');
    }
    await this.conn.release();
  }
}
