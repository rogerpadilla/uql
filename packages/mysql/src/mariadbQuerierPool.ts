import { createPool, Pool, PoolConfig } from 'mariadb';
import { QuerierPool } from '@uql/core/type';
import { SqlQuerier } from '@uql/core/querier';
import { MySqlDialect } from '@uql/core/dialect';
import { MariadbConnection } from './mariadbConnection';

export class MariadbQuerierPool implements QuerierPool<SqlQuerier> {
  readonly pool: Pool;

  constructor(opts: PoolConfig) {
    this.pool = createPool(opts);
  }

  async getQuerier() {
    const conn = await this.pool.getConnection();
    return new SqlQuerier(new MariadbConnection(conn), new MySqlDialect());
  }

  async end() {
    await this.pool.end();
  }
}
