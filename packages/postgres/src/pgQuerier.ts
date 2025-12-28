import { AbstractSqlQuerier, Serialized } from 'nukak/querier';
import type { ExtraOptions, QueryUpdateResult } from 'nukak/type';
import type { PoolClient } from 'pg';
import { PostgresDialect } from './postgresDialect.js';

export class PgQuerier extends AbstractSqlQuerier {
  conn: PoolClient;

  constructor(
    readonly connect: () => Promise<PoolClient>,
    readonly extra?: ExtraOptions,
  ) {
    super(new PostgresDialect());
  }

  @Serialized()
  override async all<T>(query: string) {
    this.extra?.logger?.(query);
    await this.lazyConnect();
    try {
      const res = await this.conn.query<T>(query);
      return res.rows;
    } finally {
      await this.releaseIfFree();
    }
  }

  @Serialized()
  override async run(query: string) {
    this.extra?.logger?.(query);
    await this.lazyConnect();
    try {
      const { rowCount: changes, rows = [] }: any = await this.conn.query(query);
      const ids = rows.map((r: any) => r.id);
      return { changes, ids, firstId: ids[0] } satisfies QueryUpdateResult;
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
