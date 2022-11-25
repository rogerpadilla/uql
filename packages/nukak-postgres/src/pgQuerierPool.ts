import pg from 'pg';
import { QuerierLogger, QuerierPool } from 'nukak/type/index.js';
import { PgQuerier } from './pgQuerier.js';

export class PgQuerierPool implements QuerierPool<PgQuerier> {
  readonly pool: pg.Pool;

  constructor(opts: pg.PoolConfig, readonly logger?: QuerierLogger) {
    this.pool = new pg.Pool(opts);
  }

  async getQuerier() {
    const conn = await this.pool.connect();
    return new PgQuerier(conn, this.logger);
  }

  async end() {
    await this.pool.end();
  }
}
