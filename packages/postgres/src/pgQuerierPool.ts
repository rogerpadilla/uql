import { Pool, PoolConfig } from 'pg';
import { QuerierPool } from '@uql/core/type';
import { SqlQuerier } from '@uql/core/querier';
import { PostgresDialect } from '@uql/core/dialect';
import { PgConnection } from './pgConnection';

export class PgQuerierPool implements QuerierPool<SqlQuerier> {
  readonly pool: Pool;

  constructor(opts: PoolConfig) {
    this.pool = new Pool(opts);
  }

  async getQuerier() {
    const conn = await this.pool.connect();
    return new SqlQuerier(new PgConnection(conn), new PostgresDialect());
  }

  async end() {
    await this.pool.end();
  }
}
