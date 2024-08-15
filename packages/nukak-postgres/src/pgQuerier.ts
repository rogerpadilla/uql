import { PoolClient } from 'pg';
import type { ExtraOptions, QueryUpdateResult } from 'nukak/type';
import { AbstractSqlQuerier } from 'nukak/querier';
import { PostgresDialect } from './postgresDialect.js';

export class PgQuerier extends AbstractSqlQuerier {
  conn: PoolClient;

  constructor(
    readonly connect: () => Promise<PoolClient>,
    readonly extra?: ExtraOptions,
  ) {
    super(new PostgresDialect());
  }

  override async all<T>(query: string) {
    this.extra?.logger?.(query);
    await this.lazyConnect();
    const res = await this.conn.query<T>(query);
    await this.releaseIfFree();
    return res.rows;
  }

  override async run(query: string) {
    this.extra?.logger?.(query);
    await this.lazyConnect();
    const { rowCount: changes, rows = [] }: any = await this.conn.query(query);
    await this.releaseIfFree();
    const ids = rows.map((r: any) => r.id);
    return { changes, ids, firstId: ids[0] } satisfies QueryUpdateResult;
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
