import { Pool, PoolConfig } from 'pg';
import { QuerierPool } from '@uql/core/type';
import { PostgresQuerier } from './postgresQuerier';
import { PgConnection } from './pgConnection';

export class PgQuerierPool implements QuerierPool<PostgresQuerier> {
  readonly pool: Pool;

  constructor(opts: PoolConfig) {
    this.pool = new Pool(opts);
  }

  async getQuerier() {
    const conn = await this.pool.connect();
    return new PostgresQuerier(new PgConnection(conn));
  }

  async end() {
    await this.pool.end();
  }
}
