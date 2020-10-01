import { log } from 'uql/config';
import { getEntityMeta } from 'uql/decorator';
import { QueryFilter, QuerierPoolConnection } from 'uql/type';
import { SqlQuerier } from '../sqlQuerier';
import { PostgresDialect } from './postgresDialect';

export class PostgresQuerier extends SqlQuerier {
  constructor(conn: QuerierPoolConnection) {
    super(new PostgresDialect(), conn);
  }

  async query<T>(sql: string) {
    log(`\nquery: ${sql}\n`);
    const res: { rows: T } = await this.conn.query(sql);
    return res.rows;
  }

  async insert<T>(type: { new (): T }, bodies: T[]) {
    const query = this.dialect.insert(type, bodies);
    const res = await this.query<{ insertid: number }[]>(query);
    const meta = getEntityMeta(type);
    return bodies[bodies.length - 1][meta.id.property] ?? res[res.length - 1].insertid;
  }

  async insertOne<T>(type: { new (): T }, body: T) {
    return this.insert(type, [body]);
  }

  async update<T>(type: { new (): T }, filter: QueryFilter<T>, body: T) {
    const query = this.dialect.update(type, filter, body);
    const res: { rowCount: number } = await this.conn.query(query);
    return res.rowCount;
  }

  async remove<T>(type: { new (): T }, filter: QueryFilter<T>) {
    const query = this.dialect.remove(type, filter);
    const res = await this.conn.query(query);
    return res.rowCount;
  }
}
