import { AbstractSqlQuerier } from 'nukak/querier';
import type { ExtraOptions, QueryUpdateResult } from 'nukak/type';
import type { PoolClient } from 'pg';
import { PostgresDialect } from './postgresDialect.js';

export class PgQuerier extends AbstractSqlQuerier {
  conn: PoolClient;

  constructor(
    readonly connect: () => Promise<PoolClient>,
    readonly extra?: ExtraOptions,
  ) {
    super(new PostgresDialect(extra?.namingStrategy));
  }

  override async internalAll<T>(query: string, values?: unknown[]) {
    this.extra?.logger?.(query, values);
    await this.lazyConnect();
    const res = await this.conn.query<T>(query, values);
    return res.rows;
  }

  override async internalRun(query: string, values?: unknown[]) {
    this.extra?.logger?.(query, values);
    await this.lazyConnect();
    const { rowCount: changes, rows = [] }: any = await this.conn.query(query, values);
    const ids = rows.map((r: any) => r.id);
    return { changes, ids, firstId: ids[0] } satisfies QueryUpdateResult;
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
