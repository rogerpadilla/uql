import { QuerierPoolConnection } from '../type';
import { SqlQuerier } from '../sqlQuerier';
import { QueryUpdateResult, QueryFilter } from '../../type';
import { PostgresDialect } from './postgresDialect';

export class PostgresQuerier extends SqlQuerier {
  constructor(conn: QuerierPoolConnection) {
    super(new PostgresDialect(), conn);
  }

  async query<T>(sql: string): Promise<T> {
    console.debug(`\nquery: ${sql}\n`);
    const res: { rows: T } = await this.conn.query(sql);
    return res.rows;
  }

  async insert<T>(type: { new (): T }, bodies: T[]): Promise<number[]> {
    const query = this.dialect.insert(type, bodies);
    const res = await this.query<{ insertid: number }[]>(query);
    const ids = Array<number>(bodies.length)
      .fill(res[0].insertid)
      .map((firstId, index) => firstId + index);
    return ids;
  }

  async insertOne<T>(type: { new (): T }, body: T): Promise<number> {
    const query = this.dialect.insert(type, body);
    const res = await this.query<{ insertid: number }[]>(query);
    return res[0].insertid;
  }

  updateOne<T>(type: { new (): T }, filter: QueryFilter<T>, body: T): Promise<number> {
    return this.update(type, filter, body);
  }

  async update<T>(type: { new (): T }, filter: QueryFilter<T>, body: T, limit?: number): Promise<number> {
    const query = this.dialect.update(type, filter, body, limit);
    const res: { rowCount: number } = await this.conn.query(query);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return res.rowCount;
  }
}
