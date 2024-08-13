import { PoolClient } from 'pg';
import type { ExtraOptions, QueryUpdateResult } from 'nukak/type';
import { AbstractSqlQuerier } from 'nukak/querier';
import { PostgresDialect } from './postgresDialect.js';

export class PgQuerier extends AbstractSqlQuerier {
  constructor(
    readonly conn: PoolClient,
    readonly extra?: ExtraOptions,
  ) {
    super(new PostgresDialect());
  }

  override async all<T>(query: string) {
    this.extra?.logger?.(query);
    const res = await this.conn.query<T>(query);
    return res.rows;
  }

  override async run(query: string) {
    this.extra?.logger?.(query);
    const { rowCount: changes, rows = [] }: any = await this.conn.query(query);
    const ids = rows.map((r: any) => r.id);
    return { changes, ids, firstId: ids[0] } satisfies QueryUpdateResult;
  }

  override async release() {
    if (this.hasOpenTransaction) {
      throw TypeError('pending transaction');
    }
    await this.conn.release();
  }
}
