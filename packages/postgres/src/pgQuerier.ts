import { PoolClient } from 'pg';

import { QuerierLogger, QueryUpdateResult } from '@uql/core/type';
import { AbstractSqlQuerier } from '@uql/core/querier';
import { PostgresDialect } from '@uql/core/dialect';

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

  override listTables() {
    return this.all<string>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type LIKE '%TABLE' AND table_name != 'spatial_ref_sys'"
    );
  }

  override async clearTable(table: string) {
    await this.run(`TRUNCATE TABLE ${this.dialect.escapeId(table)} RESTART IDENTITY`);
  }
}
