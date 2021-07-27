import { createPool, Pool, PoolOptions } from 'mysql2/promise';
import { Logger, QuerierPool } from '@uql/core/type';
import { SqlQuerier } from '@uql/core/querier';
import { MySqlDialect } from '@uql/core/dialect';
import { MySql2Connection } from './mysql2Connection';

export class MySql2QuerierPool implements QuerierPool<SqlQuerier> {
  readonly pool: Pool;

  constructor(opts: PoolOptions, readonly logger?: Logger) {
    this.pool = createPool(opts);
  }

  async getQuerier() {
    const conn = await this.pool.getConnection();
    return new SqlQuerier(new MySqlDialect(), new MySql2Connection(conn, this.logger));
  }

  async end() {
    await this.pool.end();
  }
}
