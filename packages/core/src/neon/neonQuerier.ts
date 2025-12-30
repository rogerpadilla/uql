import type { PoolClient } from '@neondatabase/serverless';
import { PostgresDialect } from '../postgres/index.js';
import { AbstractSqlQuerier } from '../querier/index.js';
import type { ExtraOptions, QueryUpdateResult } from '../type/index.js';

export class NeonQuerier extends AbstractSqlQuerier {
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
    const res = await this.conn.query(query, values);
    return res.rows as T[];
  }

  override async internalRun(query: string, values?: unknown[]) {
    this.extra?.logger?.(query, values);
    await this.lazyConnect();
    const res = await this.conn.query(query, values);
    const changes = res.rowCount ?? 0;
    const ids = res.rows.map((r: any) => r.id);
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
