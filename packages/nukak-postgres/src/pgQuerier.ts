import { PoolClient } from 'pg';

import { QuerierLogger, QueryUpdateResult } from 'nukak/type/index.js';
import { AbstractSqlQuerier } from 'nukak/querier/index.js';
import { PostgresDialect } from 'nukak/dialect/index.js';

export class PgQuerier extends AbstractSqlQuerier {
  constructor(readonly conn: PoolClient, readonly logger?: QuerierLogger) {
    super(new PostgresDialect());
  }

  override async all<T>(query: string) {
    this.logger?.(query);
    const res = await this.conn.query<T>(query);
    return res.rows;
  }

  override async run(query: string) {
    this.logger?.(query);
    const { rowCount: changes, rows }: any = await this.conn.query(query);
    return { changes, firstId: rows[0]?.id } as QueryUpdateResult;
  }

  override async release() {
    if (this.hasOpenTransaction) {
      throw TypeError('pending transaction');
    }
    await this.conn.release();
  }

  override async end() {
    await this.release();
  }
}
