import { QuerierPoolConnection } from '../type';
import { SqlQuerier } from '../sqlQuerier';
import { PostgresDialect } from './postgresDialect';

export class PostgresQuerier extends SqlQuerier {
  constructor(protected readonly conn: QuerierPoolConnection) {
    super(new PostgresDialect(), conn);
  }

  async query<T>(sql: string): Promise<T> {
    console.debug(`\nquery: ${sql}\n`);
    const res: { rows: T } = await this.conn.query(sql);
    return res.rows;
  }
}
