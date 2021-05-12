import { QuerierPoolConnection } from '@uql/core/type';
import { BaseSqlQuerier } from '@uql/core/sql';
import { MySqlDialect } from './mysqlDialect';

export class MariadbQuerier extends BaseSqlQuerier {
  constructor(conn: QuerierPoolConnection) {
    super(new MySqlDialect(), conn);
  }

  async query<E>(query: string): Promise<E> {
    const res = await this.conn.query(query);
    return Array.isArray(res) ? res.slice(0, res.length) : res;
  }
}
