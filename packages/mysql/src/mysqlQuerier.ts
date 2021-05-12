import { BaseSqlQuerier } from '@uql/core/sql';
import { QuerierPoolConnection } from '@uql/core/type';
import { MySqlDialect } from './mysqlDialect';

export class MySqlQuerier extends BaseSqlQuerier {
  constructor(conn: QuerierPoolConnection) {
    super(new MySqlDialect(), conn);
  }

  async query<E>(query: string): Promise<E> {
    const [rows] = await this.conn.query(query);
    return rows;
  }
}
