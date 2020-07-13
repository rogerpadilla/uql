import { QuerierPoolConnection } from '../type';
import { SqlQuerier } from '../sqlQuerier';
import { QueryFilter } from '../../type';
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

  async update<T>(type: { new (): T }, filter: QueryFilter<T>, body: T): Promise<number> {
    const query = this.dialect.update(type, filter, body);
    const res: { rowCount: number } = await this.conn.query(query);
    return res.rowCount;
  }

  async remove<T>(type: { new (): T }, filter: QueryFilter<T>): Promise<number> {
    const query = this.dialect.remove(type, filter);
    const res = await this.conn.query<{ rowCount: number }>(query);
    return res.rowCount;
  }
}
