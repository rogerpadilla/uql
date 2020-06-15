import { QuerierPoolConnection } from '../type';
import { SqlQuerier } from '../sqlQuerier';
import { MySqlDialect } from './mysqlDialect';

export class MySqlQuerier extends SqlQuerier {
  constructor(conn: QuerierPoolConnection) {
    super(new MySqlDialect(), conn);
  }

  async query<T>(sql: string): Promise<T> {
    console.debug(`\nquery: ${sql}\n`);
    const res: [T] = await this.conn.query(sql);
    return res[0];
  }
}
