import { createPool, Pool, PoolConfig } from 'mariadb';
import { Logger, QuerierPool } from '@uql/core/type';
import { SqlQuerier } from '@uql/core/querier';
import { MySqlDialect } from '@uql/core/dialect';
import { MariadbConnection } from './mariadbConnection';

export class MariadbQuerierPool implements QuerierPool<SqlQuerier> {
  readonly pool: Pool;

  constructor(opts: PoolConfig, readonly logger?: Logger) {
    this.pool = createPool(opts);
  }

  async getQuerier() {
    const conn = await this.pool.getConnection();
    return new SqlQuerier(new MySqlDialect(), new MariadbConnection(conn, this.logger));
  }

  async end() {
    await this.pool.end();
  }
}
